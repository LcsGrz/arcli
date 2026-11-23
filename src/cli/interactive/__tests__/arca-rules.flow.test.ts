import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingService } from '../../../modules/billing/billing.service';
import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import { BACK, runWizard } from '../../../modules/interactive/wizard';
import type { IssuedVoucher, VoucherHistoryGateway } from '../../../modules/vouchers/voucher-history';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
import { invoiceSteps, runInvoiceFlow } from '../invoice.flow';
import { runNoteFlow } from '../note.flow';
import type { InteractiveSession } from '../session';

import { createScript, onlyChoices, rejecting } from './script';

/**
 * Las reglas de ARCA de #220 recorriendo el asistente de punta a punta: lo que ofrece cada paso, lo que rechazan sus
 * validadores y lo que frena la vista previa antes de preguntar si se emite. ARCA esta mockeado.
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

/** El CUIT que emite, el de la config. */
const EMITTER_CUIT = 20333333334;

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
  const session: InteractiveSession = {
    arca: {} as never,
    billingGateway,
    historyGateway,
    runtime: {
      certificateNotices: [],
      config: arcliConfigSchema.parse({
        consultarPadron: false,
        cuit: String(EMITTER_CUIT),
        pdf: 'nunca',
        puntoVentaPorDefecto: 3,
        verificarFce: false,
      }),
      context: { cuit: EMITTER_CUIT },
      cuit: EMITTER_CUIT,
      environment: 'testing',
      outputJson: false,
      outputRaw: false,
      pointOfSale: 3,
    } as unknown as CliArcaRuntime,
    service: new BillingService(),
  };

  return { billingGateway, session };
}

