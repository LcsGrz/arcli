import { describe, expect, it, vi } from 'vitest';

import { InputValidationError } from '../../../lib/errors/app-error';
import type { BillingExecutionResult } from '../../billing/billing.types.internal';
import { getVoucherKindByShortcut } from '../../billing/voucher-kind-map';
import { EXPORT_VOUCHER_KIND, type ExportExecutionResult } from '../../export/export.types';
import { PdfError } from '../pdf.errors';
import { answerPdfDecisions, decidePdfs } from '../pdf-decision';
import { billingPdfVoucher, generatePdfs, type PdfExporter, type PdfVoucher } from '../pdf-generation';

const CONFIG = {
  cuit: '20123456786',
  emisor: { domicilio: 'Calle 123', inicioActividades: '20200301', razonSocial: 'Ana Gomez' },
};

const result = (overrides: Record<string, unknown> = {}) => ({
  dryRun: false,
  response: { cae: '75123456789012', status: 'aprobado' },
  ...overrides,
});

const billing = (number = 42) =>
  ({
    ...result(),
    voucherKind: getVoucherKindByShortcut('fc'),
    voucherNumber: number,
  }) as unknown as BillingExecutionResult;

const VOUCHERS: readonly PdfVoucher[] = [
  { extras: {}, family: 'billing', result: billing(42) },
  {
    family: 'export',
    result: { ...result(), voucherKind: EXPORT_VOUCHER_KIND } as unknown as ExportExecutionResult,
  },
  { extras: {}, family: 'billing', result: billing(43) },
];

describe('decidePdfs', () => {
  it.each([
    ['una vista previa', { dryRun: true }],
    ['un rechazado', { response: { cae: '75123456789012', status: 'rechazado' } }],
    ['sin CAE', { response: { cae: null, status: 'aprobado' } }],
  ])('%s no lleva PDF, aunque lo pida el flag', (_name, overrides) => {
    expect(
      decidePdfs({ interactive: true, mode: 'siempre', vouchers: [{ flag: true, result: result(overrides) }] }),
    ).toEqual(['omitir']);
  });

  it('cada comprobante con su flag; sin flag, la config', () => {
    const vouchers = [true, false, undefined].map((flag) => ({ flag, result: result() }));

    expect(decidePdfs({ interactive: true, mode: 'preguntar', vouchers })).toEqual(['generar', 'omitir', 'preguntar']);
    expect(decidePdfs({ interactive: false, mode: 'preguntar', vouchers })).toEqual(['generar', 'omitir', 'omitir']);
    expect(decidePdfs({ interactive: false, mode: 'siempre', vouchers })).toEqual(['generar', 'omitir', 'generar']);
  });

  it('la respuesta decide solo lo que había que preguntar', () => {
    expect(answerPdfDecisions(['generar', 'omitir', 'preguntar'], true)).toEqual(['generar', 'omitir', 'generar']);
    expect(answerPdfDecisions(['generar', 'omitir', 'preguntar'], false)).toEqual(['generar', 'omitir', 'omitir']);
  });
});

describe('billingPdfVoucher', () => {
  it.each([
    ['la del comprobante', 'cheque', 'cheque'],
    ['la de la config', undefined, 'contado'],
    ['ninguna, si se omitió', null, undefined],
  ])('condición de venta: %s', (_name, saleCondition, expected) => {
    const voucher = billingPdfVoucher(
      billing(),
      { pdfDescription: 'Clase', receiverAddress: 'Calle 1', receiverName: 'Ana', saleCondition },
      { condicionVenta: 'contado' },
    );

    expect(voucher).toMatchObject({
      extras: { condicionVenta: expected, descripcion: 'Clase', receptorDomicilio: 'Calle 1', receptorNombre: 'Ana' },
      family: 'billing',
    });
  });
});

describe('generatePdfs', () => {
  it('carga una vez y genera de a uno y en orden, con la misma config, en todas las familias', async () => {
    let running = 0;
    const exporter = {
      export: vi.fn<PdfExporter['export']>(async (voucher) => {
        running += 1;
        expect(running).toBe(1);
        await Promise.resolve();
        running -= 1;

        return `/pdf/${voucher.family}`;
      }),
    };
    const loadExporter = vi.fn(async () => exporter);

    expect(await generatePdfs({ config: CONFIG, loadExporter, vouchers: VOUCHERS })).toEqual([
      { path: '/pdf/billing' },
      { path: '/pdf/export' },
      { path: '/pdf/billing' },
    ]);
    expect(loadExporter).toHaveBeenCalledTimes(1);
    expect(exporter.export.mock.calls).toEqual(VOUCHERS.map((voucher) => [voucher, CONFIG]));
  });

  it('uno que falla no frena a los demás, y el error queda en su lugar', async () => {
    const exporter: PdfExporter = {
      export: async (voucher) => {
        if (voucher.family === 'export') {
          throw new PdfError('PDF_GENERATION_ERROR', 'se cayó el navegador', { suggestion: 'probá con otro' });
        }

        return '/pdf';
      },
    };

    expect(await generatePdfs({ config: CONFIG, loadExporter: async () => exporter, vouchers: VOUCHERS })).toEqual([
      { path: '/pdf' },
      { error: { code: 'PDF_GENERATION_ERROR', message: 'se cayó el navegador', suggestion: 'probá con otro' } },
      { path: '/pdf' },
    ]);
  });

  it.each([
    ['un error de ARCLI', new InputValidationError('no'), { code: 'INPUT_VALIDATION_ERROR', message: 'no' }],
    ['cualquier otro', new Error('boom'), { code: 'PDF_GENERATION_ERROR', message: 'boom' }],
    ['lo que no es un error', 'boom', { code: 'PDF_GENERATION_ERROR', message: 'boom' }],
  ])('si falla la carga con %s, ninguno tiene PDF y no lanza', async (_name, cause, error) => {
    const outcomes = await generatePdfs({
      config: CONFIG,
      loadExporter: () => Promise.reject(cause),
      vouchers: VOUCHERS,
    });

    expect(outcomes).toEqual([{ error }, { error }, { error }]);
  });

  it('sin los datos del emisor no carga nada', async () => {
    const loadExporter = vi.fn();
    const outcomes = await generatePdfs({ config: { ...CONFIG, emisor: {} }, loadExporter, vouchers: VOUCHERS });

    expect(outcomes).toEqual(
      VOUCHERS.map(() => ({ error: expect.objectContaining({ code: 'PDF_ISSUER_INCOMPLETE' }) })),
    );
    expect(loadExporter).not.toHaveBeenCalled();
  });

  it('sin comprobantes no carga nada', async () => {
    const loadExporter = vi.fn();

    expect(await generatePdfs({ config: CONFIG, loadExporter, vouchers: [] })).toEqual([]);
    expect(loadExporter).not.toHaveBeenCalled();
  });
});
