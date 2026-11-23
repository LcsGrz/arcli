import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingService } from '../../../modules/billing/billing.service';
import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import {
  amountInPesos,
  describeConsumerIdentity,
  reachesConsumerThreshold,
  resolveReceiverIdentity,
} from '../../../modules/interactive/consumer-identification';
import { buildEquivalentCommand } from '../../../modules/interactive/equivalent-command';
import { buildInvoiceInput } from '../../../modules/interactive/invoice-input';
import { buildNoteInput } from '../../../modules/interactive/note-input';
import { BACK, runWizard } from '../../../modules/interactive/wizard';
import type { IssuedVoucher, VoucherHistoryGateway } from '../../../modules/vouchers/voucher-history';
import { systemClock } from '../../../services/time/system-clock';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
import { runInvoiceFlow } from '../invoice.flow';
import { noteInputEnv, noteSteps } from '../note.flow';
import { type RepeatState, repeatSteps } from '../repeat.flow';
import type { InteractiveSession } from '../session';

import { createScript, onlyChoices, rejecting } from './script';

/**
 * Consumidor final con datos en el asistente (REV-66): desde $ 10.000.000 (RG 5700/2025) pide su documento; antes es un
 * opcional. ARCA esta mockeado: la solicitud se mira en `buildVoucherPayload` y el comando equivalente en la salida.
 */

let script = createScript([]);

vi.mock('../export.flow', () => ({ runExportFlow: vi.fn(async () => undefined) }));
vi.mock('../export-repeat.flow', () => ({ runExportRepeatFlow: vi.fn(async () => undefined) }));
vi.mock('../export-note.flow', () => ({ runExportNoteFlow: vi.fn(async () => undefined) }));

vi.mock('../../../modules/config/config.service', () => ({
  ConfigService: class {
    public close() {}
    public setValue() {}
  },
}));

// El comando equivalente sale con las comillas de la shell del SO: POSIX fijo para que el CI en Windows espere lo mismo.
vi.mock('../../../lib/shell/shell-argument', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/shell/shell-argument')>();

  return { ...actual, formatShellCommand: (args: readonly string[]) => actual.formatShellCommand(args, 'linux') };
});

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseOne: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(args[0], args[1]),
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

const NOTICE = 'Desde $ 10.000.000, ARCA pide los datos del consumidor final.';

function createSession(vouchers: IssuedVoucher[] = [], officialRate = 1000) {
  const historyGateway: VoucherHistoryGateway = {
    getLastNumber: async () => vouchers.reduce((max, voucher) => Math.max(max, voucher.number), 0),
    getVoucher: async (number) => vouchers.find((voucher) => voucher.number === number),
  };
  const billingGateway = {
    createVoucher: vi.fn(),
    getNextVoucherNumber: vi.fn(async () => 15),
    getQuotation: vi.fn(async () => officialRate),
  };
  const service = new BillingService({ clock: systemClock });
  const session: InteractiveSession = {
    arca: {} as never,
    billingGateway,
    historyGateway,
    runtime: {
      certificateNotices: [],
      config: arcliConfigSchema.parse({
        consultarPadron: false,
        cuit: '20333333334',
        pdf: 'nunca',
        puntoVentaPorDefecto: 3,
        verificarFce: false,
      }),
      context: { cuit: 20333333334 },
      cuit: 20333333334,
      environment: 'testing',
      outputJson: false,
      outputRaw: false,
      pointOfSale: 3,
    } as unknown as CliArcaRuntime,
    service,
  };

  return { billingGateway, payload: vi.spyOn(service, 'buildVoucherPayload'), session };
}

const invoice = (overrides: Partial<IssuedVoucher> = {}): IssuedVoucher => ({
  cae: '86400940834693',
  concept: 2,
  date: '20261110',
  documentNumber: 0,
  documentTypeCode: 99,
  ivaAmount: 0,
  netAmount: 121,
  number: 14,
  total: 121,
  ...overrides,
});

function printed(): string {
  return stripAnsi(
    vi
      .mocked(process.stdout.write)
      .mock.calls.map(([chunk]) => String(chunk))
      .join(''),
  );
}

