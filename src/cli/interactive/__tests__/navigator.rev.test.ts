import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { InputValidationError } from '../../../lib/errors/app-error';
import { exchangeRateWarnings } from '../../../modules/billing/billing.currency';
import { billingCommandSchema } from '../../../modules/billing/billing.schemas';
import { BillingService } from '../../../modules/billing/billing.service';
import { ExportService } from '../../../modules/export/export.service';
import { BACK } from '../../../modules/interactive/wizard';
import { runExportFlow } from '../export.flow';
import { runInvoiceFlow } from '../invoice.flow';
import { runNoteFlow } from '../note.flow';
import { runRepeatFlow } from '../repeat.flow';
import type { InteractiveSession } from '../session';

import { createScreens, recordFlow, withoutTerminal } from './screens';
import { createBillingSession, createExportGateway, NOW } from './screens.fixtures';
import { editing, KEEP_EXPORT_ITEMS, rejecting, type ScriptedAnswer, singleExportItem } from './script';

/**
 * Reproducciones de la auditoria del asistente del 19/11 (REV-67 a REV-76, docs/backlog/auditoria-asistente-19-11.md):
 * un test por ticket, con el caso concreto de la auditoria. Afirman lo que tendria que pasar: empezaron como tests que
 * fallaban (tests primero) y NAV-1 a NAV-6 los arreglaron todos.
 */

const originalTimeZone = process.env.TZ;

process.env.TZ = 'America/Argentina/Buenos_Aires';

let screens = createScreens([]);
const commands: string[] = [];

vi.mock('../../../modules/interactive/equivalent-command', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/interactive/equivalent-command')>();

  return {
    ...actual,
    buildEquivalentCommand: (...args: Parameters<typeof actual.buildEquivalentCommand>) => {
      const command = actual.buildEquivalentCommand(...args);

      commands.push(command);

      return command;
    },
  };
});

vi.mock('../../../modules/interactive/export-equivalent-command', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/interactive/export-equivalent-command')>();

  return {
    ...actual,
    buildExportEquivalentCommand: (...args: Parameters<typeof actual.buildExportEquivalentCommand>) => {
      const command = actual.buildExportEquivalentCommand(...args);

      commands.push(command);

      return command;
    },
  };
});

vi.mock('../prompts', () => ({
  askText: async () => '',
  askTextStep: (...args: Parameters<typeof screens.prompts.askTextStep>) => screens.prompts.askTextStep(...args),
  chooseFromFilterList: (...args: Parameters<typeof screens.prompts.chooseFromFilterList>) =>
    screens.prompts.chooseFromFilterList(...args),
  chooseManyStep: (...args: Parameters<typeof screens.prompts.chooseManyStep>) =>
    screens.prompts.chooseManyStep(...args),
  chooseOne: (...args: Parameters<typeof screens.prompts.chooseOne>) => screens.prompts.chooseOne(...args),
  chooseStep: (...args: Parameters<typeof screens.prompts.chooseStep>) => screens.prompts.chooseStep(...args),
  chooseStepWhileLoading: (...args: Parameters<typeof screens.prompts.chooseStepWhileLoading>) =>
    screens.prompts.chooseStepWhileLoading(...args),
  confirm: (...args: Parameters<typeof screens.prompts.confirm>) => screens.prompts.confirm(...args),
  editRowsStep: (...args: Parameters<typeof screens.prompts.editRowsStep>) => screens.prompts.editRowsStep(...args),
  eraseLastAnswer: () => undefined,
  fitPageSize: () => 12,
  isPromptCancellation: () => false,
}));

const exportGateway = createExportGateway();

vi.mock('../../../services/arca/arca-client.factory', () => ({
  ArcaClientFactory: class {
    public createExportGateway() {
      return exportGateway;
    }
  },
}));

vi.mock('../../../modules/config/config.service', () => ({
  ConfigService: class {
    public close() {}
    public setValue() {}
  },
}));

type Steps = ReadonlyArray<readonly [RegExp, ScriptedAnswer]>;

const NO_EMIT = [/Emitimos/, 'No, dejar sin emitir'] as const;

async function run(
  steps: Steps,
  flow: (session: InteractiveSession) => Promise<unknown>,
  config = {},
  adjust: (session: InteractiveSession) => void = () => undefined,
) {
  screens = createScreens(steps);

  const session = createBillingSession(config);

  adjust(session);

  const result = await recordFlow(screens, () => flow(session));

  expect(screens.remaining(), 'quedaron respuestas del guion sin preguntar').toBe(0);

  return result;
}

/** La ultima vez que se pregunto `question`: el texto y las opciones (validador, lo que arranca escrito). */
function lastQuestion(question: RegExp) {
  return screens.script.askTextStep.mock.calls.findLast(([message]) => question.test(message));
}

/** El validador con que se pregunto `question` la ultima vez. */
function lastValidator(question: RegExp): (value: string) => string | true {
  const call = lastQuestion(question);
  const validate = call?.[1]?.validate;

  if (!validate) {
    throw new Error(`No se pregunto ${question} con un validador`);
  }

  return validate;
}

let restoreTerminal: () => void;

beforeAll(() => {
  restoreTerminal = withoutTerminal();
});

