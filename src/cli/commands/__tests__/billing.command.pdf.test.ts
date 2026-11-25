import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { BillingCommandInput } from '../../../modules/billing/billing.schemas';
import type { BillingExecutionResult } from '../../../modules/billing/billing.types.internal';
import { getVoucherKindByShortcut } from '../../../modules/billing/voucher-kind-map';
import type { ArcliConfig } from '../../../modules/config/config.schemas';
import { PdfError } from '../../../modules/pdf/pdf.errors';
import type { PdfPlugin } from '../../../services/pdf/pdf-plugin';
import {
  attachPdfs,
  PDF_ONLY_FLAGS_WARNING,
  pdfOnlyDataWarning,
  type PdfStepDependencies,
} from '../billing.command.pdf';

vi.mock('../../spinner', () => ({ startSpinner: () => null }));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const CONFIG = {
  cert: {},
  cuit: '20123456786',
  emisor: { domicilio: 'Calle 123', inicioActividades: '20200301', razonSocial: 'Ana Gomez' },
  entornoPorDefecto: 'testing',
  key: {},
  output: { brutoPorDefecto: false, emitirPorDefecto: false, jsonPorDefecto: false },
} satisfies ArcliConfig;

function createResult(overrides: Partial<BillingExecutionResult> = {}): BillingExecutionResult {
  const voucherKind = getVoucherKindByShortcut('fc');

  if (!voucherKind) {
    throw new Error('fc');
  }

  return {
    dryRun: false,
    environment: 'produccion',
    payload: {
      CantReg: 1,
      CbteFch: '20261003',
      CbteTipo: 11,
      Concepto: 2,
      CondicionIVAReceptorId: 5,
      DocNro: 0,
      DocTipo: 99,
      ImpIVA: 0,
      ImpNeto: 1000,
      ImpOpEx: 0,
      ImpTotConc: 0,
      ImpTotal: 1000,
      ImpTrib: 0,
      MonCotiz: 1,
      MonId: 'PES',
      PtoVta: 3,
    },
    response: {
      cae: '76123456789012',
      caeVencimiento: '20261013',
      errors: [],
      events: [],
      observaciones: [],
      observacion: null,
      arcaNumber: 125,
      raw: { cae: '1', caeFchVto: '1', response: { FeDetResp: { FECAEDetResponse: [{ CbteDesde: 125 }] } } },
      resultado: 'A',
      suggestions: [],
      status: 'aprobado',
    },
    voucherKind,
    ...overrides,
  };
}

function input(overrides: Partial<BillingCommandInput> = {}): BillingCommandInput {
  return { ...({} as BillingCommandInput), ...overrides };
}

function createDeps(options: { installed?: boolean; answers?: boolean[] } = {}) {
  const answers = [...(options.answers ?? [])];
  const plugin = {
    getStatus: vi.fn(() => ({ installed: options.installed ?? true })),
    install: vi.fn(async () => ({ installed: true })),
    load: vi.fn(() => ({ render: vi.fn(async () => new Uint8Array([1])) })),
  };
  const deps: PdfStepDependencies = {
    confirm: vi.fn(async () => answers.shift() ?? false),
    createPlugin: () => plugin as unknown as PdfPlugin,
    resolveFolder: () => '/pdfs',
  };

  return { deps, plugin };
}

