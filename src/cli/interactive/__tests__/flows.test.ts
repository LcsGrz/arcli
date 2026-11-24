import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingService } from '../../../modules/billing/billing.service';
import { getVoucherKindByShortcut, VOUCHER_KIND_MAP } from '../../../modules/billing/voucher-kind-map';
import { initialAdvancedOptions } from '../../../modules/interactive/billing-optionals';
import { buildEquivalentCommand } from '../../../modules/interactive/equivalent-command';
import { buildInvoiceInput, type InvoiceState } from '../../../modules/interactive/invoice-input';
import { buildNoteInput } from '../../../modules/interactive/note-input';
import { BACK, runWizard } from '../../../modules/interactive/wizard';
import type { IssuedVoucher, VoucherHistoryGateway } from '../../../modules/vouchers/voucher-history';
import type { ArcaClient } from '../../../services/arca/arca-client.factory';
import { ArcaVoucherHistoryGateway } from '../../../services/arca/arca-voucher-history.gateway';
import { systemClock } from '../../../services/time/system-clock';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
import { runExportFlow } from '../export.flow';
import { runExportNoteFlow } from '../export-note.flow';
import { runExportRepeatFlow } from '../export-repeat.flow';
import { runHistoryFlow } from '../history.flow';
import { invoiceStateForReceiver, invoiceSteps, runInvoiceFlow } from '../invoice.flow';
import { noteInputEnv, noteSteps, noteWarnings } from '../note.flow';
import { repeatSteps } from '../repeat.flow';
import type { InteractiveSession } from '../session';
import { cbuSteps, offerSavingCbu } from '../steps/cbu';

import { createScript, onlyChoices } from './script';

let script = createScript([]);

vi.mock('../export.flow', () => ({ runExportFlow: vi.fn(async () => undefined) }));
vi.mock('../export-repeat.flow', () => ({ runExportRepeatFlow: vi.fn(async () => undefined) }));
vi.mock('../export-note.flow', () => ({ runExportNoteFlow: vi.fn(async () => undefined) }));

const savedConfig = vi.fn();

vi.mock('../../../modules/config/config.service', () => ({
  ConfigService: class {
    public close() {}
    public setValue(key: string, value: string) {
      savedConfig(key, value);
    }
  },
}));

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  chooseStepWhileLoading: (...args: Parameters<typeof script.chooseStepWhileLoading>) =>
    script.chooseStepWhileLoading(...args),
  confirm: (message: string, yesLabel: string, noLabel = 'Cancelar') =>
    script.chooseStep(message, [
      { name: yesLabel, value: true },
      { name: noLabel, value: false },
    ]),
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
      cuit: 20333333334,
      environment: 'testing',
      outputJson: false,
      outputRaw: false,
      pointOfSale: 3,
    } as unknown as CliArcaRuntime,
    service: new BillingService({ clock: systemClock }),
  };
}

