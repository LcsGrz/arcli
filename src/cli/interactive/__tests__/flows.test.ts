import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingService } from '../../../modules/billing/billing.service';
import { BACK, runWizard } from '../../../modules/interactive/wizard';
import type { IssuedVoucher, VoucherHistoryGateway } from '../../../modules/vouchers/voucher-history';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import { runHistoryFlow } from '../history.flow';
import { buildInvoiceInput, invoiceSteps } from '../invoice.flow';
import { buildNoteInput, noteSteps } from '../note.flow';
import type { InteractiveSession } from '../session';

import { createScript } from './script';

let script = createScript([]);

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
}));

function createSession(vouchers: IssuedVoucher[] = []): InteractiveSession {
  const historyGateway: VoucherHistoryGateway = {
    getLastNumber: async () => vouchers.reduce((max, voucher) => Math.max(max, voucher.number), 0),
    getVoucher: async (number) => vouchers.find((voucher) => voucher.number === number),
  };

  return {
    arca: {} as never,
    billingGateway: { createNextVoucher: vi.fn(), getQuotation: vi.fn() },
    historyGateway,
    runtime: {
      config: { cert: {}, entornoPorDefecto: 'testing', key: {}, output: {} },
      context: { cuit: 20409509763 },
      environment: 'testing',
      outputJson: false,
      outputRaw: false,
      pointOfSale: 3,
    } as unknown as ResolvedArcaRuntime,
    service: new BillingService(),
  };
}

const invoice = (overrides: Partial<IssuedVoucher> = {}): IssuedVoucher => ({
  cae: '86400940834693',
  concept: 2,
  date: '20261001',
  documentNumber: 0,
  documentTypeCode: 99,
  ivaAmount: 21,
  netAmount: 100,
  number: 14,
  total: 121,
  ...overrides,
});