afterAll(() => {
  restoreTerminal();

  if (originalTimeZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimeZone;
  }
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  commands.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('auditoría del asistente del 19/11', () => {
  // REV-67 (NAV-3): los opcionales de la E son un `optionalGroup`; lo desmarcado vuelve a lo inicial.
  it('REV-67: en la E, un opcional desmarcado no llega a ARCA', async () => {
    const { exportPayload } = await run(
      [
        [/cliente del exterior/, 'ACME LLC'],
        [/Domicilio/, '123 Main St'],
        [/País de destino/, 'ESTADOS UNIDOS'],
        [/ID impositivo/, '12-3456789'],
        [/Qué exportás/, 'Servicios'],
        [/moneda/, 'Dólares'],
        [/Te pagan en dólares/, 'Sí'],
        ...singleExportItem('1.500'),
        [/Forma de pago/, ''],
        [/actividad/, '620100'],
        [/Fecha de pago/, ''],
        [/Agregamos/, ['Fecha del comprobante', 'Observaciones']],
        [/Fecha del comprobante/, '17/11/2026'],
        [/Observaciones \(Enter/, BACK],
        [/Fecha del comprobante/, BACK],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      runExportFlow,
    );

    // Sin "Fecha del comprobante" marcada, la E va con la de hoy (18/11), como sin `--fecha`.
    expect(exportPayload?.Fecha_cbte).toBe('20261118');
  });

  // REV-68 en A, B y C (NAV-2): los opcionales son un `optionalGroup` que recuerda lo marcado y lo respondido.
  it('REV-68: al volver a un paso anterior y regresar, los opcionales siguen marcados y respondidos', async () => {
    await run(
      [
        [/comprobante/, 'Factura B'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '1.000'],
        [/Agregamos/, ['Importe exento o no gravado', 'Período del servicio']],
        [/Parte exenta/, '300'],
        [/Parte no gravada/, ''],
        [/Servicio desde/, BACK],
        [/Parte no gravada/, BACK],
        [/Parte exenta/, BACK],
        [/Agregamos/, BACK],
        [/Monto total/, '1.000'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      runInvoiceFlow,
    );

    const [, choices, selected] = screens.script.chooseManyStep.mock.calls[2] ?? [];

    expect(selected).toEqual(['exento', 'servicio']);
    expect(choices?.find((choice) => choice.value === 'exento')?.description).toBe('exento 300');
  });

  // NAV-5: las reglas de las fechas (`BILLING_RULES`) corren al preguntar, con `ruleValidator`.
  it('REV-69: "Servicio hasta" y "Vencimiento del pago" se cruzan con las otras fechas al preguntarlas', async () => {
    await run(
      [
        [/comprobante/, 'Factura C'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '1.000'],
        [/Agregamos/, ['Período del servicio']],
        [/Servicio desde/, '30/11/2026'],
        [/Servicio hasta/, '30/11/2026'],
        NO_EMIT,
      ],
      runInvoiceFlow,
    );

    // Antes del desde: la vista previa lo rechaza (10032).
    expect.soft(lastValidator(/Servicio hasta/)('01/11/2026')).toEqual(expect.stringMatching(/posterior|anterior/));

    await run(
      [
        [/comprobante/, 'Factura de crédito electrónica B'],
        [/A quién/, 'Con CUIT'],
        [/CUIT del receptor/, '30-70996581-2'],
        [/Condición frente al IVA/, 'Sujeto exento'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '1.000'],
        [/CBU del emisor/, '0170099220000067797370'],
        [/Alias del CBU/, ''],
        [/Agregamos/, ['Fecha del comprobante', 'Vencimiento del pago']],
        [/Fecha del comprobante/, '15/11/2026'],
        [/Vencimiento del pago/, '18/12/2026'],
        NO_EMIT,
      ],
      runInvoiceFlow,
    );

    // En una FCE no puede ser anterior a hoy (18/11): la vista previa lo rechaza (10164).
    expect(lastValidator(/Vencimiento del pago/)('16/11/2026')).toEqual(expect.stringMatching(/no puede ser anterior/));
  });

  // NAV-5: la regla de exento y no gravado corre al preguntar cada uno.
  it('REV-70: exento más no gravado se controla contra el total al preguntarlo', async () => {
    await run(
      [
        [/comprobante/, 'Factura B'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '1.000'],
        [/Agregamos/, ['Importe exento o no gravado']],
        [/Parte exenta/, '800'],
        [/Parte no gravada/, ''],
        NO_EMIT,
      ],
      runInvoiceFlow,
    );

    // 800 + 500 > 1.000: la vista previa lo rechaza y vuelve al menú.
    expect(lastValidator(/Parte no gravada/)('500')).toEqual(expect.stringMatching(/no puede superar el monto total/));
  });

  // NAV-5: las reglas del período corren al preguntar.
  it('REV-71: en una nota por período, "Período hasta" no acepta un día posterior a la fecha de la nota', async () => {
    await run(
      [
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
        [/A qué la asociamos/, 'A un período'],
        [/Período desde/, '01/11/2026'],
        [/Período hasta/, '15/11/2026'],
        [/A quién va la nota/, 'Consumidor final'],
        [/Qué concepto ajusta la nota/, 'Servicios'],
        [/Monto de la nota de crédito/, '100'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      (session) => runNoteFlow(session, 'credito'),
    );

    // "Todo el mes" (hoy es 18/11): la vista previa lo rechaza con "no puede terminar después de la fecha".
    expect(lastValidator(/Período hasta/)('30/11/2026')).toEqual(expect.stringMatching(/no puede terminar después/));
  });

  // Decision del 19/11: con otro monto, exento y no gravado no se copian en absolutos; se preguntan con el opcional
  // marcado. Con el mismo monto, se copian como antes.
  it('REV-70: en "Repetir" con otro monto, el exento y el no gravado se vuelven a preguntar con el opcional marcado', async () => {
    const withExempt = (session: InteractiveSession) => {
      const history = session.historyGateway;

      Object.assign(session, {
        historyGateway: {
          ...history,
          getVoucher: async (...args: Parameters<typeof history.getVoucher>) => {
            const found = await history.getVoucher(...args);

            return found?.number === 21 ? { ...found, exemptAmount: 300, total: 421 } : found;
          },
        },
      });
    };
    const repeatB = (amount: readonly [RegExp, ScriptedAnswer][]): Steps => [
      [/Qué comprobante querés repetir/, 'Factura B'],
      [/Cuál repetimos/, '00003-00000021'],
      ...amount,
      [/Período del servicio/, 'Un solo día'],
    ];
    const optionalsCall = () => screens.script.chooseManyStep.mock.calls.at(-1);

    const other = await run(
      [
        ...repeatB([
          [/Mismo monto/, 'No, ingresar otro monto'],
          [/Monto total/, '200'],
        ]),
        [/Agregamos/, ['Importe exento o no gravado']],
        [/Parte exenta/, '50'],
        [/Parte no gravada/, ''],
        NO_EMIT,
      ],
      runRepeatFlow,
      {},
      withExempt,
    );

    expect(optionalsCall()?.[2]).toEqual(['exento']);
    expect(optionalsCall()?.[1]?.find((choice) => choice.value === 'exento')?.description).toBe(
      'sin exento ni no gravado',
    );
    expect(lastQuestion(/Parte exenta/)?.[1]?.previousAnswer).toBeUndefined();
    expect(other.billingPayload).toMatchObject({ ImpOpEx: 50, ImpTotal: 200 });

    const same = await run(
      [...repeatB([[/Mismo monto/, 'Sí']]), [/Agregamos/, []], NO_EMIT],
      runRepeatFlow,
      {},
      withExempt,
    );

    expect(optionalsCall()?.[2]).toEqual([]);
    expect(same.billingPayload).toMatchObject({ ImpOpEx: 300, ImpTotal: 421 });
  });

  // El asistente al azar no ingresa comprobantes a mano: este camino lo cubre el guion (ver "reglas (NAV-5)" en
  // `navigator.property.test.ts`).
  it('REV-71: la fecha de un asociado de otro sistema no puede ser posterior a la de la nota', async () => {
    await run(
      [
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura C/, 'Ingresar el número a mano'],
        [/Punto de venta/, '50'],
        [/^Número/, '99'],
        [/^Fecha de la factura C 00050-00000099/, '10/11/2026'],
        [/A quién va la nota/, 'Consumidor final'],
        [/concepto ajusta/, 'Servicios'],
        [/Monto de la nota de crédito/, '100'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      (session) => runNoteFlow(session, 'credito'),
      {},
      // El unico punto de venta de web service es el 3: el 50 es de otro sistema.
      (session) =>
        Object.assign(session, {
          arca: {
            electronicBillingService: {
              getSalesPoints: async () => ({
                resultGet: { ptoVenta: [{ bloqueado: 'N', emisionTipo: 'CAE', nro: 3 }] },
              }),
            },
          },
        }),
    );

    // La fecha de la nota se elige despues (en los opcionales): al preguntar, contra la mas tardia que acepta ARCA (hoy
    // mas 10 dias en servicios). La comparacion exacta la hacen "Fecha del comprobante" y `finalize`.
    expect(lastValidator(/^Fecha de la factura C 00050-00000099/)('28/11/2026')).toBe(true);
    expect(lastValidator(/^Fecha de la factura C 00050-00000099/)('29/11/2026')).toBe(
      'La fecha del comprobante asociado (29/11/2026) no puede ser posterior al 28/11/2026: es la fecha más tardía que ARCA acepta para la nota de crédito C.',
    );
  });

  // Revision de NAV-5: el periodo se pregunta antes que la fecha de la nota. Con flags,
  // `--periodo-hasta 25/11/2026 --fecha 25/11/2026` vale (hoy es 18/11); el asistente tiene que poder llegar.
  describe('REV-71: el período contra la fecha de la nota, que se elige después', () => {
    const periodNote = (...rest: Steps): Steps => [
      [/Sobre qué comprobante/, 'Facturas'],
      [/Qué factura\?/, 'Factura C'],
      [/A qué la asociamos/, 'A un período'],
      [/Período desde/, '01/11/2026'],
      [/Período hasta/, '25/11/2026'],
      [/A quién va la nota/, 'Consumidor final'],
      [/Qué concepto ajusta la nota/, 'Servicios'],
      [/Monto de la nota de crédito/, '100'],
      ...rest,
    ];
    const creditNote = (session: InteractiveSession) => runNoteFlow(session, 'credito');

    it('"Período hasta" acepta hasta la fecha más tardía de la nota, y con esa fecha en los opcionales se emite', async () => {
      const { billingPayload } = await run(
        periodNote([/Agregamos/, ['Fecha del comprobante']], [/Fecha del comprobante/, '25/11/2026'], NO_EMIT),
        creditNote,
      );

      expect(billingPayload).toMatchObject({
        CbteFch: '20261125',
        PeriodoAsoc: { FchDesde: '20261101', FchHasta: '20261125' },
      });
    });

    it('"Fecha del comprobante" no acepta una fecha anterior al fin del período', async () => {
      const { billingPayload } = await run(
        periodNote(
          [/Agregamos/, ['Fecha del comprobante']],
          [
            /Fecha del comprobante/,
            rejecting('26/11/2026', [
              '20/11/2026',
              /^El período asociado no puede terminar después de la fecha de la nota de crédito C \(20\/11\/2026\)\.$/,
            ]),
          ],
          NO_EMIT,
        ),
        creditNote,
      );

      expect(billingPayload).toMatchObject({ CbteFch: '20261126' });
    });

    it('sin elegir la fecha, `finalize` vuelve al período y sugiere el opcional', async () => {
      const { billingPayload } = await run(
        periodNote(
          [/Agregamos/, []],
          // Vuelve al periodo, con el aviso; lo que sigue arranca con lo respondido.
          [/Período hasta/, '18/11/2026'],
          [/A quién va la nota/, 'Consumidor final'],
          [/Qué concepto ajusta la nota/, 'Servicios'],
          [/Monto de la nota de crédito/, '100'],
          [/Agregamos/, []],
          NO_EMIT,
        ),
        creditNote,
      );

      expect(printedText()).toContain(
        'El período asociado no puede terminar después de la fecha de la nota de crédito C (18/11/2026): escribí un "Período hasta" hasta el 18/11/2026, o volvé y elegí una fecha posterior en "Fecha del comprobante" de los opcionales.',
      );
      expect(billingPayload).toMatchObject({ CbteFch: '20261118', PeriodoAsoc: { FchHasta: '20261118' } });
    });
  });

  it('REV-71: "A un período" ya no sugiere el mes entero', async () => {
    await run(
      [
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
        [/A qué la asociamos/, BACK],
        [/Sobre qué comprobante/, BACK],
      ],
      (session) => runNoteFlow(session, 'credito'),
    );

    const choices = screens.script.chooseStep.mock.calls.find(([message]) =>
      /A qué la asociamos/.test(message),
    )?.[1] as ReadonlyArray<{ readonly description?: string; readonly name?: string }> | undefined;
    const period = choices?.find((choice) => choice.name === 'A un período');

    expect(period?.description).not.toMatch(/todo el mes/);
    expect(period?.description).toMatch(/hasta la fecha de la nota/);
  });

  // REV-76: la misma regla nombra la pregunta en el asistente y el flag en el CLI.
  it('REV-76: en el asistente la regla del período nombra las preguntas; en el CLI, los flags', async () => {
    await run(
      [
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
        [/A qué la asociamos/, 'A un período'],
        [/Período desde/, '10/11/2026'],
        [/Período hasta/, '15/11/2026'],
        [/A quién va la nota/, 'Consumidor final'],
        [/Qué concepto ajusta la nota/, 'Servicios'],
        [/Monto de la nota de crédito/, '100'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      (session) => runNoteFlow(session, 'credito'),
    );

    expect(lastValidator(/Período hasta/)('01/11/2026')).toBe(
      'En el período asociado, "Período desde" no puede ser posterior a "Período hasta".',
    );

    const service = new BillingService();
    const input = billingCommandSchema.parse({
      associatedPeriod: { desde: '10/11/2026', hasta: '01/11/2026' },
      concept: 'servicios',
      documentType: 'consumidor-final',
      ivaCondition: 'consumidor-final',
      shortcut: 'ncc',
      totalAmount: 100,
    });

    expect(() => service.buildVoucherPayload(input, createBillingSession().runtime)).toThrow(
      'En el período asociado, `--periodo-desde` no puede ser posterior a `--periodo-hasta`.',
    );
  });

  // NAV-4: el comando equivalente sale de la entrada, antes de la vista previa.
  it('REV-72: con moneda extranjera en la config, el comando equivalente no fija la cotización oficial con --cm', async () => {
    await run(
      [
        [/comprobante/, 'Factura C'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '100'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      runInvoiceFlow,
      { monedaPorDefecto: 'USD' },
    );

    expect(commands.at(-1)).toBe('arcli fc -m 100 --cs --consumidor-final --moneda USD --testing --emitir');
  });

  it('REV-73: al repetir una factura en pesos con el mismo monto, no se puede pasar a otra moneda', async () => {
    await run(
      [
        [/Qué comprobante querés repetir/, 'Factura C'],
        [/Cuál repetimos/, '00003-00000014'],
        [/Mismo monto/, 'Sí'],
        [/Período del servicio/, 'Este mes'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      runRepeatFlow,
    );

    const [, choices] = screens.script.chooseManyStep.mock.calls[0] ?? [];
    const currency = choices?.find((choice) => choice.value === 'divisas');

    // $ 150.000 confirmados en pesos: con la moneda extranjera saldria por US$ 150.000.
    expect(currency === undefined || Boolean(currency.disabled)).toBe(true);
  });
});

/** Lo que se escribio en la terminal, sin bordes ni cortes de linea: un aviso largo se parte en el panel. */
function printedText(): string {
  return screens
    .transcript()
    .replace(/[\u2500-\u257f]/g, ' ')
    .replace(/\s+/g, ' ');
}

const officialRateQuestion = () =>
  screens.script.askTextStep.mock.calls.findLast(([message]) => /^Cotización de USD/.test(message));

// Detalles bajos de la auditoria (REV-74) que arregla NAV-4: el comando equivalente sale de la entrada, con las fechas
// completas, y la cotizacion de la config y la oficial se tratan como en el CLI.
describe('auditoría del asistente del 19/11: una sola salida (NAV-4)', () => {
  // #13: escrita a medias, la fecha pegada otro mes daria otra.
  it('#13: en una factura, las fechas escritas a medias van completas en el comando equivalente', async () => {
    await run(
      [
        [/comprobante/, 'Factura C'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '100'],
        [/Agregamos/, ['Fecha del comprobante', 'Período del servicio', 'Vencimiento del pago']],
        [/Fecha del comprobante/, '17'],
        [/Servicio desde/, '1/11'],
        [/Servicio hasta/, '17/11'],
        [/Vencimiento del pago/, '25'],
        NO_EMIT,
      ],
      runInvoiceFlow,
    );

    expect(commands.at(-1)).toContain('-f 17/11/2026');
    expect(commands.at(-1)).toContain('--sd 01/11/2026 --sh 17/11/2026 --vto 25/11/2026');
  });

  it('#13: en una nota por período, el período y la fecha van completos', async () => {
    await run(
      [
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
        [/A qué la asociamos/, 'A un período'],
        [/Período desde/, '1/10'],
        [/Período hasta/, '31/10'],
        [/A quién va la nota/, 'Consumidor final'],
        [/concepto ajusta/, 'Productos'],
        [/Monto de la nota de crédito/, '100'],
        [/Agregamos/, ['Fecha del comprobante']],
        [/Fecha del comprobante/, '17'],
        NO_EMIT,
      ],
      (session) => runNoteFlow(session, 'credito'),
    );

    expect(commands.at(-1)).toContain('-f 17/11/2026');
    expect(commands.at(-1)).toContain('--pd 01/10/2026 --ph 31/10/2026');
  });

  it('#13: en "Repetir", otro período escrito a medias va completo', async () => {
    await run(
      [
        [/Qué comprobante querés repetir/, 'Factura C'],
        [/Cuál repetimos/, '00003-00000014'],
        [/Mismo monto/, 'Sí'],
        [/Período del servicio/, 'Otro período'],
        [/Servicio desde/, '1/11'],
        [/Servicio hasta/, '17/11'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      runRepeatFlow,
    );

    expect(commands.at(-1)).toContain('--sd 01/11/2026 --sh 17/11/2026');
  });

  // Revision de NAV-4: la fecha de pago de la E tambien va completa.
  it('#13: en la factura E, la fecha de pago escrita a medias va completa', async () => {
    const { exportPayload } = await run(
      [
        [/cliente del exterior/, 'ACME LLC'],
        [/Domicilio/, '123 Main St'],
        [/País de destino/, 'ESTADOS UNIDOS'],
        [/ID impositivo/, '12-3456789'],
        [/Qué exportás/, 'Servicios'],
        [/moneda/, 'Dólares'],
        [/Te pagan en dólares/, 'Sí'],
        ...singleExportItem('1.500'),
        [/Forma de pago/, ''],
        [/actividad/, '620100'],
        [/Fecha de pago/, '25'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      runExportFlow,
    );

    expect(commands.at(-1)).toContain('--fecha-pago 25/11/2026');
    expect(exportPayload?.Fecha_pago).toBe('20261125');
  });

  it('#13: en "Repetir" E, la fecha de pago escrita a medias va completa', async () => {
    await run(
      [
        [/Qué comprobante querés repetir/, 'Factura de exportación E'],
        [/Cuál repetimos/, '00003-00000007'],
        ...KEEP_EXPORT_ITEMS,
        [/Fecha de pago/, '25'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      runRepeatFlow,
    );

    expect(commands.at(-1)).toContain('--fecha-pago 25/11/2026');
  });

  // #14: con `cotizacion` en la config, el CLI la marca como de la config y avisa que esta deprecada.
  it('#14: con la cotización deprecada en la config, avisa como el CLI y el comando no la fija', async () => {
    const { billingPayload } = await run(
      [
        [/comprobante/, 'Factura C'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '100'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      runInvoiceFlow,
      { cotizacionPorDefecto: 1400, monedaPorDefecto: 'USD' },
    );
    const [warning] = exchangeRateWarnings({ currencyCode: 'USD', exchangeRate: 1400, exchangeRateSource: 'config' });

    expect(printedText()).toContain(warning);
    expect(commands.at(-1)).toBe('arcli fc -m 100 --cs --consumidor-final --moneda USD --testing --emitir');
    expect(billingPayload?.MonCotiz).toBe(1400);
  });

  // #15 (decision del 19/11): "En pesos" arranca con la oficial escrita; sin tocarla va como el CLI sin `--cm`.
  const inPesos = (rate: ScriptedAnswer): Steps => [
    [/comprobante/, 'Factura C'],
    [/A quién/, 'Consumidor final'],
    [/Qué estás facturando/, 'Servicios'],
    [/Monto total/, '100'],
    [/Agregamos/, ['Moneda extranjera']],
    [/Moneda del comprobante/, '(USD)'],
    [/Cómo te pagan/, 'En pesos'],
    [/Cotización de USD/, rate],
    // El monto se escribio en pesos: vuelve a pedirlo en dólares (REV-74, #12).
    [/Monto total en USD/, '100'],
    [/Agregamos/, ['Moneda extranjera']],
    [/Moneda del comprobante/, '(USD)'],
    [/Cómo te pagan/, 'En pesos'],
    [/Cotización de USD/, rate],
    NO_EMIT,
  ];

  it('#15: con "En pesos", la cotización arranca escrita con la oficial de ARCA y lo dice', async () => {
    await run(inPesos('1450'), runInvoiceFlow);

    const [message, options] = officialRateQuestion() ?? [];

    expect(message).toBe('Cotización de USD (la oficial de ARCA es 1.450):');
    expect(options?.previousAnswer).toBe('1450');

    const [, payment] = screens.script.chooseStep.mock.calls.find(([question]) => /Cómo te pagan/.test(question)) ?? [];

    const pesos = payment?.find((choice) => 'name' in choice && choice.name === 'En pesos');

    expect(pesos && 'description' in pesos ? pesos.description : undefined).toBe(
      'El comprobante va en dólares y lo cobrás en pesos: confirmás o cambiás la cotización',
    );
  });

  it('#15: con la oficial sin tocar, el comando no lleva --cm y la solicitud va con la oficial', async () => {
    const { billingPayload } = await run(inPesos('1450'), runInvoiceFlow);

    expect(commands.at(-1)).toBe('arcli fc -m 100 --cs --consumidor-final --moneda USD --testing --emitir');
    expect(billingPayload).toMatchObject({ CanMisMonExt: 'N', MonCotiz: 1450, MonId: 'DOL' });
  });

  it('#15: con otra cotización escrita, el comando la fija con --cm', async () => {
    const { billingPayload } = await run(inPesos('1.400'), runInvoiceFlow);

    expect(commands.at(-1)).toContain('--moneda USD --cm 1400 --testing');
    expect(billingPayload?.MonCotiz).toBe(1400);
  });

  it('#15: escrita a mano, aunque sea igual a la oficial, es la acordada y va con --cm', async () => {
    await run(inPesos('1.450'), runInvoiceFlow);

    expect(commands.at(-1)).toContain('--moneda USD --cm 1450 --testing');
  });

  it('#15: en "Repetir" en moneda extranjera, la oficial sin tocar tampoco lleva --cm', async () => {
    const { billingPayload } = await run(
      [
        [/Qué comprobante querés repetir/, 'Factura C'],
        [/Cuál repetimos/, '00003-00000015'],
        [/Mismo monto/, 'Sí'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de USD/, '1450'],
        [/Período del servicio/, 'Este mes'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      runRepeatFlow,
    );

    expect(officialRateQuestion()?.[1]?.previousAnswer).toBe('1450');
    expect(commands.at(-1)).toMatch(/--moneda USD --sd /);
    expect(commands.at(-1)).not.toContain('--cm');
    expect(billingPayload?.MonCotiz).toBe(1450);
  });

  it('#15: si no se puede consultar la oficial, la cotización arranca vacía y hay que escribirla', async () => {
    await run(inPesos('1.400'), runInvoiceFlow, {}, (session) => {
      vi.mocked(session.billingGateway.getQuotation).mockRejectedValue(new Error('Sin conexión'));
    });

    // La primera vez: al volver al monto (cambio la moneda) la cotizacion arranca con la escrita.
    const [message, options] =
      screens.script.askTextStep.mock.calls.find(([question]) => /^Cotización de USD/.test(question)) ?? [];

    expect(message).toBe('Cotización de USD:');
    expect(options?.previousAnswer).toBeUndefined();
    expect(options?.validate?.('')).not.toBe(true);
    // La vista previa sigue, con el aviso de que no pudo compararla con la oficial (como con `--cm` sin red).
    expect(printedText()).toContain('No se pudo comparar la cotización con la oficial de ARCA: Sin conexión.');
    expect(commands.at(-1)).toContain('--cm 1400');
  });
});

describe('encontrado por los tests al azar (NAV-0)', () => {
  // REV-75 (NAV-5): "CUIT del receptor" aceptaba el CUIT del emisor y recien la vista previa lo rechazaba (10069). Ahora
  // la pregunta corre la misma regla (`RECEIVER_NOT_EMITTER_RULE`); la tabla de `navigator.property.test.ts` lo incluye.
  it('REV-75: "CUIT del receptor" no acepta el CUIT del emisor', async () => {
    await run(
      [
        [/comprobante/, 'Factura A'],
        [/A quién/, 'Con CUIT'],
        [/CUIT del receptor/, '30-70996581-2'],
        [/Condición frente al IVA/, 'Responsable inscripto'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '1.210'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      runInvoiceFlow,
    );

    expect(lastValidator(/CUIT del receptor/)('20-11111111-2')).toEqual(expect.stringMatching(/mismo CUIT que emite/));
  });
});

// Detalles de la auditoria (REV-74) que arregla NAV-6 con los pasos compartidos.
describe('auditoría del asistente del 19/11: pasos compartidos (NAV-6)', () => {
  const amountQuestions = () =>
    screens.script.askTextStep.mock.calls.map(([message]) => message).filter((message) => /^Monto/.test(message));
  const invoiceSteps = (kind: RegExp, choice: string, amount: RegExp): Steps => [
    [kind, choice],
    [/A quién/, 'Consumidor final'],
    [/Qué estás (facturando|cobrando)/, 'Servicios'],
    [amount, '100'],
    [/Agregamos/, []],
    NO_EMIT,
  ];

  // #12: con una moneda extranjera en la config, el monto es en esa moneda y la pregunta no lo decia.
  it('#12: en la factura y el recibo, "Monto total" nombra la moneda de la config si no es pesos', async () => {
    await run(invoiceSteps(/comprobante/, 'Factura C', /^Monto total en USD:$/), runInvoiceFlow, {
      monedaPorDefecto: 'USD',
    });
    expect(amountQuestions()).toEqual(['Monto total en USD:']);

    await run(
      invoiceSteps(/Qué recibo/, 'Recibo C', /^Monto total en USD:$/),
      (session) => runInvoiceFlow(session, true),
      { monedaPorDefecto: 'USD' },
    );
    expect(amountQuestions()).toEqual(['Monto total en USD:']);

    // En pesos, como siempre.
    await run(invoiceSteps(/comprobante/, 'Factura C', /^Monto total:$/), runInvoiceFlow);
    expect(amountQuestions()).toEqual(['Monto total:']);
  });

  it('#12: en la factura E la moneda va antes del monto, y el monto la nombra', async () => {
    const exportSteps = (currency: string, amount: RegExp): Steps => [
      [/comprobante/, 'Factura de exportación E'],
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, 'estados unidos'],
      [/ID impositivo/, '12-3456789'],
      [/Qué exportás/, 'Servicios'],
      [/moneda/, currency],
      ...(currency === 'Dólares' ? ([[/Te pagan en dólares/, 'Sí']] as const) : []),
      // Sin monto (NAV-10): el precio del ítem nombra la moneda.
      [/^Descripción del ítem 1:/, ''],
      [/^Cantidad:/, ''],
      [/^Unidad:/, 'unidades'],
      [amount, '1.500'],
      [/^Descripción del ítem 2/, ''],
      [/^Importe total/, 'Confirmar'],
      [/Forma de pago/, ''],
      [/actividad/, '620100'],
      [/Fecha de pago/, ''],
      [/Agregamos/, []],
      NO_EMIT,
    ];

    await run(exportSteps('Dólares', /^(?:Importe|Precio unitario) en USD:$/), runInvoiceFlow);
    await run(exportSteps('Pesos', /^(?:Importe|Precio unitario):$/), runInvoiceFlow);
  });

  it('REV-73: con otro monto, una factura en pesos se puede pasar a otra moneda; una en dólares, no', async () => {
    const offersCurrency = () =>
      (screens.script.chooseManyStep.mock.calls[0]?.[1] ?? []).some((choice) => choice.value === 'divisas');

    await run(
      [
        [/Qué comprobante querés repetir/, 'Factura C'],
        [/Cuál repetimos/, '00003-00000014'],
        [/Mismo monto/, 'No'],
        [/^Monto total:$/, '100'],
        [/Período del servicio/, 'Este mes'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      runRepeatFlow,
    );
    expect(offersCurrency()).toBe(true);

    await run(
      [
        [/Qué comprobante querés repetir/, 'Factura C'],
        [/Cuál repetimos/, '00003-00000015'],
        [/Mismo monto/, 'No'],
        [/^Monto total en USD:$/, '100'],
        [/Cómo te pagan/, 'En dólares'],
        [/Período del servicio/, 'Este mes'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      runRepeatFlow,
    );
    expect(offersCurrency()).toBe(false);
  });

  // #12 (revision de NAV-6): el monto se escribio en la moneda que nombraba la pregunta; si los opcionales la cambian, el
  // asistente vuelve al monto con el aviso y la pregunta nombra la moneda nueva.
  describe('#12: si los opcionales cambian la moneda, el monto se vuelve a escribir', () => {
    const inPesosNotice = 'Cambiaste la moneda a pesos: escribí el monto en pesos.';
    const inEurosNotice = 'Cambiaste la moneda a EUR: escribí el monto en EUR.';
    const toEuros = (rate: string): Steps => [
      [/Moneda del comprobante/, 'Euros (EUR)'],
      [/Cómo te pagan/, 'En pesos'],
      [/Cotización de EUR/, rate],
    ];

    it('A: escrito en USD (la de la config) y pasado a pesos: va en pesos, con el monto escrito en pesos', async () => {
      const { billingPayload } = await run(
        [
          [/comprobante/, 'Factura C'],
          [/A quién/, 'Consumidor final'],
          [/Qué estás facturando/, 'Servicios'],
          [/^Monto total en USD:$/, '1.000'],
          [/Agregamos/, ['Moneda extranjera']],
          [/Moneda del comprobante/, 'Pesos'],
          [/^Monto total:$/, '150.000'],
          [/Agregamos/, ['Moneda extranjera']],
          [/Moneda del comprobante/, 'Pesos'],
          NO_EMIT,
        ],
        runInvoiceFlow,
        { monedaPorDefecto: 'USD' },
      );

      expect(printedText()).toContain(inPesosNotice);
      expect(billingPayload).toMatchObject({ ImpTotal: 150000, MonCotiz: 1, MonId: 'PES' });
    });

    it('B: escrito en pesos y pasado a euros: va en euros, con el monto escrito en euros', async () => {
      const { billingPayload } = await run(
        [
          [/comprobante/, 'Factura C'],
          [/A quién/, 'Consumidor final'],
          [/Qué estás facturando/, 'Servicios'],
          [/^Monto total:$/, '10'],
          [/Agregamos/, ['Moneda extranjera']],
          ...toEuros('1.500'),
          [/^Monto total en EUR:$/, '100'],
          [/Agregamos/, ['Moneda extranjera']],
          ...toEuros('1.500'),
          NO_EMIT,
        ],
        runInvoiceFlow,
      );

      expect(printedText()).toContain(inEurosNotice);
      expect(billingPayload).toMatchObject({ ImpTotal: 100, MonCotiz: 1500, MonId: '060' });
    });

    it('en "Repetir" en pesos con otro monto, igual', async () => {
      const { billingPayload } = await run(
        [
          [/Qué comprobante querés repetir/, 'Factura C'],
          [/Cuál repetimos/, '00003-00000014'],
          [/Mismo monto/, 'No'],
          [/^Monto total:$/, '10'],
          [/Período del servicio/, 'Este mes'],
          [/Agregamos/, ['Moneda extranjera']],
          ...toEuros('1.500'),
          [/^Monto total en EUR:$/, '100'],
          [/Período del servicio/, 'Este mes'],
          [/Agregamos/, ['Moneda extranjera']],
          ...toEuros('1.500'),
          NO_EMIT,
        ],
        runRepeatFlow,
      );

      expect(printedText()).toContain(inEurosNotice);
      expect(billingPayload).toMatchObject({ ImpTotal: 100, MonCotiz: 1500, MonId: '060' });
    });
  });

  describe('#12 en la factura E: los ítems dependen de la moneda (NAV-10)', () => {
    const untilItems: Steps = [
      [/comprobante/, 'Factura de exportación E'],
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, 'estados unidos'],
      [/ID impositivo/, '12-3456789'],
      [/Qué exportás/, 'Servicios'],
      [/moneda/, 'Dólares'],
      [/Te pagan en dólares/, 'Sí'],
      ...singleExportItem('1.500'),
      [/Forma de pago/, BACK],
      [/^Ítems de .*: marcá qué modificar/, BACK],
    ];
    const rest: Steps = [
      [/Forma de pago/, ''],
      [/actividad/, '620100'],
      [/Fecha de pago/, ''],
      [/Agregamos/, []],
      NO_EMIT,
    ];

    it('otra moneda: los ítems se conservan, con un aviso para revisar los importes', async () => {
      await run(
        [
          ...untilItems,
          [/Te pagan en dólares/, BACK],
          [/moneda/, 'Pesos'],
          [/^Ítems de .*: marcá qué modificar/, editing({ edit: ['Según detalle'] })],
          [/^Descripción del ítem 1:/, ''],
          [/^Cantidad:/, ''],
          [/^Unidad:/, ''],
          [/^Importe:$/, '1.500.000'],
          [/^Importe total de la factura de exportación E: \$ 1\.500\.000/, 'Confirmar'],
          ...rest,
        ],
        runInvoiceFlow,
      );

      expect(printedText()).toContain('Cambiaste la moneda a pesos: revisá los importes de los ítems.');
      expect(lastQuestion(/^Importe:$/)?.[1]?.previousAnswer).toBe('1500');
    });

    it('solo cambiar "¿Te pagan en dólares?": los ítems siguen, en el editor, sin aviso', async () => {
      await run(
        [
          ...untilItems,
          // En servicios no se pregunta la cotización (2053).
          [/Te pagan en dólares/, 'No, en pesos'],
          [/^Ítems de .*: marcá qué modificar/, editing({})],
          [/^Importe total de la factura de exportación E: 1\.500 USD/, 'Confirmar'],
          ...rest,
        ],
        runInvoiceFlow,
      );

      expect(printedText()).not.toContain('Cambiaste la moneda');
    });
  });

  it('#12 en las notas: la nota sobre una factura en dólares nombra la moneda', async () => {
    await run(
      [
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura C/, '00003-00000015'],
        [/En qué moneda va la nota/, 'En USD'],
        [/Total o parcial/, 'Parcial'],
        [/^Monto de la nota de crédito en USD:$/, '100'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      (session) => runNoteFlow(session, 'credito'),
    );
  });

  // Los datos del consumidor final son del receptor: con otro receptor, lo escrito se descarta (docs/modo-interactivo.md).
  it('cambiar a otro receptor y seguir descarta el documento del consumidor final', async () => {
    await run(
      [
        [/comprobante/, 'Factura C'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '12.000.000'],
        [/Documento del consumidor final/, 'DNI'],
        [/DNI del consumidor final/, '30123456'],
        [/Agregamos/, BACK],
        [/DNI del consumidor final/, BACK],
        [/Documento del consumidor final/, BACK],
        [/Monto total/, BACK],
        [/Qué estás facturando/, BACK],
        [/A quién/, 'Con CUIL'],
        [/CUIL del receptor/, '20-12345678-6'],
        [/Condición frente al IVA/, 'Sujeto exento'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '1.000'],
        [/Agregamos/, BACK],
        [/Monto total/, BACK],
        [/Qué estás facturando/, BACK],
        [/Condición frente al IVA/, BACK],
        [/CUIL del receptor/, BACK],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '12.000.000'],
        [/Documento del consumidor final/, 'CUIT'],
        [/CUIT del consumidor final/, '20-30123456-3'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      runInvoiceFlow,
    );

    const documents = screens.script.chooseStep.mock.calls.filter(([message]) => /^Documento del/.test(message));

    expect(documents.at(-1)?.[2]).toBeUndefined();
  });

  // Una nota sobre una factura de otro sistema: el receptor sale del punto de venta y el numero escritos.
  it('en una nota sobre una factura de otro sistema, cambiar solo el número descarta el documento', async () => {
    const otherSystem = (number: string): Steps => [
      [/Sobre qué factura C/, 'Ingresar el número a mano'],
      [/Punto de venta/, '50'],
      [/^Número/, number],
      [/^Fecha de la factura C 00050/, '10/11/2026'],
      [/A quién va la nota/, 'Consumidor final'],
      [/concepto ajusta/, 'Servicios'],
      [/Monto de la nota de crédito/, '12.000.000'],
    ];

    await run(
      [
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
        [/A qué la asociamos/, 'A una factura'],
        ...otherSystem('99'),
        [/Documento del consumidor final/, 'DNI'],
        [/DNI del consumidor final/, '30123456'],
        [/Agregamos/, BACK],
        [/DNI del consumidor final/, BACK],
        [/Documento del consumidor final/, BACK],
        [/Monto de la nota de crédito/, BACK],
        [/concepto ajusta/, BACK],
        [/A quién va la nota/, BACK],
        [/^Fecha de la factura C 00050/, BACK],
        ...otherSystem('98'),
        [/Documento del consumidor final/, 'DNI'],
        [/DNI del consumidor final/, '30123456'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      (session) => runNoteFlow(session, 'credito'),
      {},
      (session) =>
        Object.assign(session, {
          arca: {
            electronicBillingService: {
              getSalesPoints: async () => ({
                resultGet: { ptoVenta: [{ bloqueado: 'N', emisionTipo: 'CAE', nro: 3 }] },
              }),
            },
          },
        }),
    );

    const documents = screens.script.chooseStep.mock.calls.filter(([message]) => /^Documento del/.test(message));
    const numbers = screens.script.askTextStep.mock.calls.filter(([message]) => /^DNI del consumidor/.test(message));

    expect(documents.at(-1)?.[2]).toBeUndefined();
    expect(numbers.at(-1)?.[1]?.previousAnswer).toBeUndefined();
  });
});

// TUI-15: el asistente no pierde lo respondido si la vista previa rechaza algo. Antes, una respuesta que `finalize`
// mandaba a corregir se podia repetir (el validador seguia comparando con la fecha mas tardia de la nota), la vista
// previa la rechazaba y el error volvia al menu.
describe('TUI-15: lo respondido no se pierde si la vista previa rechaza', () => {
  const creditNote = (session: InteractiveSession) => runNoteFlow(session, 'credito');
  const otherSystem = (session: InteractiveSession) =>
    Object.assign(session, {
      arca: {
        electronicBillingService: {
          getSalesPoints: async () => ({
            resultGet: { ptoVenta: [{ bloqueado: 'N', emisionTipo: 'CAE', nro: 3 }] },
          }),
        },
      },
    });
  let stderr: string[] = [];

  beforeEach(() => {
    stderr = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk));

      return true;
    });
  });

  afterEach(() => {
    vi.mocked(process.stderr.write).mockRestore();
  });

  it('de vuelta en "Período hasta" por `finalize`, la misma fecha ya no pasa: dice las dos salidas', async () => {
    const { billingPayload } = await run(
      [
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
        [/A qué la asociamos/, 'A un período'],
        [/Período desde/, '01/11/2026'],
        // Vale contra la fecha más tardía que ARCA acepta para la nota (hoy + 10).
        [/Período hasta/, '25/11/2026'],
        [/A quién va la nota/, 'Consumidor final'],
        [/Qué concepto ajusta la nota/, 'Servicios'],
        [/Monto de la nota de crédito/, '100'],
        // Sin fecha de la nota va la de hoy: `finalize` vuelve al período, y ahí se compara con hoy.
        [/Agregamos/, []],
        [
          /Período hasta/,
          rejecting('18/11/2026', [
            '25/11/2026',
            /^El período asociado no puede terminar después de la fecha de la nota de crédito C \(18\/11\/2026\): escribí un "Período hasta" hasta el 18\/11\/2026, o volvé y elegí una fecha posterior en "Fecha del comprobante" de los opcionales\.$/,
          ]),
        ],
        [/A quién va la nota/, 'Consumidor final'],
        [/Qué concepto ajusta la nota/, 'Servicios'],
        [/Monto de la nota de crédito/, '100'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      creditNote,
    );

    expect(billingPayload).toMatchObject({ CbteFch: '20261118', PeriodoAsoc: { FchHasta: '20261118' } });
  });

  it('de vuelta en la fecha de una factura de otro sistema por `finalize`, la misma ya no pasa', async () => {
    const { billingPayload } = await run(
      [
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura C/, 'Ingresar el número a mano'],
        [/Punto de venta/, '50'],
        [/^Número/, '99'],
        [/^Fecha de la factura C 00050-00000099/, '25/11/2026'],
        [/A quién va la nota/, 'Consumidor final'],
        [/concepto ajusta/, 'Servicios'],
        [/Monto de la nota de crédito/, '100'],
        [/Agregamos/, []],
        [
          /^Fecha de la factura C 00050-00000099/,
          rejecting('15/11/2026', [
            '25/11/2026',
            /no puede ser posterior a la de la nota de crédito C \(18\/11\/2026\): escribí una hasta el 18\/11\/2026, o volvé y elegí una fecha posterior en "Fecha del comprobante" de los opcionales\.$/,
          ]),
        ],
        [/A quién va la nota/, 'Consumidor final'],
        [/concepto ajusta/, 'Servicios'],
        [/Monto de la nota de crédito/, '100'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      creditNote,
      {},
      otherSystem,
    );

    expect(billingPayload).toMatchObject({ CbtesAsoc: [expect.objectContaining({ CbteFch: '20261115' })] });
  });

  it('si la vista previa de A, B o C rechaza la entrada, muestra el error y vuelve a la última pregunta', async () => {
    const execute = vi
      .spyOn(BillingService.prototype, 'execute')
      .mockRejectedValueOnce(new InputValidationError('La vista previa no acepta esto.'));

    try {
      await run(
        [
          [/comprobante/, 'Factura C'],
          [/A quién/, 'Consumidor final'],
          [/Qué estás facturando/, 'Servicios'],
          [/Monto total/, '1.000'],
          [/Agregamos/, ['Fecha del comprobante']],
          [/Fecha del comprobante/, '17/11/2026'],
          // La vista previa rechaza: de vuelta en los opcionales, con lo marcado y lo escrito.
          [/Agregamos/, ['Fecha del comprobante']],
          [/Fecha del comprobante/, '17/11/2026'],
          NO_EMIT,
        ],
        runInvoiceFlow,
      );
    } finally {
      execute.mockRestore();
    }

    expect(stderr.join('')).toContain('La vista previa no acepta esto.');
    expect(printedText()).toContain('No se emitió nada. Volvemos a la última pregunta con lo que respondiste');
    expect(screens.script.chooseManyStep.mock.calls[1]?.[2]).toEqual(['fecha']);
    expect(lastQuestion(/Fecha del comprobante/)?.[1]?.previousAnswer).toBe('17/11/2026');
  });

  it('si la vista previa de la E rechaza la entrada, muestra el error y vuelve a la última pregunta', async () => {
    const resolve = vi
      .spyOn(ExportService.prototype, 'resolve')
      .mockRejectedValueOnce(new InputValidationError('La vista previa de la E no acepta esto.'));

    try {
      const { exportPayload } = await run(
        [
          [/cliente del exterior/, 'ACME LLC'],
          [/Domicilio/, '123 Main St'],
          [/País de destino/, 'ESTADOS UNIDOS'],
          [/ID impositivo/, '12-3456789'],
          [/Qué exportás/, 'Servicios'],
          [/moneda/, 'Dólares'],
          [/Te pagan en dólares/, 'Sí'],
          ...singleExportItem('1.500'),
          [/Forma de pago/, ''],
          [/actividad/, '620100'],
          [/Fecha de pago/, ''],
          [/Agregamos/, ['Observaciones']],
          [/Observaciones \(Enter/, 'Primera cuota'],
          [/Observaciones comerciales/, ''],
          [/Agregamos/, ['Observaciones']],
          [/Observaciones \(Enter/, 'Primera cuota'],
          [/Observaciones comerciales/, ''],
          NO_EMIT,
        ],
        runExportFlow,
      );

      expect(exportPayload?.Obs).toBe('Primera cuota');
    } finally {
      resolve.mockRestore();
    }

    expect(stderr.join('')).toContain('La vista previa de la E no acepta esto.');
    expect(lastQuestion(/Observaciones \(Enter/)?.[1]?.previousAnswer).toBe('Primera cuota');
  });

  it('un error que no es de validación (ARCA, red) sigue de largo, como antes', async () => {
    const execute = vi.spyOn(BillingService.prototype, 'execute').mockRejectedValueOnce(new Error('ARCA no responde'));

    screens = createScreens([
      [/comprobante/, 'Factura C'],
      [/A quién/, 'Consumidor final'],
      [/Qué estás facturando/, 'Servicios'],
      [/Monto total/, '1.000'],
      [/Agregamos/, []],
    ]);

    try {
      await expect(recordFlow(screens, () => runInvoiceFlow(createBillingSession({})))).rejects.toThrow(
        'ARCA no responde',
      );
    } finally {
      execute.mockRestore();
    }
  });
});
