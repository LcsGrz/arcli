import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingService } from '../../../modules/billing/billing.service';
import { getVoucherKindByShortcut } from '../../../modules/billing/voucher-kind-map';
import { BACK, runWizard } from '../../../modules/interactive/wizard';
import type { IssuedVoucher, VoucherHistoryGateway } from '../../../modules/vouchers/voucher-history';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import { stripAnsi } from '../../../ui';
import { initialAdvancedOptions } from '../advanced-options';
import { runExportFlow } from '../export.flow';
import { runHistoryFlow } from '../history.flow';
import { buildInvoiceInput, invoiceSteps, runInvoiceFlow } from '../invoice.flow';
import { buildNoteInput, noteSteps } from '../note.flow';
import { repeatSteps } from '../repeat.flow';
import type { InteractiveSession } from '../session';

import { createScript, onlyChoices } from './script';

let script = createScript([]);

vi.mock('../export.flow', () => ({ runExportFlow: vi.fn(async () => undefined) }));

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  chooseStepWhileLoading: (...args: Parameters<typeof script.chooseStepWhileLoading>) =>
    script.chooseStepWhileLoading(...args),
  eraseLastAnswer: () => undefined,
  fitPageSize: () => 12,
}));

function createSession(vouchers: IssuedVoucher[] = [], arca: unknown = {}): InteractiveSession {
  const historyGateway: VoucherHistoryGateway = {
    getLastNumber: async () => vouchers.reduce((max, voucher) => Math.max(max, voucher.number), 0),
    getVoucher: async (number) => vouchers.find((voucher) => voucher.number === number),
  };

  return {
    arca: arca as never,
    billingGateway: { createVoucher: vi.fn(), getNextVoucherNumber: vi.fn(), getQuotation: vi.fn() },
    historyGateway,
    runtime: {
      config: { cert: {}, entornoPorDefecto: 'testing', key: {}, output: {} },
      context: { cuit: 20333333334 },
      environment: 'testing',
      outputJson: false,
      outputRaw: false,
      pointOfSale: 3,
    } as unknown as ResolvedArcaRuntime,
    service: new BillingService(),
  };
}