describe('flujos del modo interactivo', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  describe('factura', () => {
    it('arma una factura C y permite volver a cambiar una respuesta', async () => {
      script = createScript([
        [/comprobante/, 'Factura C'],
        [/A quien/, 'Consumidor final'],
        [/Que estas facturando/, 'Servicios'],
        [/Monto total/, BACK],
        [/Que estas facturando/, 'Productos'],
        [/Monto total/, '1.500,50'],
        [/Agregamos/, []],
      ]);

      const session = createSession();
      const state = await runWizard(invoiceSteps(session), { advanced: { currencyCode: 'ARS', sameCurrency: false } });
      const input = buildInvoiceInput(state as NonNullable<typeof state>, session);

      expect(input).toMatchObject({
        concept: 'productos',
        documentType: 'consumidor-final',
        ivaCondition: 'consumidor-final',
        shortcut: 'fc',
        totalAmount: 1500.5,
      });
      expect(script.asked.some((question) => /alicuota/i.test(question))).toBe(false);
    });

    it('arma una FCE A con CUIT y CBU, y alicuota, vencimiento y transferencia como opcionales', async () => {
      script = createScript([
        [/comprobante/, 'Factura de credito electronica A'],
        [/A quien/, 'Con CUIT'],
        [/CUIT del receptor/, '30-70996581-2'],
        [/Condicion frente al IVA/, 'Responsable inscripto'],
        [/Que estas facturando/, 'Servicios'],
        [/Monto total/, '1105'],
        [/CBU/, '0110599520000012345678'],
        [/Agregamos/, ['Modalidad', 'Alicuota', 'Vencimiento']],
        [/Alicuota/, '10,5%'],
        [/Vencimiento del pago/, '30/10'],
        [/Modalidad de transferencia/, 'ADC'],
      ]);

      const session = createSession();
      const state = await runWizard(invoiceSteps(session), { advanced: { currencyCode: 'ARS', sameCurrency: false } });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session)).toMatchObject({
        cbu: '0110599520000012345678',
        documentNumber: 30709965812,
        documentType: 'cuit',
        ivaRate: '10.5',
        paymentDueDate: '30/10',
        shortcut: 'fcea',
        transferMode: 'adc',
      });
    });

    it('suma moneda extranjera y exento desde las opciones avanzadas', async () => {
      script = createScript([
        [/comprobante/, 'Factura B'],
        [/A quien/, 'Consumidor final'],
        [/Que estas facturando/, 'Servicios'],
        [/Monto total/, '1210'],
        [/Agregamos/, ['Moneda extranjera', 'Importe exento']],
        [/Moneda del comprobante/, 'Dolares'],
        [/Como te pagan/, 'En dolares'],
        [/exenta/, '50'],
        [/no gravada/, ''],
      ]);

      const session = createSession();
      const state = await runWizard(invoiceSteps(session), { advanced: { currencyCode: 'ARS', sameCurrency: false } });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session)).toMatchObject({
        currencyCode: 'USD',
        exemptAmount: 50,
        ivaRate: undefined,
        sameCurrency: true,
        untaxedAmount: undefined,
      });
    });

    it('sin marcar opcionales usa la alicuota de la config', async () => {
      script = createScript([
        [/comprobante/, 'Factura B'],
        [/A quien/, 'Consumidor final'],
        [/Que estas facturando/, 'Productos'],
        [/Monto total/, '1105'],
        [/Agregamos/, []],
      ]);

      const session = createSession();

      (session.runtime.config as { alicuotaPorDefecto?: string }).alicuotaPorDefecto = '10.5';

      const state = await runWizard(invoiceSteps(session), { advanced: { currencyCode: 'ARS', sameCurrency: false } });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session).ivaRate).toBe('10.5');
      expect(script.asked.some((question) => /Alicuota/.test(question))).toBe(false);
    });

    it('volver dentro de un opcional vuelve a la seleccion con lo ya respondido', async () => {
      script = createScript([
        [/comprobante/, 'Factura B'],
        [/A quien/, 'Consumidor final'],
        [/Que estas facturando/, 'Servicios'],
        [/Monto total/, '1210'],
        [/Agregamos/, ['Alicuota', 'Periodo']],
        [/Alicuota/, '10,5%'],
        [/Servicio desde/, BACK],
        [/Agregamos/, ['Alicuota']],
        [/Alicuota/, '10,5%'],
      ]);

      const session = createSession();
      const state = await runWizard(invoiceSteps(session), { advanced: { currencyCode: 'ARS', sameCurrency: false } });
      const input = buildInvoiceInput(state as NonNullable<typeof state>, session);

      expect(input.ivaRate).toBe('10.5');
      expect(input.serviceStartDate).toBeUndefined();
      expect(script.chooseManyStep.mock.calls[1][1]).toContainEqual(
        expect.objectContaining({ description: '10,5%', value: 'alicuota' }),
      );
    });

    it('volver en la seleccion de opcionales vuelve al monto', async () => {
      script = createScript([
        [/comprobante/, 'Factura C'],
        [/A quien/, 'Consumidor final'],
        [/Que estas facturando/, 'Servicios'],
        [/Monto total/, '100'],
        [/Agregamos/, BACK],
        [/Monto total/, '200'],
        [/Agregamos/, []],
      ]);

      const session = createSession();
      const state = await runWizard(invoiceSteps(session), { advanced: { currencyCode: 'ARS', sameCurrency: false } });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session).totalAmount).toBe(200);
    });

    it('volver en la primera pregunta sale del flujo', async () => {
      script = createScript([[/comprobante/, BACK]]);

      expect(
        await runWizard(invoiceSteps(createSession()), { advanced: { currencyCode: 'ARS', sameCurrency: false } }),
      ).toBeUndefined();
    });
  });

  describe('notas', () => {
    it('arma una NC por el total sobre una factura de la lista', async () => {
      script = createScript([
        [/Que nota/, 'Nota de credito'],
        [/tipo de factura/, 'Factura B'],
        [/A que la asociamos/, 'A una factura'],
        [/Sobre que Factura B/, '00003-00000014'],
        [/Total o parcial/, 'Anular el total'],
      ]);

      const session = createSession([invoice()]);
      const state = await runWizard(noteSteps(session, 3), {});

      expect(buildNoteInput(state as NonNullable<typeof state>, session, 3)).toMatchObject({
        associatedVoucher: { cuit: '20409509763', fecha: '01/10/2026', numero: 14, puntoVenta: 3, shortcut: 'fb' },
        documentType: 'consumidor-final',
        ivaRate: undefined,
        shortcut: 'ncb',
        totalAmount: 121,
      });
    });

    it('en FCE no ofrece periodo, pregunta el IVA receptor y la anulacion', async () => {
      script = createScript([
        [/Que nota/, 'Nota de credito'],
        [/tipo de factura/, 'Factura de credito electronica A'],
        [/Sobre que Factura de credito electronica A/, '00003-00000014'],
        [/Total o parcial/, 'Parcial'],
        [/Monto de la nota de credito/, '60,50'],
        [/Condicion frente al IVA/, 'Responsable inscripto'],
        [/rechazo la factura/, 'Si'],
      ]);

      const session = createSession([invoice({ documentNumber: 30709965812, documentTypeCode: 80 })]);
      const state = await runWizard(noteSteps(session, 3), {});

      expect(buildNoteInput(state as NonNullable<typeof state>, session, 3)).toMatchObject({
        cancellation: true,
        documentNumber: 30709965812,
        ivaCondition: 'responsable-inscripto',
        shortcut: 'ncea',
        totalAmount: 60.5,
      });
      expect(script.asked.some((question) => /asociamos/.test(question))).toBe(false);
    });

    it('arma una NC asociada a un periodo', async () => {
      script = createScript([
        [/Que nota/, 'Nota de credito'],
        [/tipo de factura/, 'Factura B'],
        [/A que la asociamos/, 'A un periodo'],
        [/Periodo desde/, '1/9'],
        [/Periodo hasta/, '30/9'],
        [/A quien va la nota/, 'Consumidor final'],
        [/concepto ajusta/, 'Servicios'],
        [/Monto de la nota/, '121'],
        [/Alicuota/, '21%'],
      ]);

      const session = createSession();
      const state = await runWizard(noteSteps(session, 3), {});
      const input = buildNoteInput(state as NonNullable<typeof state>, session, 3);

      expect(input).toMatchObject({
        associatedPeriod: { desde: '1/9', hasta: '30/9' },
        shortcut: 'ncb',
        totalAmount: 121,
      });
      expect(input.associatedVoucher).toBeUndefined();
    });

    it('si no hay facturas vuelve a la pregunta anterior', async () => {
      script = createScript([
        [/Que nota/, 'Nota de debito'],
        [/tipo de factura/, 'Factura B'],
        [/A que la asociamos/, 'A una factura'],
        [/A que la asociamos/, BACK],
        [/tipo de factura/, BACK],
        [/Que nota/, BACK],
      ]);

      expect(await runWizard(noteSteps(createSession([]), 3), {})).toBeUndefined();
    });
  });

  describe('historial', () => {
    it('lista los ultimos comprobantes del tipo elegido', async () => {
      script = createScript([[/Que comprobantes/, 'Factura B']]);

      let printed = '';

      vi.mocked(process.stdout.write).mockImplementation((chunk) => {
        printed += String(chunk);
        return true;
      });

      await runHistoryFlow(createSession([invoice()]));

      expect(printed).toContain('00003-00000014');
      expect(printed).toContain('CAE 86400940834693');
    });

    it('volver sale sin consultar', async () => {
      script = createScript([[/Que comprobantes/, BACK]]);

      await runHistoryFlow(createSession([invoice()]));
    });
  });
});