/** Las opciones de la seleccion de opcionales numero `call` (desde 0), con su descripcion y sin la marca "(nuevo)". */
function optionals(call = 0): Array<{ description?: string; name: string }> {
  return (script.chooseManyStep.mock.calls[call]?.[1] ?? []).map((choice) => ({
    description: choice.description,
    name: stripAnsi(choice.name).replace(' (nuevo)', ''),
  }));
}

/** Los campos del receptor en la solicitud a ARCA de la vista previa. */
function requestReceiver(payload: ReturnType<typeof createSession>['payload']) {
  const request = payload.mock.results.at(-1)?.value as Record<string, unknown>;

  return { CondicionIVAReceptorId: request.CondicionIVAReceptorId, DocNro: request.DocNro, DocTipo: request.DocTipo };
}

const facturaC = (amount: string) =>
  [
    [/comprobante/, 'Factura C'],
    [/A quién/, 'Consumidor final'],
    [/Qué estás facturando/, 'Servicios'],
    [/Monto total/, amount],
  ] as const;

describe('consumidor final con datos en el asistente (REV-66)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T12:00:00-03:00'));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  it('la primera pregunta ofrece "Consumidor final", sin "(sin identificar)"', async () => {
    script = createScript([
      [/comprobante/, 'Factura B'],
      [/A quién/, BACK],
      [/comprobante/, BACK],
    ]);

    await runInvoiceFlow(createSession().session);

    const call = script.chooseStep.mock.calls.find(([message]) => /A quién/.test(message));

    expect(onlyChoices(call?.[1] ?? []).map((choice) => choice.name)).toEqual([
      'Consumidor final',
      'Con CUIT',
      'Con DNI',
      'Con CUIL',
    ]);
  });

  describe('por debajo del tope', () => {
    it('con $ 9.999.999,99 no pide el documento y va sin identificar, como `--consumidor-final`', async () => {
      script = createScript([...facturaC('9.999.999,99'), [/Agregamos/, []], [/Emitimos/, 'No, dejar sin emitir']]);

      const { payload, session } = createSession();

      await runInvoiceFlow(session);

      expect(optionals()[0]).toEqual({ description: 'sin identificar', name: 'Datos del consumidor final' });
      expect(printed()).not.toContain(NOTICE);
      expect(printed()).toMatch(/arcli fc -m 9999999,99 --cs --consumidor-final --testing --emitir/);
      expect(requestReceiver(payload)).toEqual({ CondicionIVAReceptorId: 5, DocNro: 0, DocTipo: 99 });
    });

    it('"Datos del consumidor final" pide tipo y número, y va con `--dni N --ir-cf`', async () => {
      script = createScript([
        ...facturaC('5000'),
        [/Agregamos/, ['Datos del consumidor final']],
        [/Documento del consumidor final/, 'DNI'],
        [/DNI del consumidor final/, '30.123.456'],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      const { payload, session } = createSession();

      await runInvoiceFlow(session);

      expect(printed()).not.toContain(NOTICE);
      expect(printed()).toMatch(/arcli fc -m 5000 --cs --dni 30123456 --ir-cf --testing --emitir/);
      expect(requestReceiver(payload)).toEqual({ CondicionIVAReceptorId: 5, DocNro: 30123456, DocTipo: 96 });
    });

    it('la selección muestra el documento ya respondido; con CUIT, `--cuit N --ir-cf`', async () => {
      script = createScript([
        ...facturaC('5000'),
        [/Agregamos/, ['Datos del consumidor final', 'Fecha del comprobante']],
        [/Documento del consumidor final/, 'CUIT'],
        [/CUIT del consumidor final/, rejecting('30-70996581-2', ['30-70996581-3', /^El CUIT /])],
        [/Fecha del comprobante/, BACK],
        [/CUIT del consumidor final/, BACK],
        [/Documento del consumidor final/, BACK],
        [/Agregamos/, ['Datos del consumidor final']],
        [/Documento del consumidor final/, 'CUIT'],
        [/CUIT del consumidor final/, '30709965812'],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      const { payload, session } = createSession();

      await runInvoiceFlow(session);

      expect(optionals(1)[0]).toEqual({ description: 'CUIT 30-70996581-2', name: 'Datos del consumidor final' });
      expect(printed()).toMatch(/--cuit 30709965812 --ir-cf/);
      expect(requestReceiver(payload)).toEqual({ CondicionIVAReceptorId: 5, DocNro: 30709965812, DocTipo: 80 });
    });

    it('no se ofrece a otro receptor ni en la Factura A', async () => {
      script = createScript([
        [/comprobante/, 'Factura B'],
        [/A quién/, 'Con DNI'],
        [/DNI del receptor/, '30123456'],
        [/Condición frente al IVA/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '20.000.000'],
        [/Agregamos/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runInvoiceFlow(createSession().session);

      expect(optionals().map((option) => option.name)).not.toContain('Datos del consumidor final');
      expect(printed()).not.toContain(NOTICE);
      expect(printed()).toMatch(/--dni 30123456 --ir-cf/);
    });
  });

  describe('desde el tope', () => {
    it('con $ 10.000.000 justos avisa y pide el documento después del monto; rechaza un DNI inválido', async () => {
      script = createScript([
        ...facturaC('10.000.000'),
        [/Documento del consumidor final/, 'DNI'],
        [
          /DNI del consumidor final/,
          rejecting('30123456', ['12345', /^El DNI tiene de 6 a 8 dígitos\.$/], ['123456789', /de 6 a 8/]),
        ],
        [/Agregamos/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      const { payload, session } = createSession();

      await runInvoiceFlow(session);

      expect(printed()).toContain(NOTICE);
      // Ya identificado: los opcionales no lo vuelven a ofrecer.
      expect(optionals().map((option) => option.name)).not.toContain('Datos del consumidor final');
      expect(printed()).toMatch(/arcli fc -m 10000000 --cs --dni 30123456 --ir-cf --testing --emitir/);
      expect(requestReceiver(payload)).toEqual({ CondicionIVAReceptorId: 5, DocNro: 30123456, DocTipo: 96 });
    });

    it('Volver: del número al tipo, y del tipo al monto; con un monto menor ya no lo pide', async () => {
      script = createScript([
        ...facturaC('12.000.000'),
        [/Documento del consumidor final/, 'DNI'],
        [/DNI del consumidor final/, BACK],
        [/Documento del consumidor final/, BACK],
        [/Monto total/, '1000'],
        [/Agregamos/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      const { payload, session } = createSession();

      await runInvoiceFlow(session);

      expect(script.chooseStep.mock.calls.filter(([message]) => /Documento del/.test(message))[1]?.[2]).toBe('dni');
      expect(printed()).toMatch(/arcli fc -m 1000 --cs --consumidor-final/);
      expect(requestReceiver(payload)).toEqual({ CondicionIVAReceptorId: 5, DocNro: 0, DocTipo: 99 });
    });

    it('volver al monto y subirlo de nuevo ofrece el DNI escrito antes', async () => {
      script = createScript([
        ...facturaC('12.000.000'),
        [/Documento del consumidor final/, 'DNI'],
        [/DNI del consumidor final/, '30123456'],
        [/Agregamos/, BACK],
        [/DNI del consumidor final/, BACK],
        [/Documento del consumidor final/, BACK],
        [/Monto total/, '15.000.000'],
        [/Documento del consumidor final/, 'DNI'],
        [/DNI del consumidor final/, '30123456'],
        [/Agregamos/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runInvoiceFlow(createSession().session);

      const typed = script.askTextStep.mock.calls.filter(([message]) => /DNI del consumidor/.test(message));

      expect(typed.at(-1)?.[1]?.previousAnswer).toBe('30123456');
      expect(printed()).toMatch(/-m 15000000 --cs --dni 30123456 --ir-cf/);
    });

    it('cambiar a otro receptor no deja el documento del consumidor final', async () => {
      script = createScript([
        [/comprobante/, 'Factura C'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '12.000.000'],
        [/Documento del consumidor final/, 'DNI'],
        [/DNI del consumidor final/, BACK],
        [/Documento del consumidor final/, BACK],
        [/Monto total/, BACK],
        [/Qué estás facturando/, BACK],
        [/A quién/, 'Con CUIL'],
        [/CUIL del receptor/, '20-12345678-6'],
        [/Condición frente al IVA/, 'Sujeto exento'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '12.000.000'],
        [/Agregamos/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runInvoiceFlow(createSession().session);

      expect(printed()).toMatch(/--cuil 20123456786 --ir sujeto-exento/);
    });
  });

  describe('moneda extranjera: se sabe después de los opcionales', () => {
    it('USD × cotización acordada que llega al tope: lo pide después de los opcionales', async () => {
      script = createScript([
        ...facturaC('10.000'),
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, '(USD)'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de USD/, '1.000'],
        [/Documento del consumidor final/, 'DNI'],
        [/DNI del consumidor final/, '30123456'],
        // Se escribio en pesos y se cambio a dólares: vuelve al monto (REV-74, #12).
        [/Monto total en USD/, '10.000'],
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, '(USD)'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de USD/, '1.000'],
        [/Documento del consumidor final/, 'DNI'],
        [/DNI del consumidor final/, '30123456'],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      const { payload, session } = createSession();

      await runInvoiceFlow(session);

      expect(printed()).toContain(NOTICE);
      expect(printed()).toMatch(/--dni 30123456 --ir-cf .*--moneda USD --cm 1000/);
      expect(requestReceiver(payload)).toEqual({ CondicionIVAReceptorId: 5, DocNro: 30123456, DocTipo: 96 });
    });

    it('volver desde el documento lleva a los opcionales', async () => {
      script = createScript([
        ...facturaC('10.000'),
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, '(USD)'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de USD/, '1.000'],
        [/Documento del consumidor final/, BACK],
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, '(USD)'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de USD/, '999'],
        // Se escribio en pesos y se cambio a dólares: vuelve al monto (REV-74, #12).
        [/Monto total en USD/, '10.000'],
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, '(USD)'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de USD/, '999'],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runInvoiceFlow(createSession().session);

      expect(printed()).toMatch(/--consumidor-final .*--cm 999/);
    });

    it('cobrada en dólares: consulta la cotización oficial y, si llega al tope, lo pide', async () => {
      script = createScript([
        ...facturaC('10.000'),
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, '(USD)'],
        [/Cómo te pagan/, 'En dólares'],
        [/Documento del consumidor final/, 'CUIL'],
        [/CUIL del consumidor final/, '20-12345678-6'],
        // Se escribio en pesos y se cambio a dólares: vuelve al monto (REV-74, #12).
        [/Monto total en USD/, '10.000'],
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, '(USD)'],
        [/Cómo te pagan/, 'En dólares'],
        [/Documento del consumidor final/, 'CUIL'],
        [/CUIL del consumidor final/, '20-12345678-6'],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      const { billingGateway, session } = createSession([], 1000);

      await runInvoiceFlow(session);

      expect(billingGateway.getQuotation).toHaveBeenCalled();
      expect(printed()).toMatch(/--cuil 20123456786 --ir-cf .*--misma-moneda/);
    });

    it('cobrada en dólares por debajo del tope con la oficial: no lo pide', async () => {
      script = createScript([
        ...facturaC('10.000'),
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, '(USD)'],
        [/Cómo te pagan/, 'En dólares'],
        // Se escribio en pesos y se cambio a dólares: vuelve al monto (REV-74, #12).
        [/Monto total en USD/, '10.000'],
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, '(USD)'],
        [/Cómo te pagan/, 'En dólares'],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runInvoiceFlow(createSession([], 999).session);

      expect(printed()).not.toContain(NOTICE);
      expect(printed()).toMatch(/--consumidor-final .*--misma-moneda/);
    });

    it('ya identificado en los opcionales: no lo vuelve a pedir', async () => {
      script = createScript([
        ...facturaC('10.000'),
        [/Agregamos/, ['Datos del consumidor final', 'Moneda extranjera']],
        [/Documento del consumidor final/, 'DNI'],
        [/DNI del consumidor final/, '30123456'],
        [/Moneda del comprobante/, '(USD)'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de USD/, '1.500'],
        // Se escribio en pesos y se cambio a dólares: vuelve al monto (REV-74, #12).
        [/Monto total en USD/, '10.000'],
        [/Agregamos/, ['Datos del consumidor final', 'Moneda extranjera']],
        [/Documento del consumidor final/, 'DNI'],
        [/DNI del consumidor final/, '30123456'],
        [/Moneda del comprobante/, '(USD)'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de USD/, '1.500'],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      const { payload, session } = createSession();

      await runInvoiceFlow(session);

      expect(printed()).not.toContain(NOTICE);
      expect(requestReceiver(payload)).toEqual({ CondicionIVAReceptorId: 5, DocNro: 30123456, DocTipo: 96 });
    });
  });

  it('Recibo B desde el tope: lo pide después del monto y arma `arcli rb`', async () => {
    script = createScript([
      [/Qué recibo/, 'Recibo B'],
      [/A quién le hacés el recibo/, 'Consumidor final'],
      [/Qué estás cobrando/, 'Servicios'],
      [/Monto total/, '12.100.000'],
      [/Documento del consumidor final/, 'DNI'],
      [/DNI del consumidor final/, '30123456'],
      [/Agregamos/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    const { payload, session } = createSession();

    await runInvoiceFlow(session, true);

    expect(printed()).toContain(NOTICE);
    expect(printed()).toMatch(/arcli rb -m 12100000 --cs --dni 30123456 --ir-cf/);
    expect(requestReceiver(payload)).toEqual({ CondicionIVAReceptorId: 5, DocNro: 30123456, DocTipo: 96 });
  });

  describe('Repetir', () => {
    async function repeat(session: InteractiveSession) {
      const state = await runWizard(repeatSteps(session, 3, new Date('2026-11-18T12:00:00-03:00')), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
      } satisfies RepeatState);

      return state && buildInvoiceInput(state, session.runtime);
    }

    it('a consumidor final con un monto nuevo desde el tope: pide el documento', async () => {
      script = createScript([
        [/comprobante querés repetir/, 'Factura C'],
        [/Cuál repetimos/, '00003-00000014'],
        [/Mismo monto/, 'No'],
        [/Monto total/, '10.000.000'],
        [/Documento del consumidor final/, 'DNI'],
        [/DNI del consumidor final/, '30123456'],
        [/Período del servicio/, 'Un solo día'],
        [/Agregamos/, []],
      ]);

      const { session } = createSession([invoice()]);
      const input = await repeat(session);

      expect(printed()).toContain(NOTICE);
      expect(input).toMatchObject({ documentNumber: 30123456, documentType: 'dni', ivaCondition: 'consumidor-final' });
      expect(buildEquivalentCommand(input!, { environment: 'testing', platform: 'linux' })).toMatch(
        /--dni 30123456 --ir-cf/,
      );
    });

    it('con el mismo monto, por debajo del tope, no lo pide y lo ofrece en los opcionales', async () => {
      script = createScript([
        [/comprobante querés repetir/, 'Factura C'],
        [/Cuál repetimos/, '00003-00000014'],
        [/Mismo monto/, 'Sí'],
        [/Período del servicio/, 'Un solo día'],
        [/Agregamos/, []],
      ]);

      const input = await repeat(createSession([invoice()]).session);

      expect(optionals()[0]?.description).toBe('sin identificar');
      expect(input).toMatchObject({ documentNumber: 0, documentType: 'consumidor-final' });
    });
  });

  describe('notas', () => {
    it('una nota de débito sobre una factura a consumidor final desde el tope pide el documento', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura C/, '00003-00000014'],
        [/Monto de la nota de débito/, '10.000.000'],
        [/Documento del consumidor final/, 'DNI'],
        [/DNI del consumidor final/, '30123456'],
        [/Agregamos/, []],
      ]);

      const { session } = createSession([invoice()]);
      const state = await runWizard(noteSteps(session, 3), { kind: 'debito' });
      const input = buildNoteInput(state!, noteInputEnv(session, 3));

      expect(input).toMatchObject({ documentNumber: 30123456, documentType: 'dni', ivaCondition: 'consumidor-final' });
    });

    it('sobre una factura no ofrece "Datos del consumidor final": el receptor es el de la factura', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura C/, '00003-00000014'],
        [/Monto de la nota de débito/, '100'],
        [/Agregamos/, []],
      ]);

      const { session } = createSession([invoice()]);

      await runWizard(noteSteps(session, 3), { kind: 'debito' });

      expect(optionals().map((option) => option.name)).not.toContain('Datos del consumidor final');
    });

    it('una de período la ofrece en los opcionales', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
        [/A qué la asociamos/, 'A un período'],
        [/Período desde/, '1/11/2026'],
        [/Período hasta/, '15/11/2026'],
        [/A quién va la nota/, 'Consumidor final'],
        [/Qué concepto/, 'Servicios'],
        [/Monto de la nota de crédito/, '100'],
        [/Agregamos/, ['Datos del consumidor final']],
        [/Documento del consumidor final/, 'DNI'],
        [/DNI del consumidor final/, '30123456'],
      ]);

      const { session } = createSession();
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

      expect(buildNoteInput(state!, noteInputEnv(session, 3))).toMatchObject({
        documentNumber: 30123456,
        documentType: 'dni',
        ivaCondition: 'consumidor-final',
      });
    });
  });
});

describe('el tope del consumidor final', () => {
  it('se compara en pesos: total × cotización', () => {
    expect(reachesConsumerThreshold({ currencyCode: 'ARS', totalAmount: 10_000_000 })).toBe(true);
    expect(reachesConsumerThreshold({ currencyCode: 'ARS', totalAmount: 9_999_999.99 })).toBe(false);
    expect(reachesConsumerThreshold({ currencyCode: 'USD', exchangeRate: 1000, totalAmount: 10_000 })).toBe(true);
    // Sin cotizacion (la oficial) todavia no se sabe.
    expect(amountInPesos({ currencyCode: 'USD', totalAmount: 10_000 })).toBeUndefined();
    expect(amountInPesos({ currencyCode: 'USD', exchangeRate: 1000, sameCurrency: true, totalAmount: 1 })).toBe(
      undefined,
    );
  });

  it('en pesos, pide el documento si y solo si el total llega a $ 10.000.000', () => {
    fc.assert(
      fc.property(fc.integer({ max: 100_000_000_00, min: 1 }), (cents) => {
        const totalAmount = cents / 100;

        expect(reachesConsumerThreshold({ currencyCode: 'ARS', totalAmount })).toBe(totalAmount >= 10_000_000);
      }),
    );
  });

  it('identificado va con su documento y la condición consumidor final; sin identificar, con 0', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('dni' as const, 'cuit' as const, 'cuil' as const),
        fc.integer({ max: 99_999_999_999, min: 100_000 }),
        (consumerDocumentType, consumerDocumentNumber) => {
          expect(
            resolveReceiverIdentity(
              { documentType: 'consumidor-final', ivaCondition: 'consumidor-final' },
              { consumerDocumentNumber, consumerDocumentType },
            ),
          ).toEqual({
            documentNumber: consumerDocumentNumber,
            documentType: consumerDocumentType,
            ivaCondition: 'consumidor-final',
          });
        },
      ),
    );
    expect(resolveReceiverIdentity({ documentType: 'consumidor-final', ivaCondition: 'consumidor-final' }, {})).toEqual(
      { documentNumber: 0, documentType: 'consumidor-final', ivaCondition: 'consumidor-final' },
    );
    expect(describeConsumerIdentity({ consumerDocumentNumber: 30123456, consumerDocumentType: 'dni' })).toBe(
      'DNI 30123456',
    );
  });
});