/** La misma sesion con otra config (y su punto de venta, como lo resuelve ArcaContextResolver). */
function withConfig(session: InteractiveSession, config: Record<string, unknown>): InteractiveSession {
  const merged = { ...session.runtime.config, ...config } as ResolvedArcaRuntime['config'];

  return { ...session, runtime: { ...session.runtime, config: merged, pointOfSale: merged.puntoVentaPorDefecto } };
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
    vi.useRealTimers();
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  describe('factura', () => {
    it('sin punto de venta en la config lo pide antes que el comprobante; Esc vuelve al menú', async () => {
      script = createScript([[/Punto de venta/, BACK]]);

      await runInvoiceFlow(withConfig(createSession(), {}));

      expect(script.asked).toEqual([expect.stringMatching(/Punto de venta/)]);
    });

    it('el punto de venta escrito al empezar llega a la E', async () => {
      script = createScript([
        [/Punto de venta/, '7'],
        [/comprobante/, 'Factura de exportación E'],
      ]);

      await runInvoiceFlow(withConfig(createSession(), {}));

      expect(runExportFlow).toHaveBeenLastCalledWith(
        expect.objectContaining({ runtime: expect.objectContaining({ pointOfSale: 7 }), typedPointOfSale: 7 }),
      );
    });

    it('arranca en la moneda de la config, como el CLI sin --moneda', async () => {
      script = createScript([
        [/comprobante/, 'Factura C'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '100'],
        [/Agregamos/, []],
      ]);

      const session = withConfig(createSession(), { monedaPorDefecto: 'USD', puntoVentaPorDefecto: 3 });
      const state = await runWizard(invoiceSteps(session), {
        advanced: initialAdvancedOptions(session.runtime.config),
      });
      const offered = script.chooseManyStep.mock.calls[0][1] as ReadonlyArray<{ description?: string; value: unknown }>;

      expect(offered.find((choice) => choice.value === 'divisas')?.description).toBe(
        'dólares, cotización oficial de ARCA',
      );
      expect(buildInvoiceInput(state as NonNullable<typeof state>, session)).toMatchObject({
        currencyCode: 'USD',
        exchangeRate: undefined,
        sameCurrency: false,
      });
    });

    it('la moneda inicial: pesos sin config, la de la config y su cotización guardada', () => {
      expect(initialAdvancedOptions({})).toEqual({ currencyCode: 'ARS', sameCurrency: false });
      expect(initialAdvancedOptions({ cotizacionPorDefecto: 1, monedaPorDefecto: 'PES' })).toEqual({
        currencyCode: 'ARS',
        sameCurrency: false,
      });
      expect(initialAdvancedOptions({ cotizacionPorDefecto: 1, monedaPorDefecto: 'DOL' })).toEqual({
        currencyCode: 'USD',
        exchangeRate: undefined,
        sameCurrency: false,
      });
      expect(initialAdvancedOptions({ cotizacionPorDefecto: 1200, monedaPorDefecto: 'EUR' })).toEqual({
        currencyCode: 'EUR',
        exchangeRate: 1200,
        sameCurrency: false,
      });
    });

    it('la factura E se elige en el mismo selector y corre su propio asistente', async () => {
      script = createScript([[/comprobante/, 'Factura de exportación E']]);

      const state = await runWizard(invoiceSteps(createSession()), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
      });

      expect(runExportFlow).toHaveBeenCalledTimes(1);
      expect(state).toMatchObject({ exported: true });
    });

    it('volver desde el asistente de la E vuelve al selector de comprobantes', async () => {
      vi.mocked(runExportFlow).mockResolvedValueOnce(BACK);
      script = createScript([
        [/comprobante/, 'Factura de exportación E'],
        [/comprobante/, BACK],
      ]);

      expect(
        await runWizard(invoiceSteps(createSession()), { advanced: { currencyCode: 'ARS', sameCurrency: false } }),
      ).toBeUndefined();
    });

    it('arma una factura C y permite volver a cambiar una respuesta', async () => {
      script = createScript([
        [/comprobante/, 'Factura C'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, BACK],
        [/Qué estás facturando/, 'Productos'],
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

    it('"Emitir recibo" arranca con el Recibo C elegido y no pregunta el comprobante', async () => {
      script = createScript([
        [/A quién le hacés el recibo/, 'Consumidor final'],
        [/Qué estás cobrando/, 'Productos'],
        [/Monto total/, '2000'],
        [/Agregamos/, []],
      ]);

      const session = createSession();
      const state = await runWizard(invoiceSteps(session), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
        voucherKind: getVoucherKindByShortcut('rc') ?? undefined,
      });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session)).toMatchObject({
        concept: 'productos',
        documentType: 'consumidor-final',
        shortcut: 'rc',
        totalAmount: 2000,
      });
    });

    it('arma una FCE A con CUIT y CBU, y alicuota, vencimiento y transferencia como opcionales', async () => {
      script = createScript([
        [/comprobante/, 'Factura de crédito electrónica A'],
        [/A quién/, 'Con CUIT'],
        [/CUIT del receptor/, '30-70996581-2'],
        [/Condición frente al IVA/, 'Responsable inscripto'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '1105'],
        [/CBU/, '0110599520000012345678'],
        [/Agregamos/, ['Modalidad', 'Alícuota', 'Vencimiento']],
        [/Alícuota/, '10,5%'],
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

    it('en una FCE informa el alias del CBU de la config, como el CLI', () => {
      const session = createSession();
      const withAlias = {
        ...session,
        runtime: { ...session.runtime, config: { ...session.runtime.config, aliasCbu: 'mi.alias.cbu' } },
      } as InteractiveSession;
      const state = {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
        cbu: '0110599520000012345678',
        concept: 'servicios',
        documentNumber: 30709965812,
        documentType: 'cuit',
        ivaCondition: 'responsable-inscripto',
        totalAmount: 1000,
        voucherKind: getVoucherKindByShortcut('fcea'),
      } as const;

      expect(buildInvoiceInput(state as never, withAlias)).toMatchObject({ cbuAlias: 'mi.alias.cbu' });
      expect(
        buildInvoiceInput({ ...state, voucherKind: getVoucherKindByShortcut('fa') } as never, withAlias).cbuAlias,
      ).toBeUndefined();
    });

    it('con un CUIT propone la condicion IVA del padron y guarda el nombre del receptor', async () => {
      script = createScript([
        [/comprobante/, 'Factura A'],
        [/A quién/, 'Con CUIT'],
        [/CUIT del receptor/, '20201797064'],
        [/Condición frente al IVA de VICTORIA CAROLINA DARIO/, 'Responsable inscripto (según el padrón)'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '1000'],
        [/Agregamos/, []],
      ]);

      const getTaxpayerDetails = vi.fn(async () => ({
        datosGenerales: {
          apellido: 'VICTORIA CAROLINA',
          domicilioFiscal: { codPostal: '1030', descripcionProvincia: 'CABA', direccion: 'LARREA 1' },
          nombre: 'DARIO',
        },
        datosRegimenGeneral: { impuesto: [{ descripcionImpuesto: 'IVA', estadoImpuesto: 'AC', idImpuesto: 30 }] },
        tipoPersona: 'FISICA',
      }));
      const session = createSession([], { registerInscriptionProofService: { getTaxpayerDetails } });
      const state = await runWizard(invoiceSteps(session), { advanced: { currencyCode: 'ARS', sameCurrency: false } });

      expect(getTaxpayerDetails).toHaveBeenCalledWith(20201797064);
      expect(buildInvoiceInput(state as NonNullable<typeof state>, session)).toMatchObject({
        ivaCondition: 'responsable-inscripto',
        ivaConditionSource: 'padron',
        receiverAddress: 'LARREA 1, CP 1030, CABA',
        receiverName: 'VICTORIA CAROLINA DARIO',
      });
    });

    it('suma moneda extranjera y exento desde las opciones avanzadas', async () => {
      script = createScript([
        [/comprobante/, 'Factura B'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '1210'],
        [/Agregamos/, ['Moneda extranjera', 'Importe exento']],
        [/Moneda del comprobante/, 'Dólares'],
        [/Cómo te pagan/, 'En dólares'],
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
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Productos'],
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
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '1210'],
        [/Agregamos/, ['Alícuota', 'Período']],
        [/Alícuota/, '10,5%'],
        [/Servicio desde/, BACK],
        [/Agregamos/, ['Alícuota']],
        [/Alícuota/, '10,5%'],
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
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '100'],
        [/Agregamos/, BACK],
        [/Monto total/, '200'],
        [/Agregamos/, []],
      ]);

      const session = createSession();
      const state = await runWizard(invoiceSteps(session), { advanced: { currencyCode: 'ARS', sameCurrency: false } });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session).totalAmount).toBe(200);
    });

    it('suma la fecha del comprobante, con la ventana de dias del CLI segun el concepto', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-25T12:00:00-03:00'));

      script = createScript([
        [/comprobante/, 'Factura C'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '1000'],
        [/Agregamos/, ['Fecha del comprobante']],
        [/Fecha del comprobante/, '31/10'],
      ]);

      const session = createSession();
      const state = await runWizard(invoiceSteps(session), { advanced: { currencyCode: 'ARS', sameCurrency: false } });
      const validate = script.askTextStep.mock.calls.find(([message]) => /Fecha del comprobante/.test(message))?.[1]
        ?.validate;

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session).billingDate).toBe('31/10');
      // Servicios: hasta 10 dias antes o despues de hoy.
      expect(validate?.('4/11')).toBe(true);
      expect(validate?.('10/11')).toMatch(/fuera de rango/);
      expect(validate?.('32/10')).toMatch(/Fecha inválida/);
    });

    it('identifica al receptor por CUIL, sin consultar el padron', async () => {
      script = createScript([
        [/comprobante/, 'Factura B'],
        [/A quién/, 'Con CUIL'],
        [/CUIL del receptor/, '20-33333333-4'],
        [/Condición frente al IVA del receptor/, 'Consumidor final'],
        [/Qué estás facturando/, 'Productos'],
        [/Monto total/, '1210'],
        [/Agregamos/, []],
      ]);

      const getTaxpayerDetails = vi.fn();
      const session = createSession([], { registerInscriptionProofService: { getTaxpayerDetails } });
      const state = await runWizard(invoiceSteps(session), { advanced: { currencyCode: 'ARS', sameCurrency: false } });

      expect(getTaxpayerDetails).not.toHaveBeenCalled();
      expect(buildInvoiceInput(state as NonNullable<typeof state>, session)).toMatchObject({
        documentNumber: 20333333334,
        documentType: 'cuil',
        ivaCondition: 'consumidor-final',
      });
    });

    it('factura en euros con la cotizacion acordada', async () => {
      script = createScript([
        [/comprobante/, 'Factura C'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '100'],
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, 'Euros (EUR)'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de EUR/, '1.450,50'],
      ]);

      const session = createSession();
      const state = await runWizard(invoiceSteps(session), { advanced: { currencyCode: 'ARS', sameCurrency: false } });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session)).toMatchObject({
        currencyCode: 'EUR',
        exchangeRate: 1450.5,
        sameCurrency: false,
      });
      expect(onlyChoices(script.chooseStep.mock.calls.at(-2)?.[1] ?? []).map((choice) => choice.name)).toContain(
        'Reales (BRL)',
      );
    });

    it('si se cambia a productos no quedan las fechas de servicio ya elegidas', async () => {
      script = createScript([
        [/comprobante/, 'Factura C'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '100'],
        [/Agregamos/, ['Período', 'Vencimiento']],
        [/Servicio desde/, '1/10'],
        [/Servicio hasta/, '31/10'],
        [/Vencimiento del pago/, '10/11'],
      ]);

      const session = createSession();
      const steps = invoiceSteps(session);
      const state = await runWizard(steps, { advanced: { currencyCode: 'ARS', sameCurrency: false } });

      expect(state?.advanced).toMatchObject({ paymentDueDate: '10/11', serviceStartDate: '1/10' });

      script = createScript([[/Agregamos/, []]]);

      const advancedStep = steps.find((step) => step.name === 'avanzadas');
      const update = await advancedStep?.run({ ...(state as NonNullable<typeof state>), concept: 'productos' });

      expect(update).toMatchObject({
        advanced: { paymentDueDate: undefined, serviceEndDate: undefined, serviceStartDate: undefined },
      });
    });

    it('volver en la primera pregunta sale del flujo', async () => {
      script = createScript([[/comprobante/, BACK]]);

      expect(
        await runWizard(invoiceSteps(createSession()), { advanced: { currencyCode: 'ARS', sameCurrency: false } }),
      ).toBeUndefined();
    });
  });

  describe('repetir factura', () => {
    const today = new Date('2026-10-05T15:00:00Z');

    it('copia receptor, concepto, monto y alicuota con el periodo del mes pasado', async () => {
      script = createScript([
        [/comprobante querés repetir/, 'Factura A'],
        [/Cuál repetimos/, '00003-00000014'],
        [/Condición frente al IVA/, 'Responsable inscripto'],
        [/Mismo monto/, 'Sí'],
        [/Período del servicio/, 'El mes pasado'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ documentNumber: 30709965812, documentTypeCode: 80 })]);
      const state = await runWizard(repeatSteps(session, 3, today), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
      });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session)).toMatchObject({
        concept: 'servicios',
        documentNumber: 30709965812,
        documentType: 'cuit',
        ivaCondition: 'responsable-inscripto',
        ivaRate: undefined,
        serviceEndDate: '30/09/2026',
        serviceStartDate: '01/09/2026',
        shortcut: 'fa',
        totalAmount: 121,
      });
      expect(script.chooseManyStep.mock.calls[0][1]).toContainEqual(
        expect.objectContaining({ description: '01/09/2026 al 30/09/2026', value: 'servicio' }),
      );
    });

    it('permite otro monto y en consumidor final no pregunta el IVA', async () => {
      script = createScript([
        [/comprobante querés repetir/, 'Factura C'],
        [/Cuál repetimos/, '00003-00000014'],
        [/Mismo monto/, 'No'],
        [/Monto total/, '2000'],
        [/Período del servicio/, 'Este mes'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ ivaAmount: 0, netAmount: 121 })]);
      const state = await runWizard(repeatSteps(session, 3, today), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
      });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session)).toMatchObject({
        documentType: 'consumidor-final',
        serviceEndDate: '31/10/2026',
        serviceStartDate: '01/10/2026',
        shortcut: 'fc',
        totalAmount: 2000,
      });
    });

    it('repite un recibo C', async () => {
      script = createScript([
        [/comprobante querés repetir/, 'Recibo C'],
        [/Cuál repetimos/, '00003-00000014'],
        [/Mismo monto/, 'Sí'],
        [/Período del servicio/, 'Este mes'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ ivaAmount: 0, netAmount: 121 })]);
      const state = await runWizard(repeatSteps(session, 3, today), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
      });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session)).toMatchObject({
        documentType: 'consumidor-final',
        shortcut: 'rc',
        totalAmount: 121,
      });
    });

    it('copia exento y no gravado de la factura', async () => {
      script = createScript([
        [/comprobante querés repetir/, 'Factura A'],
        [/Cuál repetimos/, '00003-00000014'],
        [/Condición frente al IVA/, 'Responsable inscripto'],
        [/Mismo monto/, 'Sí'],
        [/Período del servicio/, 'Solo hoy'],
        [/Agregamos/, []],
      ]);

      const session = createSession([
        invoice({ documentNumber: 30709965812, documentTypeCode: 80, exemptAmount: 50, total: 196, untaxedAmount: 25 }),
      ]);
      const state = await runWizard(repeatSteps(session, 3, today), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
      });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session)).toMatchObject({
        exemptAmount: 50,
        totalAmount: 196,
        untaxedAmount: 25,
      });
    });

    it('con varias alicuotas no ofrece el mismo monto y pide elegir la alicuota', async () => {
      script = createScript([
        [/comprobante querés repetir/, 'Factura A'],
        [/Cuál repetimos/, '00003-00000014'],
        [/Condición frente al IVA/, 'Responsable inscripto'],
        [/Monto total/, '1.210'],
        [/Período del servicio/, 'Solo hoy'],
        [/Agregamos/, []],
      ]);

      const session = createSession([
        invoice({
          documentNumber: 30709965812,
          documentTypeCode: 80,
          ivaAmount: 262.5,
          netAmount: 1500,
          total: 1762.5,
        }),
      ]);
      const state = await runWizard(repeatSteps(session, 3, today), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
      });

      expect(state?.totalAmount).toBe(1210);
      expect(script.chooseManyStep.mock.calls[0][2]).toEqual(['alicuota']);
    });

    it('si la factura era en dolares sigue en dolares y solo pide la cotizacion', async () => {
      script = createScript([
        [/comprobante querés repetir/, 'Factura C'],
        [/Cuál repetimos/, '00003-00000014'],
        [/Mismo monto/, 'Sí'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de USD/, '1.250,5'],
        [/Período del servicio/, 'Solo hoy'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ currency: 'DOL', exchangeRate: 980, ivaAmount: 0, netAmount: 121 })]);
      const state = await runWizard(repeatSteps(session, 3, today), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
      });

      // Sin marcar "Moneda extranjera", el monto sigue en dolares: antes salia como 121 pesos.
      expect(buildInvoiceInput(state as NonNullable<typeof state>, session)).toMatchObject({
        currencyCode: 'USD',
        exchangeRate: 1250.5,
        sameCurrency: false,
        totalAmount: 121,
      });
      // La moneda es la del original: no se ofrece cambiarla, porque el monto esta en esa moneda.
      expect(onlyChoices(script.chooseManyStep.mock.calls[0][1]).map((choice) => choice.value)).not.toContain(
        'divisas',
      );
      expect(script.chooseManyStep.mock.calls[0][2]).toEqual([]);
    });

    it('repite un comprobante en euros con la cotizacion oficial de ARCA', async () => {
      script = createScript([
        [/comprobante querés repetir/, 'Factura C'],
        [/Cuál repetimos/, '00003-00000014'],
        [/Mismo monto/, 'No'],
        [/Monto total en EUR/, '300'],
        [/Cómo te pagan/, 'En euros'],
        [/Período del servicio/, 'Solo hoy'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ currency: '060', exchangeRate: 1100, ivaAmount: 0, netAmount: 121 })]);
      const state = await runWizard(repeatSteps(session, 3, today), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
      });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session)).toMatchObject({
        currencyCode: 'EUR',
        exchangeRate: undefined,
        sameCurrency: true,
        totalAmount: 300,
      });
    });

    it('en pesos no pregunta la cotizacion', async () => {
      script = createScript([
        [/comprobante querés repetir/, 'Factura C'],
        [/Cuál repetimos/, '00003-00000014'],
        [/Mismo monto/, 'Sí'],
        [/Período del servicio/, 'Solo hoy'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ currency: 'PES', exchangeRate: 1, ivaAmount: 0, netAmount: 121 })]);
      const state = await runWizard(repeatSteps(session, 3, today), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
      });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session)).toMatchObject({
        currencyCode: 'ARS',
        sameCurrency: false,
      });
    });
  });

  describe('notas', () => {
    it('arma una NC por el total sobre una factura de la lista', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Factura B'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura B/, '00003-00000014'],
        [/Total o parcial/, 'Anular el total'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice()]);
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

      expect(buildNoteInput(state as NonNullable<typeof state>, session, 3)).toMatchObject({
        associatedVoucher: { cuit: '20333333334', fecha: '01/10/2026', numero: 14, puntoVenta: 3, shortcut: 'fb' },
        documentType: 'consumidor-final',
        ivaRate: undefined,
        shortcut: 'ncb',
        totalAmount: 121,
      });
    });

    it('una NC sobre una factura en dolares va en dolares y, si la anula entera, copia el exento', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Factura B'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura B/, '00003-00000014'],
        [/Total o parcial/, 'Anular el total'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ currency: 'DOL', exchangeRate: 1450, exemptAmount: 10, total: 131 })]);
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

      expect(buildNoteInput(state as NonNullable<typeof state>, session, 3)).toMatchObject({
        currencyCode: 'DOL',
        exchangeRate: 1450,
        exemptAmount: 10,
        totalAmount: 131,
      });
    });

    it('con varias alicuotas no ofrece anular el total', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Factura B'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura B/, '00003-00000014'],
        [/Monto de la nota de crédito/, '100'],
        [/Alícuota de IVA del comprobante/, '21%'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ ivaAmount: 262.5, netAmount: 1500, total: 1762.5 })]);
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });
      const input = buildNoteInput(state as NonNullable<typeof state>, session, 3);

      expect(input.totalAmount).toBe(100);
      expect(input.exemptAmount).toBeUndefined();
      expect(script.chooseStep.mock.calls.map(([message]) => message)).not.toContainEqual(
        expect.stringMatching(/Total o parcial/),
      );
    });

    it('en FCE no ofrece periodo, pregunta el IVA receptor y la anulacion', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Factura de crédito electrónica A'],
        [/Sobre qué factura de crédito electrónica A/, '00003-00000014'],
        [/Total o parcial/, 'Parcial'],
        [/Monto de la nota de crédito/, '60,50'],
        [/Condición frente al IVA/, 'Responsable inscripto'],
        [/rechazó la factura/, 'Sí'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ documentNumber: 30709965812, documentTypeCode: 80 })]);
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

      expect(buildNoteInput(state as NonNullable<typeof state>, session, 3)).toMatchObject({
        cancellation: true,
        documentNumber: 30709965812,
        ivaCondition: 'responsable-inscripto',
        shortcut: 'ncea',
        totalAmount: 60.5,
      });
      expect(script.asked.some((question) => /asociamos/.test(question))).toBe(false);
    });

    it('arma una NC C sobre un Recibo C', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Recibo C'],
        [/A qué la asociamos/, 'A un recibo'],
        [/Sobre qué recibo C/, '00003-00000014'],
        [/Total o parcial/, 'Anular el total'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ ivaAmount: 0, netAmount: 121 })]);
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

      expect(buildNoteInput(state as NonNullable<typeof state>, session, 3)).toMatchObject({
        associatedVoucher: { numero: 14, puntoVenta: 3, shortcut: 'rc' },
        shortcut: 'ncc',
        totalAmount: 121,
      });
    });

    it('arma una NC asociada a un periodo', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Factura B'],
        [/A qué la asociamos/, 'A un período'],
        [/Período desde/, '1/9'],
        [/Período hasta/, '30/9'],
        [/A quién va la nota/, 'Consumidor final'],
        [/concepto ajusta/, 'Servicios'],
        [/Monto de la nota/, '121'],
        [/Alícuota/, '21%'],
        [/Agregamos/, []],
      ]);

      const session = createSession();
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });
      const input = buildNoteInput(state as NonNullable<typeof state>, session, 3);

      expect(input).toMatchObject({
        associatedPeriod: { desde: '1/9', hasta: '30/9' },
        shortcut: 'ncb',
        totalAmount: 121,
      });
      expect(input.associatedVoucher).toBeUndefined();
    });

    it('una NC parcial suma fecha, servicio, vencimiento y exento, pero no la moneda ni la alicuota', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-25T12:00:00-03:00'));

      script = createScript([
        [/Sobre qué comprobante/, 'Factura B'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura B/, '00003-00000014'],
        [/Total o parcial/, 'Parcial'],
        [/Monto de la nota de crédito/, '60,50'],
        [/Agregamos/, ['Fecha', 'Importe exento', 'Período', 'Vencimiento']],
        [/Fecha del comprobante/, '31/10'],
        [/exenta/, '10'],
        [/no gravada/, ''],
        [/Servicio desde/, '1/10'],
        [/Servicio hasta/, '15/10'],
        [/Vencimiento del pago/, '10/11'],
      ]);

      const session = createSession([invoice({ currency: 'DOL', exchangeRate: 1450 })]);
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });
      const offered = (script.chooseManyStep.mock.calls[0][1] as ReadonlyArray<{ value: unknown }>).map(
        (choice) => choice.value,
      );

      expect(offered).toEqual(['fecha', 'exento', 'servicio', 'vencimiento']);
      expect(buildNoteInput(state as NonNullable<typeof state>, session, 3)).toMatchObject({
        billingDate: '31/10',
        currencyCode: 'DOL',
        exchangeRate: 1450,
        exemptAmount: 10,
        paymentDueDate: '10/11',
        serviceEndDate: '15/10',
        serviceStartDate: '1/10',
        totalAmount: 60.5,
      });
    });

    it('si la NC anula el total no ofrece exento, y en FCE no ofrece vencimiento', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Factura de crédito electrónica B'],
        [/Sobre qué factura de crédito electrónica B/, '00003-00000014'],
        [/Total o parcial/, 'Anular el total'],
        [/rechazó la factura/, 'No'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice()]);

      await runWizard(noteSteps(session, 3), { kind: 'credito' });

      expect(
        (script.chooseManyStep.mock.calls[0][1] as ReadonlyArray<{ value: unknown }>).map((choice) => choice.value),
      ).toEqual(['fecha', 'servicio']);
    });

    it('usa los defaults de la config: IVA receptor, concepto y alícuota en las de período, y su moneda', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Factura B'],
        [/A qué la asociamos/, 'A un período'],
        [/Período desde/, '1/9'],
        [/Período hasta/, '30/9'],
        [/A quién va la nota/, 'Con CUIT'],
        [/CUIT del receptor/, '30-70996581-2'],
        [/concepto ajusta/, 'Productos'],
        [/Monto de la nota/, '121'],
        [/Condición frente al IVA/, 'Sujeto exento'],
        [/Alícuota/, '10,5%'],
        [/Agregamos/, []],
      ]);

      const session = withConfig(createSession(), {
        alicuotaPorDefecto: '10.5',
        conceptoPorDefecto: 'productos',
        consultarPadron: false,
        ivaReceptorPorDefecto: 'sujeto-exento',
        monedaPorDefecto: 'USD',
        puntoVentaPorDefecto: 3,
      });
      const state = await runWizard(noteSteps(session, 3), {
        advanced: initialAdvancedOptions(session.runtime.config),
        kind: 'credito',
      });
      const defaultOf = (question: RegExp) =>
        script.chooseStep.mock.calls.find(([message]) => question.test(message))?.[2];

      expect(defaultOf(/concepto ajusta/)).toBe('productos');
      expect(defaultOf(/Condición frente al IVA/)).toBe('sujeto-exento');
      expect(defaultOf(/Alícuota/)).toBe('10.5');
      expect(buildNoteInput(state as NonNullable<typeof state>, session, 3)).toMatchObject({
        currencyCode: 'USD',
        ivaCondition: 'sujeto-exento',
        ivaRate: '10.5',
      });
    });

    it('sobre una factura de la que no se deduce la alícuota, propone la de la config', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Factura B'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura B/, '00003-00000014'],
        [/Monto de la nota de crédito/, '100'],
        [/Alícuota de IVA del comprobante/, '27%'],
        [/Agregamos/, []],
      ]);

      const session = withConfig(createSession([invoice({ ivaAmount: 262.5, netAmount: 1500, total: 1762.5 })]), {
        alicuotaPorDefecto: '27',
        puntoVentaPorDefecto: 3,
      });

      await runWizard(noteSteps(session, 3), { kind: 'credito' });

      expect(script.chooseStep.mock.calls.find(([message]) => /Alícuota/.test(message))?.[2]).toBe('27');
    });

    it('una ND por periodo puede ir en otra moneda', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Factura C'],
        [/A qué la asociamos/, 'A un período'],
        [/Período desde/, '1/9'],
        [/Período hasta/, '30/9'],
        [/A quién va la nota/, 'Con CUIL'],
        [/CUIL del receptor/, '20333333334'],
        [/concepto ajusta/, 'Productos'],
        [/Monto de la nota de débito/, '100'],
        [/Condición frente al IVA/, 'Consumidor final'],
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, 'Dólares estadounidenses'],
        [/Cómo te pagan/, 'En dólares'],
      ]);

      const session = createSession();
      const state = await runWizard(noteSteps(session, 3), { kind: 'debito' });

      expect(buildNoteInput(state as NonNullable<typeof state>, session, 3)).toMatchObject({
        associatedPeriod: { desde: '1/9', hasta: '30/9' },
        currencyCode: 'USD',
        documentType: 'cuil',
        sameCurrency: true,
        shortcut: 'ndc',
      });
    });

    it('si no hay facturas solo ofrece ingresarla a mano', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Factura B'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura B/, BACK],
        [/A qué la asociamos/, BACK],
        [/Sobre qué comprobante/, BACK],
      ]);

      expect(await runWizard(noteSteps(createSession([]), 3), { kind: 'debito' })).toBeUndefined();
      expect(onlyChoices(script.chooseStep.mock.calls[2][1]).map((choice) => choice.name)).toEqual([
        '# Ingresar el número a mano…',
      ]);
    });

    it('carga mas facturas, de a la cantidad configurada, y deja elegir una vieja', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Factura C'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura C/, 'Cargar más'],
        [/Sobre qué factura C/, '00003-00000003'],
        [/Total o parcial/, 'Anular el total'],
        [/Agregamos/, []],
      ]);

      const vouchers = Array.from({ length: 12 }, (_, index) => invoice({ ivaAmount: 0, number: index + 1 }));
      const session = createSession(vouchers);

      Object.assign(session.runtime.config, { comprobantesPorLista: 8 });
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });
      const [firstList, secondList] = script.chooseStep.mock.calls
        .filter(([message]) => /Sobre qué factura C/.test(message))
        .map(([, choices]) => onlyChoices(choices).map((choice) => choice.name));

      expect(firstList).toHaveLength(10);
      expect(firstList).toContain('+ Cargar más…');
      // Mientras carga, la misma lista con "Cargando…" en lugar del boton.
      const loadingList = script.chooseStepWhileLoading.mock.calls[0][1] as ReadonlyArray<{
        name?: string;
        separator?: string;
      }>;

      expect(loadingList.some((item) => stripAnsi(item.separator ?? '').includes('Cargando…'))).toBe(true);
      expect(loadingList.some((item) => item.name === '+ Cargar más…')).toBe(false);
      // Ya estan las 12: no ofrece cargar mas.
      expect(secondList).toHaveLength(13);
      expect(secondList).not.toContain('+ Cargar más…');
      expect(buildNoteInput(state as NonNullable<typeof state>, session, 3).associatedVoucher).toMatchObject({
        numero: 3,
        puntoVenta: 3,
      });
    });

    it('ingresa a mano una factura de otro punto de venta', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Factura C'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura C/, 'Ingresar el número a mano'],
        [/Punto de venta/, '5'],
        [/^Número/, '14'],
        [/Total o parcial/, 'Anular el total'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ ivaAmount: 0 })]);
      const getVoucher = vi.spyOn(session.historyGateway, 'getVoucher');
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

      expect(getVoucher).toHaveBeenLastCalledWith(14, 5, 11);
      expect(buildNoteInput(state as NonNullable<typeof state>, session, 3)).toMatchObject({
        associatedVoucher: { numero: 14, puntoVenta: 5, shortcut: 'fc' },
        shortcut: 'ncc',
        totalAmount: 121,
      });
    });

    it('si la factura ingresada a mano no existe vuelve a la lista', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Factura C'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura C/, 'Ingresar el número a mano'],
        [/Punto de venta/, '3'],
        [/^Número/, '99'],
        [/Sobre qué factura C/, '00003-00000014'],
        [/Total o parcial/, 'Anular el total'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ ivaAmount: 0 })]);
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

      expect(state?.invoice?.number).toBe(14);
    });
  });

  describe('consultar comprobantes', () => {
    function capture(): () => string {
      let printed = '';

      vi.mocked(process.stdout.write).mockImplementation((chunk) => {
        printed += String(chunk);
        return true;
      });

      return () => printed;
    }

    it('lista cualquier tipo, muestra el detalle y vuelve a la lista', async () => {
      script = createScript([
        [/Qué comprobantes querés consultar/, 'Nota de crédito B'],
        [/Qué nota de crédito B querés ver/, '00003-00000014'],
        [/Qué nota de crédito B querés ver/, BACK],
      ]);

      const printed = capture();
      const session = createSession([invoice()]);
      const getLastNumber = vi.spyOn(session.historyGateway, 'getLastNumber');

      await runHistoryFlow(session);

      expect(printed()).toContain('86400940834693');
      expect(getLastNumber).toHaveBeenCalledWith(3, 8);
      // El listado va entre lineas punteadas; buscar a mano queda afuera.
      const choices = script.chooseStep.mock.calls[1][1] as ReadonlyArray<{
        name?: string;
        separator?: string;
        short?: string;
      }>;
      const names = choices.map((item) => (item.separator === undefined ? item.name : stripAnsi(item.separator)));

      expect(names[0]).toMatch(/^┈+$/);
      expect(names[1]).toContain('CAE 86400940834693');
      // Al elegirla, la respuesta muestra solo el numero.
      expect(choices[1]?.short).toBe('00003-00000014');
      expect(names.slice(2)).toEqual([expect.stringMatching(/^┈+$/), ' ', '# Ingresar el número a mano…']);
      // La lista se arma una sola vez: volver del detalle no consulta ARCA de nuevo.
      expect(getLastNumber).toHaveBeenCalledTimes(1);
    });

    it('busca uno por numero en otro punto de venta', async () => {
      script = createScript([
        [/Qué comprobantes querés consultar/, 'Factura B'],
        [/Qué factura B querés ver/, 'Ingresar el número a mano'],
        [/Punto de venta/, '7'],
        [/^Número/, '14'],
        [/Qué factura B querés ver/, BACK],
      ]);

      const printed = capture();

      await runHistoryFlow(createSession([invoice()]));

      expect(printed()).toContain('00007-00000014');
    });

    it('volver sale sin consultar', async () => {
      script = createScript([[/Qué comprobantes/, BACK]]);

      await runHistoryFlow(createSession([invoice()]));
    });
  });
});