describe('attachPdfs', () => {
  it('cortado antes de la pregunta de instalar: no instala, y el error es el del corte', async () => {
    const controller = new AbortController();
    const { deps, plugin } = createDeps({ installed: false });

    plugin.getStatus.mockImplementation(() => {
      controller.abort();

      return { installed: false };
    });

    const [result] = await attachPdfs(
      { config: CONFIG, inputs: [input({ pdf: true })], interactive: true, results: [createResult()] },
      { ...deps, interruption: { signal: controller.signal, whileAsking: async () => undefined } },
    );

    expect(result.pdf).toEqual({
      error: { code: 'PDF_GENERATION_ERROR', message: 'Se cortó antes de generar el PDF.', suggestion: undefined },
    });
    expect(plugin.install).not.toHaveBeenCalled();
    expect(plugin.load).not.toHaveBeenCalled();
  });

  it.each(['genera', 'falla'])('un PDF que %s no deja nada escuchando el corte', async (how) => {
    const { signal } = new AbortController();
    const added = vi.spyOn(signal, 'addEventListener');
    const removed = vi.spyOn(signal, 'removeEventListener');
    const { deps, plugin } = createDeps();

    if (how === 'falla') {
      plugin.load.mockReturnValue({ render: vi.fn().mockRejectedValue(new Error('x')) });
    }

    await attachPdfs(
      { config: CONFIG, inputs: [input({ pdf: true })], interactive: false, results: [createResult()] },
      { ...deps, interruption: { signal, whileAsking: async (ask) => ask() } },
    );

    expect(added.mock.calls.length).toBeGreaterThan(0);
    expect(removed.mock.calls.map(([, listener]) => listener)).toEqual(
      expect.arrayContaining(added.mock.calls.map(([, listener]) => listener)),
    );
  });

  it('does nothing without flag in a non interactive run with the default config', async () => {
    const { deps, plugin } = createDeps();
    const results = await attachPdfs(
      { config: CONFIG, inputs: [input()], interactive: false, results: [createResult()] },
      deps,
    );

    expect(results[0].pdf).toBeUndefined();
    expect(plugin.load).not.toHaveBeenCalled();
  });

  it('generates with --exportar-pdf and returns the path', async () => {
    const { deps } = createDeps();
    const [result] = await attachPdfs(
      { config: CONFIG, inputs: [input({ pdf: true })], interactive: false, results: [createResult()] },
      deps,
    );

    expect(result.pdf).toEqual({ path: join('/pdfs', '20123456786', 'factura-c_0003-00000125.pdf') });
  });

  it('treats Ctrl+C in the PDF question as no, because the voucher is already issued', async () => {
    const { deps, plugin } = createDeps();

    vi.mocked(deps.confirm).mockRejectedValueOnce(
      Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' }),
    );

    const [result] = await attachPdfs(
      { config: CONFIG, inputs: [input()], interactive: true, results: [createResult()] },
      deps,
    );

    expect(result.pdf).toBeUndefined();
    expect(plugin.load).not.toHaveBeenCalled();
  });

  it('asks once for the whole batch when the config says preguntar', async () => {
    const { deps } = createDeps({ answers: [true] });
    const results = await attachPdfs(
      { config: CONFIG, inputs: [input(), input()], interactive: true, results: [createResult(), createResult()] },
      deps,
    );

    expect(deps.confirm).toHaveBeenCalledTimes(1);
    expect(deps.confirm).toHaveBeenCalledWith(expect.stringContaining('2 comprobantes'), expect.any(String), 'No');
    expect(results.every((result) => result.pdf && 'path' in result.pdf)).toBe(true);
  });

  it('never generates for previews or rejected vouchers', async () => {
    const { deps } = createDeps();
    const rejected = createResult();
    const results = await attachPdfs(
      {
        config: { ...CONFIG, pdf: 'siempre' },
        inputs: [input(), input()],
        interactive: false,
        results: [
          createResult({ dryRun: true }),
          { ...rejected, response: { ...rejected.response, cae: null, status: 'rechazado' } },
        ],
      },
      deps,
    );

    expect(results.map((result) => result.pdf)).toEqual([undefined, undefined]);
  });

  it('reports a missing plugin without downloading when nobody can answer', async () => {
    const { deps, plugin } = createDeps({ installed: false });

    plugin.load.mockImplementation(() => {
      throw new PdfError('PDF_PLUGIN_MISSING', 'falta', {
        suggestion: 'Instalalo con `arcli pdf instalar`.',
      });
    });

    const [result] = await attachPdfs(
      { config: { ...CONFIG, pdf: 'siempre' }, inputs: [input()], interactive: false, results: [createResult()] },
      deps,
    );

    expect(plugin.install).not.toHaveBeenCalled();
    expect(result.pdf).toEqual({
      error: { code: 'PDF_PLUGIN_MISSING', message: 'falta', suggestion: 'Instalalo con `arcli pdf instalar`.' },
    });
  });

  it('offers to install the plugin in a terminal', async () => {
    const { deps, plugin } = createDeps({ answers: [true], installed: false });
    const [result] = await attachPdfs(
      { config: CONFIG, inputs: [input({ pdf: true })], interactive: true, results: [createResult()] },
      deps,
    );

    expect(plugin.install).toHaveBeenCalled();
    expect(result.pdf).toEqual({ path: join('/pdfs', '20123456786', 'factura-c_0003-00000125.pdf') });
  });

  it('checks the issuer before downloading anything', async () => {
    const { deps, plugin } = createDeps({ installed: false });
    const [result] = await attachPdfs(
      {
        config: { ...CONFIG, emisor: {} },
        inputs: [input({ pdf: true })],
        interactive: true,
        results: [createResult()],
      },
      deps,
    );

    expect(deps.confirm).not.toHaveBeenCalled();
    expect(plugin.install).not.toHaveBeenCalled();
    expect(result.pdf).toMatchObject({ error: { code: 'PDF_ISSUER_INCOMPLETE' } });
  });

  it('prints the sale condition of the voucher, or the one in the config', async () => {
    const renderedSaleCondition = async (config: ArcliConfig, saleCondition?: string | null) => {
      const { deps, plugin } = createDeps();

      await attachPdfs(
        { config, inputs: [input({ pdf: true, saleCondition })], interactive: false, results: [createResult()] },
        deps,
      );

      const { render } = plugin.load.mock.results[0].value as { render: ReturnType<typeof vi.fn> };

      return (render.mock.calls[0][0] as { condicionVenta?: string }).condicionVenta;
    };

    expect(await renderedSaleCondition({ ...CONFIG, condicionVenta: 'contado' })).toBe('Contado');
    expect(await renderedSaleCondition({ ...CONFIG, condicionVenta: 'contado' }, 'cheque')).toBe('Cheque');
    expect(await renderedSaleCondition({ ...CONFIG, condicionVenta: 'contado' }, null)).toBeUndefined();
    expect(await renderedSaleCondition(CONFIG)).toBeUndefined();
  });

  it('warns when PDF-only data was given but no PDF was generated', async () => {
    const { deps } = createDeps();
    const [result] = await attachPdfs(
      {
        config: CONFIG,
        inputs: [input({ pdf: false, receiverName: 'Cliente SA', saleCondition: 'Contado' })],
        interactive: false,
        results: [createResult({ warnings: ['otro aviso'] })],
      },
      deps,
    );

    expect(result.warnings).toEqual(['otro aviso', PDF_ONLY_FLAGS_WARNING]);
  });

  it('si los datos del PDF vinieron del JSON de --cargar, el aviso nombra sus claves y no los flags', () => {
    expect(
      pdfOnlyDataWarning(
        input({
          fromFile: ['pdfDescription', 'receiverName'],
          pdfDescription: 'Servicio',
          receiverName: 'Cliente SA',
        }),
      ),
    ).toBe(
      'Las claves "descripcion" y "receptorNombre" del JSON de `--cargar` solo se usan en el PDF; no se generó ninguno.',
    );
    expect(pdfOnlyDataWarning(input({ fromFile: ['receiverAddress'], receiverAddress: 'Calle 1' }))).toBe(
      'La clave "receptorDomicilio" del JSON de `--cargar` solo se usa en el PDF; no se generó ninguno.',
    );
    expect(
      pdfOnlyDataWarning(input({ fromFile: ['saleCondition'], pdfDescription: 'Servicio', saleCondition: 'Contado' })),
    ).toBe(
      '`--descripcion` y la clave "condicionVenta" del JSON de `--cargar` solo se usan en el PDF; no se generó ninguno.',
    );
    expect(pdfOnlyDataWarning(input({ pdfDescription: 'Servicio' }))).toBe(PDF_ONLY_FLAGS_WARNING);
    expect(pdfOnlyDataWarning(input())).toBeUndefined();
  });

  it('does not warn about the receiver the padron filled in', async () => {
    const { deps } = createDeps();
    const [result] = await attachPdfs(
      {
        config: CONFIG,
        inputs: [
          input({
            pdf: false,
            receiverAddress: 'Calle 1',
            receiverFromPadron: ['address', 'name'],
            receiverName: 'DARIO SA',
          }),
        ],
        interactive: false,
        results: [createResult({ warnings: [] })],
      },
      deps,
    );

    expect(result.warnings).toEqual([]);
  });
});