const invoice = (overrides: Partial<IssuedVoucher> = {}): IssuedVoucher => ({
  cae: '86400940834693',
  concept: 2,
  date: '20261110',
  documentNumber: 0,
  documentTypeCode: 99,
  ivaAmount: 21,
  netAmount: 100,
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

/** Las opciones que mostro la pregunta que coincide con `question`. */
function choicesOf(question: RegExp): string[] {
  const call = script.chooseStep.mock.calls.find(([message]) => question.test(message));

  return onlyChoices(call?.[1] ?? []).map((choice) => choice.name);
}

describe('reglas de ARCA en el asistente (#220)', () => {
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

  describe('a quién va el comprobante', () => {
    it.each([
      ['Factura de crédito electrónica A', 'FCE A (10015)'],
      ['Factura de crédito electrónica B', 'FCE B (10015)'],
      ['Factura de crédito electrónica C', 'FCE C (10015)'],
      ['Factura A', 'A (10013)'],
    ])('%s solo ofrece CUIT: %s', async (voucher) => {
      script = createScript([
        [/comprobante/, voucher],
        [/A quién/, BACK],
        [/comprobante/, BACK],
      ]);

      await runWizard(invoiceSteps(createSession().session), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
      });

      expect(choicesOf(/A quién/)).toEqual(['Con CUIT']);
    });

    it('la Factura B sigue ofreciendo consumidor final, DNI y CUIL', async () => {
      script = createScript([
        [/comprobante/, 'Factura B'],
        [/A quién/, BACK],
        [/comprobante/, BACK],
      ]);

      await runWizard(invoiceSteps(createSession().session), {
        advanced: { currencyCode: 'ARS', sameCurrency: false },
      });

      expect(choicesOf(/A quién/)).toEqual(
        expect.arrayContaining(['Consumidor final', 'Con CUIT', 'Con DNI', 'Con CUIL']),
      );
    });

    // Un rechazo no es una emision (#16): el CBU escrito a mano no se ofrece guardar.
    it('una FCE rechazada por ARCA no ofrece guardar el CBU escrito a mano', async () => {
      script = createScript([
        [/comprobante/, 'Factura de crédito electrónica B'],
        [/A quién/, 'Con CUIT'],
        [/CUIT del receptor/, '30-70996581-2'],
        [/Condición frente al IVA/, 'Sujeto exento'],
        [/Qué estás facturando/, 'Productos'],
        [/Monto total/, '12100'],
        [/CBU/, '0110599520000012345678'],
        [/Alias del CBU/, ''],
        [/Agregamos/, []],
        [/Emitimos/, 'Sí, emitir ahora'],
      ]);

      const { billingGateway, session } = createSession();

      billingGateway.createVoucher.mockResolvedValueOnce({
        cae: '',
        caeFchVto: '',
        response: {
          Errors: { Err: [{ Code: 10015, Msg: 'Rechazado' }] },
          FeDetResp: { FECAEDetResponse: [{ Resultado: 'R' }] },
        },
      });

      await runInvoiceFlow(session);

      expect(billingGateway.createVoucher).toHaveBeenCalledOnce();
      expect(script.asked.some((message) => /Guardamos el CBU/.test(message))).toBe(false);
    });

    it('una FCE B a un CUIT llega a la vista previa con `--cuit` en el comando equivalente', async () => {
      script = createScript([
        [/comprobante/, 'Factura de crédito electrónica B'],
        [/A quién/, 'Con CUIT'],
        [/CUIT del receptor/, '30-70996581-2'],
        [/Condición frente al IVA/, 'Sujeto exento'],
        [/Qué estás facturando/, 'Productos'],
        [/Monto total/, '12100'],
        [/CBU/, '0110599520000012345678'],
        [/Alias del CBU/, ''],
        [/Agregamos/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      const { billingGateway, session } = createSession();

      await runInvoiceFlow(session);

      expect(billingGateway.createVoucher).not.toHaveBeenCalled();
      expect(printed()).toMatch(/arcli fceb .*--cuit 30709965812/);
    });
  });

  describe('DNI del receptor: de 6 a 8 dígitos', () => {
    it('rechaza 5 y 9 dígitos con el mensaje, vuelve a preguntar y acepta 6', async () => {
      script = createScript([
        [/comprobante/, 'Factura B'],
        [/A quién/, 'Con DNI'],
        [
          /DNI del receptor/,
          rejecting(
            '123456',
            ['12345', /^El DNI tiene de 6 a 8 dígitos\.$/],
            ['123456789', /^El DNI tiene de 6 a 8 dígitos\.$/],
          ),
        ],
        [/Condición frente al IVA/, 'Consumidor final'],
        [/Qué estás facturando/, 'Productos'],
        [/Monto total/, '1210'],
        [/Agregamos/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      const { billingGateway, session } = createSession();

      await runInvoiceFlow(session);

      expect(billingGateway.createVoucher).not.toHaveBeenCalled();
      expect(printed()).toMatch(/arcli fb .*--dni 123456\b/);
    });

    it('acepta 8 dígitos con puntos', async () => {
      script = createScript([
        [/comprobante/, 'Factura B'],
        [/A quién/, 'Con DNI'],
        [/DNI del receptor/, '12.345.678'],
        [/Condición frente al IVA/, 'Consumidor final'],
        [/Qué estás facturando/, 'Productos'],
        [/Monto total/, '1210'],
        [/Agregamos/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runInvoiceFlow(createSession().session);

      expect(printed()).toMatch(/--dni 12345678\b/);
    });
  });

  describe('la vista previa frena antes de preguntar si se emite', () => {
    /** Lo que se escribe en stderr (el error de la vista previa), sin mostrarlo en la salida de los tests. */
    function captureStderr(): () => string {
      const chunks: string[] = [];

      vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        chunks.push(String(chunk));

        return true;
      });

      // Sin bordes ni cortes de linea: un error largo se parte en el panel.
      return () =>
        stripAnsi(chunks.join(''))
          .replace(/[\u2500-\u257f]/g, ' ')
          .replace(/\s+/g, ' ');
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    // REV-75 (NAV-5): ya no llega a la vista previa, la pregunta lo frena con la misma regla que el CLI.
    it('el receptor con el CUIT que emite (10069) se frena al preguntar el CUIT', async () => {
      script = createScript([
        [/comprobante/, 'Factura A'],
        [/A quién/, 'Con CUIT'],
        [/CUIT del receptor/, '20-33333333-4'],
      ]);

      const { billingGateway, session } = createSession();

      await expect(runInvoiceFlow(session)).rejects.toThrow(
        '"20-33333333-4" no pasa la validacion de "CUIT del receptor:": El receptor no puede ser el mismo CUIT que emite (20333333334): ARCA lo rechaza (error 10069).',
      );
      expect(billingGateway.createVoucher).not.toHaveBeenCalled();
    });

    it('una B al No Categorizado con importe gravado (10067)', async () => {
      script = createScript([
        [/comprobante/, 'Factura B'],
        [/A quién/, 'Con CUIT'],
        [/CUIT del receptor/, '23-00000000-0'],
        [/Condición frente al IVA/, 'Consumidor final'],
        [/Qué estás facturando/, 'Productos'],
        [/Monto total/, '1210'],
        [/Agregamos/, []],
        // La vista previa lo rechaza: muestra el error y vuelve a la última pregunta, con todo (TUI-15). De ahí, Esc
        // hasta el primer paso.
        [/Agregamos/, BACK],
        [/Monto total/, BACK],
        [/Qué estás facturando/, BACK],
        [/Condición frente al IVA/, BACK],
        [/CUIT del receptor/, BACK],
        [/A quién/, BACK],
        [/comprobante/, BACK],
      ]);

      const { billingGateway, session } = createSession();
      const errors = captureStderr();

      await expect(runInvoiceFlow(session)).resolves.toBe(BACK);
      expect(errors()).toContain('No Categorizado (CUIT 23000000000) con importe gravado');
      expect(billingGateway.createVoucher).not.toHaveBeenCalled();
    });

    it.each([
      ['10', 'por debajo del 2 %'],
      ['5.010', 'por encima del 500 %'],
    ])('una cotización a mano de %s, %s de la oficial (10119)', async (rate) => {
      script = createScript([
        [/comprobante/, 'Factura C'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '100'],
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, 'Euros (EUR)'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de EUR/, rate],
        // Se escribio en pesos y se cambio a euros: vuelve al monto (REV-74, #12).
        [/Monto total en EUR/, '100'],
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, 'Euros (EUR)'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de EUR/, rate],
        // La vista previa la rechaza: muestra el error y vuelve a los opcionales, con todo (TUI-15); se corrige ahí.
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, 'Euros (EUR)'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de EUR/, '1.000'],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      const { billingGateway, session } = createSession([], 1000);
      const errors = captureStderr();

      await runInvoiceFlow(session);
      expect(errors()).toMatch(/fuera de lo que acepta ARCA: entre el 2 % y el 500 % de la oficial \(1\.000/);
      expect(billingGateway.getQuotation).toHaveBeenCalledWith('060');
      expect(billingGateway.createVoucher).not.toHaveBeenCalled();
    });

    it('una cotización dentro del rango pasa a la vista previa', async () => {
      script = createScript([
        [/comprobante/, 'Factura C'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '100'],
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, 'Euros (EUR)'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de EUR/, '1.450,50'],
        // Se escribio en pesos y se cambio a euros: vuelve al monto (REV-74, #12).
        [/Monto total en EUR/, '100'],
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, 'Euros (EUR)'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de EUR/, '1.450,50'],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runInvoiceFlow(createSession([], 1000).session);

      expect(printed()).toMatch(/arcli fc .*--moneda EUR --cm 1450,50/);
    });
  });

  describe('notas sobre una factura en moneda extranjera (note-currency.ts)', () => {
    it('una ND B en pesos sobre una factura en dólares pasa la vista previa, en pesos y sin `--moneda`', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura B'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura B/, '00003-00000014'],
        [/En qué moneda va la nota/, 'En pesos'],
        [/Monto de la nota de débito/, '25.000'],
        [/Agregamos/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      const { billingGateway, session } = createSession([invoice({ currency: 'DOL', exchangeRate: 1450 })]);

      await runNoteFlow(session, 'debito');

      expect(choicesOf(/En qué moneda va la nota/)).toEqual(['En USD, como el comprobante', 'En pesos']);
      expect(billingGateway.createVoucher).not.toHaveBeenCalled();
      expect(printed()).toMatch(/Moneda +Pesos argentinos \(ARS\)/);
      // Pesos es la moneda por defecto: el comando no la nombra, y con flags la nota va en pesos igual.
      expect(printed()).toContain(
        'arcli ndb -m 25000 --cs --consumidor-final --ac fb --apv 3 --ar 14 --afecha 10/11/2026 --testing --emitir',
      );
    });

    it('una ND FCE solo ofrece la moneda de su factura o pesos, y en pesos pasa la vista previa (10181)', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura de crédito electrónica A'],
        [/Sobre qué factura de crédito electrónica A/, '00003-00000014'],
        [/En qué moneda va la nota/, 'En pesos'],
        [/Monto de la nota de débito/, '5.000'],
        [/Condición frente al IVA/, 'Responsable inscripto'],
        [/Agregamos/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      const { billingGateway, session } = createSession([
        invoice({ currency: 'DOL', documentNumber: 30709965812, documentTypeCode: 80, exchangeRate: 1450 }),
      ]);

      await runNoteFlow(session, 'debito');

      expect(choicesOf(/En qué moneda va la nota/)).toEqual(['En USD, como el comprobante', 'En pesos']);
      expect(billingGateway.createVoucher).not.toHaveBeenCalled();
      // La nota hereda el receptor de la factura: no puede ir a otro (10183).
      expect(printed()).toMatch(/Moneda +Pesos argentinos \(ARS\)/);
      expect(printed()).toContain(
        'arcli ndea -m 5000 --cs --cuit 30709965812 --ir responsable-inscripto --ac fcea --apv 3 --ar 14 --acuit 20333333334 --afecha 10/11/2026 --testing --emitir',
      );
    });

    it('una ND FCE en la moneda de su factura va con su cotización', async () => {
      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura de crédito electrónica A'],
        [/Sobre qué factura de crédito electrónica A/, '00003-00000014'],
        [/En qué moneda va la nota/, 'En USD'],
        [/Monto de la nota de débito/, '10'],
        [/Condición frente al IVA/, 'Responsable inscripto'],
        [/Agregamos/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      const { session } = createSession([
        invoice({ currency: 'DOL', documentNumber: 30709965812, documentTypeCode: 80, exchangeRate: 1450 }),
      ]);

      await runNoteFlow(session, 'debito');

      expect(printed()).toMatch(/arcli ndea -m 10 .*--moneda DOL --cm 1450/);
    });
  });
});