/** La misma sesion con otra config (y su punto de venta, como lo resuelve `loadArcaProfile`). */
function withConfig(session: InteractiveSession, config: Record<string, unknown>): InteractiveSession {
  const merged = { ...session.runtime.config, ...config } as CliArcaRuntime['config'];

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
      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({
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
      // La cotizacion guardada (deprecada) va marcada como de la config: la vista previa avisa como con flags (#14).
      expect(initialAdvancedOptions({ cotizacionPorDefecto: 1200, monedaPorDefecto: 'EUR' })).toEqual({
        currencyCode: 'EUR',
        exchangeRate: 1200,
        exchangeRateSource: 'config',
        sameCurrency: false,
      });
    });

    describe('con el receptor de "Datos de un CUIT"', () => {
      const receiver = {
        address: 'Av. Siempreviva 742',
        cuit: 20201797064,
        ivaCondition: 'responsable-inscripto' as const,
        name: 'Empresa de Ejemplo SRL',
      };

      it('no pregunta el receptor ni la condición IVA si sirve para la letra, y no ofrece la E', async () => {
        script = createScript([
          [/comprobante/, 'Factura A'],
          [/Qué estás facturando/, 'Servicios'],
          [/Monto total/, '1000'],
          [/Agregamos/, []],
        ]);

        const session = createSession();
        const state = await runWizard(invoiceSteps(session), {
          advanced: initialAdvancedOptions(session.runtime.config),
          ...invoiceStateForReceiver(receiver),
        });
        const kinds = onlyChoices(script.chooseStep.mock.calls[0][1]).map((choice) => choice.name);

        expect(kinds.some((name) => name.includes('exportación'))).toBe(false);
        expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({
          documentNumber: 20201797064,
          documentType: 'cuit',
          ivaCondition: 'responsable-inscripto',
          ivaConditionSource: 'padron',
          receiverAddress: 'Av. Siempreviva 742',
          receiverName: 'Empresa de Ejemplo SRL',
        });
      });

      it('si la condición del padrón no sirve para la letra, la pregunta', async () => {
        script = createScript([
          [/comprobante/, 'Factura B'],
          [/Condición frente al IVA de Empresa de Ejemplo SRL/, 'Sujeto exento'],
          [/Qué estás facturando/, 'Servicios'],
          [/Monto total/, '1000'],
          [/Agregamos/, []],
        ]);

        const session = createSession();
        const state = await runWizard(invoiceSteps(session), {
          advanced: initialAdvancedOptions(session.runtime.config),
          ...invoiceStateForReceiver(receiver),
        });

        expect(state).toMatchObject({ documentNumber: 20201797064, ivaCondition: 'sujeto-exento' });
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
      const input = buildInvoiceInput(state as NonNullable<typeof state>, session.runtime);

      expect(input).toMatchObject({
        concept: 'productos',
        documentType: 'consumidor-final',
        ivaCondition: 'consumidor-final',
        shortcut: 'fc',
        totalAmount: 1500.5,
      });
      expect(script.asked.some((question) => /alicuota/i.test(question))).toBe(false);
    });

    it('"Emitir recibo" pregunta la letra entre los recibos, de C a A, sin facturas', async () => {
      script = createScript([
        [/Qué recibo querés emitir/, 'Recibo C'],
        [/A quién le hacés el recibo/, 'Consumidor final'],
        [/Qué estás cobrando/, 'Productos'],
        [/Monto total/, '2000'],
        [/Agregamos/, []],
      ]);

      const session = createSession();
      const state = await runWizard(invoiceSteps(session), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
        receipt: true,
      });
      const kinds = onlyChoices(script.chooseStep.mock.calls[0][1]).map((choice) =>
        stripAnsi(choice.name).replace(' (nuevo)', ''),
      );

      expect(kinds).toEqual(['Recibo C', 'Recibo B', 'Recibo A']);
      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({
        concept: 'productos',
        documentType: 'consumidor-final',
        shortcut: 'rc',
        totalAmount: 2000,
      });
    });

    it('arma un Recibo A con CUIT y condicion IVA, como la Factura A', async () => {
      script = createScript([
        [/Qué recibo querés emitir/, 'Recibo A'],
        [/A quién le hacés el recibo/, 'Con CUIT'],
        [/CUIT del receptor/, '30-70996581-2'],
        [/Condición frente al IVA/, 'Responsable inscripto'],
        [/Qué estás cobrando/, 'Servicios'],
        [/Monto total/, '1210'],
        [/Agregamos/, []],
      ]);

      const session = createSession();
      const state = await runWizard(invoiceSteps(session), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
        receipt: true,
      });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({
        documentNumber: 30709965812,
        documentType: 'cuit',
        ivaCondition: 'responsable-inscripto',
        shortcut: 'ra',
        totalAmount: 1210,
      });
    });

    it('arma una FCE A con CUIT y CBU, y alicuota, vencimiento y transferencia como opcionales', async () => {
      // El vencimiento no puede ser anterior a la fecha del comprobante (hoy): con el reloj fijo, el 30/10 vale (NAV-5).
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-25T12:00:00-03:00'));

      script = createScript([
        [/comprobante/, 'Factura de crédito electrónica A'],
        [/A quién/, 'Con CUIT'],
        [/CUIT del receptor/, '30-70996581-2'],
        [/Condición frente al IVA/, 'Responsable inscripto'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '1105'],
        [/CBU/, '0110599520000012345678'],
        [/Alias del CBU/, 'mi.alias.cbu'],
        [/Agregamos/, ['Modalidad', 'Alícuota', 'Vencimiento']],
        [/Alícuota/, '10,5%'],
        [/Vencimiento del pago/, '30/10'],
        [/Modalidad de transferencia/, 'ADC'],
      ]);

      const session = createSession();
      const state = await runWizard(invoiceSteps(session), { advanced: { currencyCode: 'ARS', sameCurrency: false } });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({
        cbu: '0110599520000012345678',
        cbuAlias: 'mi.alias.cbu',
        documentNumber: 30709965812,
        documentType: 'cuit',
        ivaRate: '10.5',
        paymentDueDate: '30/10/2026',
        shortcut: 'fcea',
        transferMode: 'adc',
      });
    });

    it('ofrece guardar en la config el CBU escrito a mano, como la actividad de la E', async () => {
      const state: InvoiceState = {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
        cbu: '0110599520000012345678',
        voucherKind: VOUCHER_KIND_MAP.fcea,
      };

      script = createScript([[/Guardamos el CBU en la config/, 'Sí, guardar']]);
      await offerSavingCbu(createSession().runtime.config, state, true);
      expect(savedConfig).toHaveBeenCalledWith('cbu', '0110599520000012345678');

      savedConfig.mockClear();
      script = createScript([[/Guardamos el CBU/, 'No']]);
      await offerSavingCbu(createSession().runtime.config, state, true);
      expect(savedConfig).not.toHaveBeenCalled();

      // Con el CBU en la config no se pregunto, asi que no hay nada que guardar.
      const withCbu = createSession();
      const configured = {
        ...withCbu,
        runtime: { ...withCbu.runtime, config: { ...withCbu.runtime.config, cbu: '0110599520000012345678' } },
      } as InteractiveSession;

      script = createScript([]);
      await offerSavingCbu(configured.runtime.config, state, true);
      await offerSavingCbu(createSession().runtime.config, { ...state, cbu: undefined }, true);

      // Con el alias escrito a mano, se guardan los dos.
      savedConfig.mockClear();
      script = createScript([[/Guardamos el CBU y el alias mi.alias.cbu/, 'Sí, guardar']]);
      await offerSavingCbu(createSession().runtime.config, { ...state, cbuAlias: 'mi.alias.cbu' }, true);
      expect(savedConfig).toHaveBeenCalledWith('cbu', '0110599520000012345678');
      expect(savedConfig).toHaveBeenCalledWith('aliasCbu', 'mi.alias.cbu');
    });

    it('pregunta el alias aunque haya uno en la config, que es de otro CBU, y Enter lo omite', async () => {
      const withAlias = createSession();
      const configured = {
        ...withAlias,
        runtime: { ...withAlias.runtime, config: { ...withAlias.runtime.config, aliasCbu: 'mi.alias.cbu' } },
      } as InteractiveSession;

      const fcea = {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
        voucherKind: getVoucherKindByShortcut('fcea'),
      } as InvoiceState;

      script = createScript([
        [/CBU del emisor/, '0110599520000012345678'],
        [/Alias del CBU/, ''],
      ]);
      await expect(runWizard(cbuSteps(configured.runtime.config), fcea)).resolves.toMatchObject({
        cbu: '0110599520000012345678',
        cbuAlias: undefined,
      });

      script = createScript([
        [/CBU del emisor/, '0110599520000012345678'],
        [/Alias del CBU/, ''],
      ]);
      await expect(runWizard(cbuSteps(createSession().runtime.config), fcea)).resolves.toMatchObject({
        cbu: '0110599520000012345678',
        cbuAlias: undefined,
      });
    });

    it('en una FCE informa el alias de la config solo con su CBU, como el CLI', () => {
      const session = createSession();
      const withAlias = {
        ...session,
        runtime: {
          ...session.runtime,
          config: { ...session.runtime.config, aliasCbu: 'mi.alias.cbu', cbu: '0110599520000012345678' },
        },
      } as InteractiveSession;
      const state = {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
        concept: 'servicios',
        documentNumber: 30709965812,
        documentType: 'cuit',
        ivaCondition: 'responsable-inscripto',
        totalAmount: 1000,
        voucherKind: getVoucherKindByShortcut('fcea'),
      } as const;

      expect(buildInvoiceInput(state as never, withAlias.runtime)).toMatchObject({ cbuAlias: 'mi.alias.cbu' });
      expect(
        buildInvoiceInput({ ...state, cbu: '0170099220000067797370' } as never, withAlias.runtime).cbuAlias,
      ).toBeUndefined();
      expect(
        buildInvoiceInput({ ...state, voucherKind: getVoucherKindByShortcut('fa') } as never, withAlias.runtime)
          .cbuAlias,
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
      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({
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

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({
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

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime).ivaRate).toBe('10.5');
      expect(script.asked.some((question) => /Alicuota/.test(question))).toBe(false);
    });

    it('volver dentro de los opcionales vuelve a la pregunta anterior, con lo respondido marcado', async () => {
      script = createScript([
        [/comprobante/, 'Factura B'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '1210'],
        [/Agregamos/, ['Alícuota', 'Período']],
        [/Alícuota/, '10,5%'],
        [/Servicio desde/, BACK],
        [/Alícuota/, BACK],
        [/Agregamos/, ['Alícuota']],
        [/Alícuota/, '10,5%'],
      ]);

      const session = createSession();
      const state = await runWizard(invoiceSteps(session), { advanced: { currencyCode: 'ARS', sameCurrency: false } });
      const input = buildInvoiceInput(state as NonNullable<typeof state>, session.runtime);
      const ivaRateDefaults = script.chooseStep.mock.calls
        .filter(([message]) => /Alícuota/.test(message))
        .map((call) => call[2]);

      expect(input.ivaRate).toBe('10.5');
      expect(input.serviceStartDate).toBeUndefined();
      // Al volver a la seleccion se ve la alicuota respondida; el periodo quedo a medias y no.
      expect(script.chooseManyStep.mock.calls[1][1]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ description: '10,5%', value: 'alicuota' }),
          expect.objectContaining({ description: 'hoy', value: 'servicio' }),
        ]),
      );
      expect(ivaRateDefaults).toEqual(['21', '10.5', '10.5']);
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

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime).totalAmount).toBe(200);
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

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime).billingDate).toBe('31/10/2026');
      // Servicios: hasta 10 dias antes o despues de hoy.
      expect(validate?.('4/11')).toBe(true);
      expect(validate?.('10/11')).toMatch(/fuera de rango/);
      expect(validate?.('32/10')).toMatch(/Fecha inválida/);
    });

    // TUI-18, tests primero: una fecha relativa queda resuelta en la entrada y en el comando equivalente.
    it('acepta `-1` en la fecha del comprobante y la guarda resuelta', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-25T12:00:00-03:00'));

      script = createScript([
        [/comprobante/, 'Factura C'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '1000'],
        [/Agregamos/, ['Fecha del comprobante']],
        [/Fecha del comprobante/, '-1'],
      ]);

      const session = createSession();
      const state = await runWizard(invoiceSteps(session), { advanced: { currencyCode: 'ARS', sameCurrency: false } });
      const options = script.askTextStep.mock.calls.find(([message]) => /Fecha del comprobante/.test(message))?.[1];
      const input = buildInvoiceInput(state as NonNullable<typeof state>, session.runtime);

      expect(input.billingDate).toBe('24/10/2026');
      expect(buildEquivalentCommand(input, { environment: 'testing', platform: 'linux' })).toContain('-f 24/10/2026');
      // La ayuda nombra las relativas, la linea de respuesta muestra la fecha y la ventana de ARCA sigue igual.
      expect(options?.inputHelp).toMatch(/hoy.*\+N.*-N/);
      expect(options?.answered?.('-1')).toBe('24/10/2026');
      expect(options?.validate?.('hoy')).toBe(true);
      expect(options?.validate?.('+11')).toMatch(/fuera de rango/);
    });

    it('identifica al receptor por CUIL, sin consultar el padron', async () => {
      script = createScript([
        [/comprobante/, 'Factura B'],
        [/A quién/, 'Con CUIL'],
        // No el CUIT emisor (20333333334): el CLI lo rechaza (10069) y, desde NAV-5, tambien la pregunta.
        [/CUIL del receptor/, '20-30123456-3'],
        [/Condición frente al IVA del receptor/, 'Consumidor final'],
        [/Qué estás facturando/, 'Productos'],
        [/Monto total/, '1210'],
        [/Agregamos/, []],
      ]);

      const getTaxpayerDetails = vi.fn();
      const session = createSession([], { registerInscriptionProofService: { getTaxpayerDetails } });
      const state = await runWizard(invoiceSteps(session), { advanced: { currencyCode: 'ARS', sameCurrency: false } });

      expect(getTaxpayerDetails).not.toHaveBeenCalled();
      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({
        documentNumber: 20301234563,
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

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({
        currencyCode: 'EUR',
        exchangeRate: 1450.5,
        sameCurrency: false,
      });
      expect(onlyChoices(script.chooseStep.mock.calls.at(-2)?.[1] ?? []).map((choice) => choice.name)).toContain(
        'Reales (BRL)',
      );
    });

    it('si se cambia a productos no quedan las fechas de servicio ya elegidas', async () => {
      // El vencimiento no puede ser anterior a la fecha del comprobante (hoy): con el reloj fijo, el 10/11 vale (NAV-5).
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-25T12:00:00-03:00'));

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

      expect(state?.advanced).toMatchObject({ paymentDueDate: '10/11/2026', serviceStartDate: '01/10/2026' });

      script = createScript([[/Agregamos/, []]]);

      const advancedStep = steps.find((step) => step.name === 'avanzadas');
      const update = await advancedStep?.run(
        { ...(state as NonNullable<typeof state>), concept: 'productos' },
        {
          memo: {
            get: () => undefined,
            set: () => undefined,
          },
        },
      );

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

    it('la factura E se elige en el mismo selector y corre su propio asistente', async () => {
      script = createScript([[/comprobante querés repetir/, 'Factura de exportación E']]);

      const state = await runWizard(repeatSteps(createSession(), 3, today), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
      });

      expect(runExportRepeatFlow).toHaveBeenCalledWith(expect.anything(), 3);
      expect(state).toMatchObject({ exported: true });
    });

    it('volver desde el asistente de la E vuelve al selector de comprobantes', async () => {
      vi.mocked(runExportRepeatFlow).mockResolvedValueOnce(BACK);
      script = createScript([
        [/comprobante querés repetir/, 'Factura de exportación E'],
        [/comprobante querés repetir/, BACK],
      ]);

      expect(
        await runWizard(repeatSteps(createSession(), 3, today), {
          advanced: { currencyCode: 'ARS', sameCurrency: false },
        }),
      ).toBeUndefined();
    });

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

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({
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

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({
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

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({
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
        [/Período del servicio/, 'Un solo día'],
        [/Agregamos/, []],
      ]);

      const session = createSession([
        invoice({ documentNumber: 30709965812, documentTypeCode: 80, exemptAmount: 50, total: 196, untaxedAmount: 25 }),
      ]);
      const state = await runWizard(repeatSteps(session, 3, today), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
      });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({
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
        [/Período del servicio/, 'Un solo día'],
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

    describe('al volver y elegir otra factura, la alícuota y el exento siguen a la factura', () => {
      /** Factura A con una sola alícuota (21%) y exento. */
      const single = invoice({
        documentNumber: 30709965812,
        documentTypeCode: 80,
        exemptAmount: 50,
        ivaAmount: 210,
        netAmount: 1000,
        number: 14,
        total: 1260,
      });
      /** Factura A con varias alícuotas: no se deduce, y la alícuota arranca marcada. */
      const several = invoice({
        documentNumber: 30709965812,
        documentTypeCode: 80,
        ivaAmount: 262.5,
        netAmount: 1500,
        number: 15,
        total: 1762.5,
      });
      /** La selección de opcionales la vez `call`: lo marcado y las descripciones. */
      const selection = (call: number) => {
        const [, choices, selected] = script.chooseManyStep.mock.calls[call] ?? [];

        return {
          descriptions: Object.fromEntries(
            onlyChoices(choices ?? []).map((choice) => [choice.value, choice.description]),
          ),
          selected,
        };
      };
      const backToInvoice = [
        [/Agregamos/, BACK],
        [/Período del servicio/, BACK],
        [/Mismo monto|Monto total/, BACK],
        [/Condición frente al IVA/, BACK],
      ] as const;

      it('con una factura de varias alícuotas, la alícuota vuelve a arrancar marcada', async () => {
        script = createScript([
          [/comprobante querés repetir/, 'Factura A'],
          [/Cuál repetimos/, '00003-00000014'],
          [/Condición frente al IVA/, 'Responsable inscripto'],
          [/Mismo monto/, 'Sí'],
          [/Período del servicio/, 'Un solo día'],
          [/Agregamos/, ['Fecha']],
          [/Fecha del comprobante/, BACK],
          ...backToInvoice,
          [/Cuál repetimos/, '00003-00000015'],
          [/Condición frente al IVA/, 'Responsable inscripto'],
          [/Monto total/, '1.000'],
          [/Período del servicio/, 'Un solo día'],
          [/Agregamos/, []],
        ]);

        await runWizard(repeatSteps(createSession([single, several]), 3, today), {
          advanced: { currencyCode: 'ARS', sameCurrency: false },
        });

        // Lo marcado que no depende de la factura sigue marcado.
        expect(selection(2).selected).toEqual(['fecha', 'alicuota']);
      });

      it('lo respondido con otra factura no pisa lo copiado de la elegida', async () => {
        script = createScript([
          [/comprobante querés repetir/, 'Factura A'],
          [/Cuál repetimos/, '00003-00000015'],
          [/Condición frente al IVA/, 'Responsable inscripto'],
          [/Monto total/, '1.000'],
          [/Período del servicio/, 'Un solo día'],
          [/Agregamos/, ['Alícuota', 'Importe exento']],
          [/Alícuota/, '10,5%'],
          [/exenta/, '300'],
          [/no gravada/, BACK],
          [/exenta/, BACK],
          [/Alícuota/, BACK],
          ...backToInvoice,
          [/Cuál repetimos/, '00003-00000014'],
          [/Condición frente al IVA/, 'Responsable inscripto'],
          [/Mismo monto/, 'Sí'],
          [/Período del servicio/, 'Un solo día'],
          [/Agregamos/, ['Alícuota']],
          [/Alícuota/, '21%'],
        ]);

        const state = await runWizard(repeatSteps(createSession([single, several]), 3, today), {
          advanced: { currencyCode: 'ARS', sameCurrency: false },
        });

        expect(selection(2)).toMatchObject({
          descriptions: { alicuota: '21%', exento: 'exento 50' },
          selected: [],
        });
        // La alícuota arranca en la deducida de la factura elegida, no en la respondida con la otra.
        expect(script.chooseStep.mock.calls.findLast(([message]) => /Alícuota/.test(message))?.[2]).toBe('21');
        expect(state?.advanced).toMatchObject({ exemptAmount: 50, ivaRate: '21' });
      });

      it('la fecha del comprobante marcada y respondida sobrevive al cambio de factura', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(today);
        script = createScript([
          [/comprobante querés repetir/, 'Factura A'],
          [/Cuál repetimos/, '00003-00000014'],
          [/Condición frente al IVA/, 'Responsable inscripto'],
          [/Mismo monto/, 'Sí'],
          [/Período del servicio/, 'Un solo día'],
          [/Agregamos/, ['Fecha', 'Período']],
          [/Fecha del comprobante/, '03/10/2026'],
          [/Servicio desde/, BACK],
          [/Fecha del comprobante/, BACK],
          ...backToInvoice,
          [/Cuál repetimos/, '00003-00000015'],
          [/Condición frente al IVA/, 'Responsable inscripto'],
          [/Monto total/, '1.000'],
          [/Período del servicio/, 'Un solo día'],
          [/Agregamos/, ['Fecha', 'Alícuota']],
          [/Fecha del comprobante/, '03/10/2026'],
          [/Alícuota/, '21%'],
        ]);

        const state = await runWizard(repeatSteps(createSession([single, several]), 3, today), {
          advanced: { currencyCode: 'ARS', sameCurrency: false },
        });

        expect(selection(2)).toMatchObject({
          descriptions: { fecha: '03/10/2026' },
          selected: ['fecha', 'alicuota', 'servicio'],
        });
        expect(
          script.askTextStep.mock.calls.findLast(([message]) => /Fecha del comprobante/.test(message))?.[1],
        ).toMatchObject({ previousAnswer: '03/10/2026' });
        expect(state?.advanced).toMatchObject({ billingDate: '03/10/2026', ivaRate: '21' });
      });
    });

    it('si la factura era en dolares sigue en dolares y solo pide la cotizacion', async () => {
      script = createScript([
        [/comprobante querés repetir/, 'Factura C'],
        [/Cuál repetimos/, '00003-00000014'],
        [/Mismo monto/, 'Sí'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de USD/, '1.250,5'],
        [/Período del servicio/, 'Un solo día'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ currency: 'DOL', exchangeRate: 980, ivaAmount: 0, netAmount: 121 })]);
      const state = await runWizard(repeatSteps(session, 3, today), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
      });

      // Sin marcar "Moneda extranjera", el monto sigue en dolares: antes salia como 121 pesos.
      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({
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
        [/Período del servicio/, 'Un solo día'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ currency: '060', exchangeRate: 1100, ivaAmount: 0, netAmount: 121 })]);
      const state = await runWizard(repeatSteps(session, 3, today), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
      });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({
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
        [/Período del servicio/, 'Un solo día'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ currency: 'PES', exchangeRate: 1, ivaAmount: 0, netAmount: 121 })]);
      const state = await runWizard(repeatSteps(session, 3, today), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
      });

      expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({
        currencyCode: 'ARS',
        sameCurrency: false,
      });
    });
  });

  describe('notas', () => {
    it('arma una NC por el total sobre una factura de la lista', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura B'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura B/, '00003-00000014'],
        [/Total o parcial/, 'Anular el total'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice()]);
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

      expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3))).toMatchObject({
        associatedVoucher: { cuit: '20333333334', fecha: '01/10/2026', numero: 14, puntoVenta: 3, shortcut: 'fb' },
        documentType: 'consumidor-final',
        ivaRate: undefined,
        shortcut: 'ncb',
        totalAmount: 121,
      });
    });

    it('una NC sobre una factura en dolares va en dolares y, si la anula entera, copia el exento', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura B'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura B/, '00003-00000014'],
        [/En qué moneda va la nota/, 'En USD, como el comprobante'],
        [/Total o parcial/, 'Anular el total'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ currency: 'DOL', exchangeRate: 1450, exemptAmount: 10, total: 131 })]);
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

      expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3))).toMatchObject({
        currencyCode: 'DOL',
        exchangeRate: 1450,
        exemptAmount: 10,
        totalAmount: 131,
      });
    });

    it('una ND sobre una factura en dolares puede ir en pesos, por una diferencia de cambio (REGLAS-4)', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura B'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura B/, '00003-00000014'],
        [/En qué moneda va la nota/, 'En pesos'],
        [/Monto de la nota de débito/, '25.000'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ currency: 'DOL', exchangeRate: 1450, total: 121 })]);
      const state = await runWizard(noteSteps(session, 3), { kind: 'debito' });

      expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3))).toMatchObject({
        currencyCode: 'PES',
        exchangeRate: undefined,
        shortcut: 'ndb',
        totalAmount: 25_000,
      });
    });

    it('una NC en pesos sobre una factura en dolares no ofrece anular el total ni tiene su tope', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura B'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura B/, '00003-00000014'],
        [/En qué moneda va la nota/, 'En pesos'],
        [/Monto de la nota de crédito/, '25.000'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ currency: 'DOL', exchangeRate: 1450, total: 121 })]);
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

      expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3))).toMatchObject({
        currencyCode: 'PES',
        totalAmount: 25_000,
      });
      expect(script.asked.some((question) => /Total o parcial/.test(question))).toBe(false);
    });

    it('sobre una factura en pesos no pregunta la moneda', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura B'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura B/, '00003-00000014'],
        [/Monto de la nota de débito/, '100'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice()]);
      const state = await runWizard(noteSteps(session, 3), { kind: 'debito' });

      expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3)).currencyCode).toBe('PES');
      expect(script.asked.some((question) => /moneda va la nota/.test(question))).toBe(false);
    });

    it('con varias alicuotas no ofrece anular el total', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura B'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura B/, '00003-00000014'],
        [/Monto de la nota de crédito/, '100'],
        [/Alícuota de IVA del comprobante/, '21%'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ ivaAmount: 262.5, netAmount: 1500, total: 1762.5 })]);
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });
      const input = buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3));

      expect(input.totalAmount).toBe(100);
      expect(input.exemptAmount).toBeUndefined();
      expect(script.chooseStep.mock.calls.map(([message]) => message)).not.toContainEqual(
        expect.stringMatching(/Total o parcial/),
      );
    });

    it('en FCE no ofrece periodo, pregunta el IVA receptor y la anulacion', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura de crédito electrónica A'],
        [/Sobre qué factura de crédito electrónica A/, '00003-00000014'],
        [/Total o parcial/, 'Parcial'],
        [/Monto de la nota de crédito/, '60,50'],
        [/Condición frente al IVA/, 'Responsable inscripto'],
        [/rechazó la factura/, 'Sí'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ documentNumber: 30709965812, documentTypeCode: 80 })]);
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

      expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3))).toMatchObject({
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
        [/Sobre qué comprobante/, 'Recibos'],
        [/Qué recibo\?/, 'Recibo C'],
        [/A qué la asociamos/, 'A un recibo'],
        [/Sobre qué recibo C/, '00003-00000014'],
        [/Total o parcial/, 'Anular el total'],
        [/Agregamos/, []],
      ]);

      const session = createSession([invoice({ ivaAmount: 0, netAmount: 121 })]);
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

      expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3))).toMatchObject({
        associatedVoucher: { numero: 14, puntoVenta: 3, shortcut: 'rc' },
        shortcut: 'ncc',
        totalAmount: 121,
      });
    });

    it('arma una NC asociada a un periodo', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura B'],
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
      const input = buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3));

      expect(input).toMatchObject({
        associatedPeriod: { desde: '01/09/2026', hasta: '30/09/2026' },
        shortcut: 'ncb',
        totalAmount: 121,
      });
      expect(input.associatedVoucher).toBeUndefined();
    });

    it('una NC parcial suma fecha, servicio, vencimiento y exento, pero no la moneda ni la alicuota', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-25T12:00:00-03:00'));

      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura B'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura B/, '00003-00000014'],
        [/En qué moneda va la nota/, 'En USD, como el comprobante'],
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
      expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3))).toMatchObject({
        billingDate: '31/10/2026',
        currencyCode: 'DOL',
        exchangeRate: 1450,
        exemptAmount: 10,
        paymentDueDate: '10/11/2026',
        serviceEndDate: '15/10/2026',
        serviceStartDate: '01/10/2026',
        totalAmount: 60.5,
      });
    });

    it('si la NC anula el total no ofrece exento, y en FCE no ofrece vencimiento', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura de crédito electrónica B'],
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
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura B'],
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
      expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3))).toMatchObject({
        currencyCode: 'USD',
        ivaCondition: 'sujeto-exento',
        ivaRate: '10.5',
      });
    });

    it('sobre una factura de la que no se deduce la alícuota, propone la de la config', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura B'],
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
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
        [/A qué la asociamos/, 'A un período'],
        [/Período desde/, '1/9'],
        [/Período hasta/, '30/9'],
        [/A quién va la nota/, 'Con CUIL'],
        [/CUIL del receptor/, '20301234563'],
        [/concepto ajusta/, 'Productos'],
        [/Monto de la nota de débito/, '100'],
        [/Condición frente al IVA/, 'Consumidor final'],
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, 'Dólares estadounidenses'],
        [/Cómo te pagan/, 'En dólares'],
      ]);

      const session = createSession();
      const state = await runWizard(noteSteps(session, 3), { kind: 'debito' });

      expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3))).toMatchObject({
        associatedPeriod: { desde: '01/09/2026', hasta: '30/09/2026' },
        currencyCode: 'USD',
        documentType: 'cuil',
        sameCurrency: true,
        shortcut: 'ndc',
      });
    });

    it('si no hay facturas solo ofrece ingresarla a mano', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura B'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura B/, BACK],
        [/A qué la asociamos/, BACK],
        [/Sobre qué comprobante/, BACK],
      ]);

      expect(await runWizard(noteSteps(createSession([]), 3), { kind: 'debito' })).toBeUndefined();
      expect(onlyChoices(script.chooseStep.mock.calls[3][1]).map((choice) => choice.name)).toEqual([
        '# Ingresar el número a mano…',
      ]);
    });

    it('carga mas facturas, de a la cantidad configurada, y deja elegir una vieja', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura C/, 'Cargar más'],
        [/Sobre qué factura C/, '00003-00000003'],
        [/Total o parcial/, 'Anular el total'],
        [/Agregamos/, []],
      ]);

      const vouchers = Array.from({ length: 12 }, (_, index) => invoice({ ivaAmount: 0, number: index + 1 }));
      const session = createSession(vouchers);

      Object.assign(session.runtime.config, { filasPorLista: 8 });
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
      expect(
        buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3)).associatedVoucher,
      ).toMatchObject({
        numero: 3,
        puntoVenta: 3,
      });
    });

    it('ingresa a mano una factura de otro punto de venta', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
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
      expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3))).toMatchObject({
        associatedVoucher: { numero: 14, puntoVenta: 5, shortcut: 'fc' },
        shortcut: 'ncc',
        totalAmount: 121,
      });
    });

    it('si la factura ingresada a mano no existe vuelve a la lista', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
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

    describe('sobre una factura de otro sistema (REGLAS-17)', () => {
      /** El unico punto de venta de web service es el 3 (`FEParamGetPtosVenta`): el 50 es de otro sistema. */
      const sessionWithOtherSystem = () => {
        const arca = {
          electronicBillingService: {
            getSalesPoints: async () => ({ resultGet: { ptoVenta: [{ bloqueado: 'N', emisionTipo: 'CAE', nro: 3 }] } }),
          },
        };

        return withConfig(createSession([invoice({ ivaAmount: 0 })], arca), {
          consultarPadron: false,
          puntoVentaPorDefecto: 3,
        });
      };

      const capturePrinted = (): (() => string) => {
        let printed = '';

        vi.mocked(process.stdout.write).mockImplementation((chunk) => {
          printed += String(chunk);
          return true;
        });

        return () => stripAnsi(printed).replace(/[│┃╏\s]+/g, ' ');
      };

      it('si no existe y su punto de venta no es de web service, avisa y pregunta lo que no puede copiar', async () => {
        const printed = capturePrinted();

        script = createScript([
          [/Sobre qué comprobante/, 'Facturas'],
          [/Qué factura\?/, 'Factura C'],
          [/A qué la asociamos/, 'A una factura'],
          [/Sobre qué factura C/, 'Ingresar el número a mano'],
          [/Punto de venta/, '50'],
          [/^Número/, '15'],
          [/^Fecha de la factura C 00050-00000015/, '10/11/2026'],
          [/A quién va la nota/, 'Con CUIT'],
          [/CUIT del receptor/, '30-70996581-2'],
          [/concepto ajusta/, 'Servicios'],
          // Sin tope: no hay total contra el cual controlar.
          [/Monto de la nota de crédito/, '50000'],
          [/Condición frente al IVA/, 'Responsable monotributo'],
          [/Agregamos/, []],
        ]);

        const session = sessionWithOtherSystem();
        const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });
        const input = buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3));

        expect(printed()).toContain(
          'ARCA no tiene la factura C N° 00050-00000015 y el punto de venta 50 no es de web service. Si es de Comprobantes en línea o de un controlador fiscal, seguí: como no se pueden copiar sus datos, te los pregunto. Si no, volvé y revisá el número.',
        );
        expect(script.asked).not.toContainEqual(expect.stringMatching(/Total o parcial/));
        expect(input).toMatchObject({
          associatedVoucher: { cuit: '20333333334', fecha: '10/11/2026', numero: 15, puntoVenta: 50, shortcut: 'fc' },
          concept: 'servicios',
          documentNumber: 30709965812,
          documentType: 'cuit',
          ivaCondition: 'responsable-monotributo',
          shortcut: 'ncc',
          totalAmount: 50000,
        });
        expect(noteWarnings(state as NonNullable<typeof state>)).toEqual([
          'No se encontró la factura C 00050-00000015 en ARCA y el punto de venta 50 no es de web service: si es de Comprobantes en línea, de un controlador fiscal o de otro sistema, está bien; si no, revisá `--ar`, `--apv` y `--ac`. No se pudo controlar que la nota de crédito no lo supere.',
        ]);
        expect(buildEquivalentCommand(input, { environment: 'testing', platform: 'linux' })).toContain(
          '--ac fc --apv 50 --ar 15 --acuit 20333333334 --afecha 10/11/2026',
        );
      });

      describe.each([600, 10005, 11002])('si ARCA contesta con el error %i (ERR-1)', (code) => {
        const failingSession = (failing: number): InteractiveSession => {
          const session = sessionWithOtherSystem();
          const find = session.historyGateway.getVoucher;
          const real = new ArcaVoucherHistoryGateway({
            genericService: {
              call: async () => ({ FECompConsultarResult: { Errors: { Err: { Code: code, Msg: 'Error de ARCA' } } } }),
            },
          } as unknown as ArcaClient);

          return {
            ...session,
            historyGateway: {
              getLastNumber: session.historyGateway.getLastNumber,
              getVoucher: (number, pointOfSale, voucherType) =>
                (number === failing ? real.getVoucher.bind(real) : find)(number, pointOfSale, voucherType),
            },
          };
        };

        it('en un punto de venta de otro sistema sigue preguntando los datos', async () => {
          capturePrinted();
          script = createScript([
            [/Sobre qué comprobante/, 'Facturas'],
            [/Qué factura\?/, 'Factura C'],
            [/A qué la asociamos/, 'A una factura'],
            [/Sobre qué factura C/, 'Ingresar el número a mano'],
            [/Punto de venta/, '50'],
            [/^Número/, '15'],
            [/^Fecha de la factura C 00050-00000015/, '10/11/2026'],
            [/A quién va la nota/, 'Con CUIT'],
            [/CUIT del receptor/, '30-70996581-2'],
            [/concepto ajusta/, 'Servicios'],
            [/Monto de la nota de crédito/, '50000'],
            [/Condición frente al IVA/, 'Responsable monotributo'],
            [/Agregamos/, []],
          ]);

          const session = failingSession(15);
          const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

          expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3))).toMatchObject({
            associatedVoucher: { fecha: '10/11/2026', numero: 15, puntoVenta: 50, shortcut: 'fc' },
            totalAmount: 50000,
          });
          expect(noteWarnings(state as NonNullable<typeof state>)).toEqual([
            `No se pudo consultar la factura C 00050-00000015 en ARCA (${code} Error de ARCA) y el punto de venta 50 no es de web service: si es de Comprobantes en línea, de un controlador fiscal o de otro sistema, está bien; si no, revisá \`--ar\`, \`--apv\` y \`--ac\`. No se pudo controlar que la nota de crédito no lo supere.`,
          ]);
        });

        it('en uno propio muestra el error y sigue en la lista, sin perder lo respondido', async () => {
          const printed = capturePrinted();
          const errors = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

          script = createScript([
            [/Sobre qué comprobante/, 'Facturas'],
            [/Qué factura\?/, 'Factura C'],
            [/A qué la asociamos/, 'A una factura'],
            [/Sobre qué factura C/, 'Ingresar el número a mano'],
            [/Punto de venta/, '3'],
            [/^Número/, '99'],
            [/Sobre qué factura C/, '00003-00000014'],
            [/Total o parcial/, 'Anular el total'],
            [/Agregamos/, []],
          ]);

          const state = await runWizard(noteSteps(failingSession(99), 3), { kind: 'credito' });

          expect(state?.invoice?.number).toBe(14);
          expect(errors.mock.calls.join('')).toContain(`${code} Error de ARCA`);
          expect(printed()).not.toMatch(/No existe|ARCA no tiene/);
        });

        it('si falla la primera tanda, la nota sigue con lo respondido: reintentar o a mano', async () => {
          capturePrinted();
          vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
          script = createScript([
            [/Sobre qué comprobante/, 'Facturas'],
            [/Qué factura\?/, 'Factura C'],
            [/A qué la asociamos/, 'A una factura'],
            [/Sobre qué factura C/, 'Volver a cargar'],
            [/Sobre qué factura C/, 'Ingresar el número a mano'],
            [/Punto de venta/, '3'],
            [/^Número/, '14'],
            [/Total o parcial/, 'Anular el total'],
            [/Agregamos/, []],
          ]);

          const state = await runWizard(noteSteps(failingSession(13), 3), { kind: 'credito' });

          expect(state).toMatchObject({ invoice: { number: 14 }, kind: 'credito' });
        });
      });

      it('en A y B pregunta la alícuota y deja elegir la moneda, como en una de período', async () => {
        capturePrinted();
        script = createScript([
          [/Sobre qué comprobante/, 'Facturas'],
          [/Qué factura\?/, 'Factura B'],
          [/A qué la asociamos/, 'A una factura'],
          [/Sobre qué factura B/, 'Ingresar el número a mano'],
          [/Punto de venta/, '50'],
          [/^Número/, '15'],
          [/^Fecha de la factura B/, '10/11/2026'],
          [/A quién va la nota/, 'Consumidor final'],
          [/concepto ajusta/, 'Productos'],
          [/Monto de la nota de débito/, '100'],
          [/^Alícuota de IVA:/, '10,5%'],
          [/Agregamos/, ['Moneda extranjera']],
          [/Moneda del comprobante/, 'Dólares estadounidenses'],
          [/Cómo te pagan/, 'En dólares'],
        ]);

        const session = sessionWithOtherSystem();
        const state = await runWizard(noteSteps(session, 3), { kind: 'debito' });

        expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3))).toMatchObject({
          associatedVoucher: { fecha: '10/11/2026', numero: 15, puntoVenta: 50, shortcut: 'fb' },
          currencyCode: 'USD',
          documentType: 'consumidor-final',
          ivaRate: '10.5',
          sameCurrency: true,
          shortcut: 'ndb',
        });
        // Una ND no tiene tope: el aviso no lo menciona.
        expect(noteWarnings(state as NonNullable<typeof state>)[0]).not.toContain('nota de crédito');
      });

      it('volver desde la fecha vuelve a la lista', async () => {
        capturePrinted();
        script = createScript([
          [/Sobre qué comprobante/, 'Facturas'],
          [/Qué factura\?/, 'Factura C'],
          [/A qué la asociamos/, 'A una factura'],
          [/Sobre qué factura C/, 'Ingresar el número a mano'],
          [/Punto de venta/, '50'],
          [/^Número/, '15'],
          [/^Fecha de la factura C/, BACK],
          [/Sobre qué factura C/, '00003-00000014'],
          [/Total o parcial/, 'Anular el total'],
          [/Agregamos/, []],
        ]);

        const session = sessionWithOtherSystem();
        const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

        expect(state?.otherSystemInvoice).toBeUndefined();
        expect(noteWarnings(state as NonNullable<typeof state>)).toEqual([]);
        expect(
          buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3)).associatedVoucher,
        ).toMatchObject({
          numero: 14,
          puntoVenta: 3,
        });
      });
    });

    describe('notas sobre otras notas (NOTAS-1, TUI-12)', () => {
      /** Las opciones de la ultima vez que se pregunto `question`, sin la marca "(nuevo)". */
      const optionNames = (question: RegExp): string[] => {
        const call = script.chooseStep.mock.calls.filter(([message]) => question.test(message)).at(-1);

        return onlyChoices(call?.[1] ?? []).map((choice) => stripAnsi(choice.name).replace(' (nuevo)', ''));
      };

      /** Entra a cada familia con mas de una opcion y vuelve, para ver sus opciones. */
      const browseFamilies = () =>
        createScript([
          [/Sobre qué comprobante/, 'Facturas'],
          [/Qué factura\?/, BACK],
          [/Sobre qué comprobante/, 'Notas de crédito'],
          [/Qué nota de crédito\?/, BACK],
          [/Sobre qué comprobante/, 'Notas de débito'],
          [/Qué nota de débito\?/, BACK],
          [/Sobre qué comprobante/, BACK],
        ]);

      it('el selector agrupa por tipo de documento; las familias con opciones nuevas llevan la marca', async () => {
        script = createScript([[/Sobre qué comprobante/, BACK]]);

        await runWizard(noteSteps(createSession(), 3), { kind: 'credito' });

        const names = onlyChoices(script.chooseStep.mock.calls[0][1]).map((choice) => stripAnsi(choice.name));

        expect(names).toEqual([
          'Facturas (nuevo)',
          'Notas de crédito (nuevo)',
          'Notas de débito (nuevo)',
          'Recibos (nuevo)',
        ]);
      });

      it('en una NC: todas las facturas, las NC comunes y E, y las ND comunes, FCE y E', async () => {
        script = browseFamilies();

        await runWizard(noteSteps(createSession(), 3), { kind: 'credito' });

        expect(optionNames(/Qué factura\?/)).toEqual([
          'Factura C',
          'Factura B',
          'Factura A',
          'Factura de crédito electrónica C',
          'Factura de crédito electrónica B',
          'Factura de crédito electrónica A',
          'Factura de exportación E',
        ]);
        expect(optionNames(/Qué nota de crédito\?/)).toEqual([
          'Nota de crédito C',
          'Nota de crédito B',
          'Nota de crédito A',
          'Nota de crédito de exportación E',
        ]);
        expect(optionNames(/Qué nota de débito\?/)).toEqual([
          'Nota de débito C',
          'Nota de débito B',
          'Nota de débito A',
          'Nota de débito electrónica C',
          'Nota de débito electrónica B',
          'Nota de débito electrónica A',
          'Nota de débito de exportación E',
        ]);
      });

      it('en una ND, las NC FCE estan entre las notas de credito y las ND FCE no', async () => {
        script = browseFamilies();

        await runWizard(noteSteps(createSession(), 3), { kind: 'debito' });

        expect(optionNames(/Qué nota de crédito\?/)).toEqual([
          'Nota de crédito C',
          'Nota de crédito B',
          'Nota de crédito A',
          'Nota de crédito electrónica C',
          'Nota de crédito electrónica B',
          'Nota de crédito electrónica A',
          'Nota de crédito de exportación E',
        ]);
        expect(optionNames(/Qué nota de débito\?/)).toEqual([
          'Nota de débito C',
          'Nota de débito B',
          'Nota de débito A',
          'Nota de débito de exportación E',
        ]);
      });

      it('volver desde el segundo nivel vuelve a las familias, con la elegida marcada', async () => {
        script = createScript([
          [/Sobre qué comprobante/, 'Notas de débito'],
          [/Qué nota de débito\?/, BACK],
          [/Sobre qué comprobante/, BACK],
        ]);

        expect(await runWizard(noteSteps(createSession(), 3), { kind: 'credito' })).toBeUndefined();
        expect(script.chooseStep.mock.calls[0][2]).toBeUndefined();
        expect(script.chooseStep.mock.calls[2][2]).toBe('nota-debito');
      });

      it('los recibos tienen segundo nivel, de C a A', async () => {
        script = createScript([
          [/Sobre qué comprobante/, 'Recibos'],
          [/Qué recibo\?/, BACK],
          [/Sobre qué comprobante/, BACK],
        ]);

        await runWizard(noteSteps(createSession(), 3), { kind: 'credito' });

        expect(optionNames(/Qué recibo\?/)).toEqual(['Recibo C', 'Recibo B', 'Recibo A']);
      });

      it('arma una NC A sobre un Recibo A', async () => {
        script = createScript([
          [/Sobre qué comprobante/, 'Recibos'],
          [/Qué recibo\?/, 'Recibo A'],
          [/A qué la asociamos/, 'A un recibo'],
          [/Sobre qué recibo A/, '00003-00000014'],
          [/Total o parcial/, 'Anular el total'],
          [/Condición frente al IVA/, 'Responsable inscripto'],
          [/Agregamos/, []],
        ]);

        const session = createSession([invoice({ documentNumber: 30709965812, documentTypeCode: 80 })]);
        const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

        expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3))).toMatchObject({
          associatedVoucher: { numero: 14, puntoVenta: 3, shortcut: 'ra' },
          ivaCondition: 'responsable-inscripto',
          shortcut: 'nca',
          totalAmount: 121,
        });
      });

      it('arma una NC C sobre una ND C sin preguntar factura o periodo, con el tope de la ND', async () => {
        script = createScript([
          [/Sobre qué comprobante/, 'Notas de débito'],
          [/Qué nota de débito\?/, 'Nota de débito C'],
          [/Sobre qué nota de débito C/, '00003-00000014'],
          [/Total o parcial/, 'Parcial'],
          [/Monto de la nota de crédito/, '50'],
          [/Agregamos/, []],
        ]);

        const session = createSession([invoice({ ivaAmount: 0, netAmount: 121 })]);
        const getVoucher = vi.spyOn(session.historyGateway, 'getVoucher');
        const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

        expect(getVoucher).toHaveBeenCalledWith(14, 3, 12);
        expect(script.asked.some((question) => /asociamos/.test(question))).toBe(false);
        expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3))).toMatchObject({
          associatedVoucher: { numero: 14, puntoVenta: 3, shortcut: 'ndc' },
          shortcut: 'ncc',
          totalAmount: 50,
        });
      });

      it('el tope de una NC sobre una ND es el total de la ND, y el aviso la nombra', async () => {
        script = createScript([
          [/Sobre qué comprobante/, 'Notas de débito'],
          [/Qué nota de débito\?/, 'Nota de débito C'],
          [/Sobre qué nota de débito C/, '00003-00000014'],
          [/Total o parcial/, 'Parcial'],
          [/Monto de la nota de crédito/, '200'],
        ]);

        await expect(
          runWizard(noteSteps(createSession([invoice({ ivaAmount: 0, netAmount: 121 })]), 3), { kind: 'credito' }),
        ).rejects.toThrow('No puede superar el total de la nota de débito C 00003-00000014, de $ 121.');
      });

      it('una NC sobre otra NC no ofrece anular el total ni tiene tope', async () => {
        script = createScript([
          [/Sobre qué comprobante/, 'Notas de crédito'],
          [/Qué nota de crédito\?/, 'Nota de crédito A'],
          [/Sobre qué nota de crédito A/, '00003-00000014'],
          [/Monto de la nota de crédito/, '500'],
          [/Condición frente al IVA/, 'Responsable inscripto'],
          [/Agregamos/, []],
        ]);

        const session = createSession([invoice({ documentNumber: 30709965812, documentTypeCode: 80 })]);
        const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

        expect(script.asked.some((question) => /Total o parcial/.test(question))).toBe(false);
        expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3))).toMatchObject({
          associatedVoucher: { shortcut: 'nca' },
          shortcut: 'nca',
          totalAmount: 500,
        });
      });

      it('una ND FCE sobre una NC FCE es de anulacion, sin preguntarlo', async () => {
        script = createScript([
          [/Sobre qué comprobante/, 'Notas de crédito'],
          [/Qué nota de crédito\?/, 'Nota de crédito electrónica A'],
          [/Sobre qué nota de crédito electrónica A/, '00003-00000014'],
          [/Monto de la nota de débito/, '121'],
          [/Condición frente al IVA/, 'Responsable inscripto'],
          [/Agregamos/, []],
        ]);

        const session = createSession([invoice({ documentNumber: 30709965812, documentTypeCode: 80 })]);
        const state = await runWizard(noteSteps(session, 3), { kind: 'debito' });

        expect(script.asked.some((question) => /rechazó/.test(question))).toBe(false);
        expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3))).toMatchObject({
          associatedVoucher: { shortcut: 'ncea' },
          cancellation: true,
          shortcut: 'ndea',
        });
      });

      it('una ND FCE sobre la factura no es de anulacion, sin preguntarlo', async () => {
        script = createScript([
          [/Sobre qué comprobante/, 'Facturas'],
          [/Qué factura\?/, 'Factura de crédito electrónica A'],
          [/Sobre qué factura de crédito electrónica A/, '00003-00000014'],
          [/Monto de la nota de débito/, '121'],
          [/Condición frente al IVA/, 'Responsable inscripto'],
          [/Agregamos/, []],
        ]);

        const session = createSession([invoice({ documentNumber: 30709965812, documentTypeCode: 80 })]);
        const state = await runWizard(noteSteps(session, 3), { kind: 'debito' });

        expect(script.asked.some((question) => /rechazó/.test(question))).toBe(false);
        expect(buildNoteInput(state as NonNullable<typeof state>, noteInputEnv(session, 3))).toMatchObject({
          cancellation: false,
          shortcut: 'ndea',
        });
      });

      it('una nota E sobre otra nota E va al asistente de la E con ese asociado', async () => {
        script = createScript([
          [/Sobre qué comprobante/, 'Notas de débito'],
          [/Qué nota de débito\?/, 'Nota de débito de exportación E'],
        ]);

        const session = createSession();
        const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

        expect(state?.exported).toBe(true);
        expect(runExportNoteFlow).toHaveBeenCalledWith(
          session,
          'credito',
          expect.objectContaining({ arcaType: 20, shortcut: 'nde' }),
        );
      });

      it('volver desde el asistente de la E vuelve a la lista donde estaba la E', async () => {
        vi.mocked(runExportNoteFlow).mockResolvedValueOnce(BACK);
        script = createScript([
          [/Sobre qué comprobante/, 'Facturas'],
          [/Qué factura\?/, 'Factura de exportación E'],
          [/Qué factura\?/, BACK],
          [/Sobre qué comprobante/, BACK],
        ]);

        expect(await runWizard(noteSteps(createSession(), 3), { kind: 'credito' })).toBeUndefined();
        expect(script.chooseStep.mock.calls[2][2]).toMatchObject({ shortcut: 'fe' });
        expect(script.chooseStep.mock.calls[3][2]).toBe('factura');
      });
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
