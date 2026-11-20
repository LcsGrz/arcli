import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { exchangeRateWarnings } from '../../../modules/billing/billing.currency';
import { billingCommandSchema } from '../../../modules/billing/billing.schemas';
import { BillingService } from '../../../modules/billing/billing.service';
import { BACK } from '../../../modules/interactive/wizard';
import { runExportFlow } from '../export.flow';
import { runInvoiceFlow } from '../invoice.flow';
import { runNoteFlow } from '../note.flow';
import { runRepeatFlow } from '../repeat.flow';
import type { InteractiveSession } from '../session';

import { createScreens, recordFlow, withoutTerminal } from './screens';
import { createBillingSession, createExportGateway, NOW } from './screens.fixtures';
import type { ScriptedAnswer } from './script';

/**
 * Reproducciones de la auditoria del asistente del 19/11 (REV-67 a REV-76, docs/backlog/auditoria-asistente-19-11.md):
 * un test por ticket, con el caso concreto de la auditoria. Afirman lo que tendria que pasar; los que todavia fallan van
 * con `it.fails`. Cuando NAV arregla uno, su test pasa y `it.fails` falla: hay que pasarlo a `it`.
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
  chooseManyStep: (...args: Parameters<typeof screens.prompts.chooseManyStep>) =>
    screens.prompts.chooseManyStep(...args),
  chooseOne: (...args: Parameters<typeof screens.prompts.chooseOne>) => screens.prompts.chooseOne(...args),
  chooseStep: (...args: Parameters<typeof screens.prompts.chooseStep>) => screens.prompts.chooseStep(...args),
  chooseStepWhileLoading: (...args: Parameters<typeof screens.prompts.chooseStepWhileLoading>) =>
    screens.prompts.chooseStepWhileLoading(...args),
  confirm: (...args: Parameters<typeof screens.prompts.confirm>) => screens.prompts.confirm(...args),
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
        [/Monto total/, '1.500'],
        [/Descripción/, ''],
        [/moneda/, 'Dólares'],
        [/Te pagan en dólares/, 'Sí'],
        [/Forma de pago/, ''],
        [/actividad/, '620100'],
        [/Agregamos/, ['Fecha del comprobante', 'Observaciones']],
        [/Fecha del comprobante/, '17/11/2026'],
        [/Observaciones \(Enter/, BACK],
        [/Fecha del comprobante/, BACK],
        [/Agregamos/, []],
        [/Fecha de pago/, ''],
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
        [/Guardamos el CBU/, 'No'],
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

    expect(lastValidator(/^Fecha de la factura C 00050-00000099/)('19/11/2026')).toBe(
      'La fecha del comprobante asociado (19/11/2026) no puede ser posterior a la de la nota de crédito C (18/11/2026).',
    );
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

  // Tests primero (REV-73): pasa a it() al implementarlo.
  it.fails('REV-73: al repetir una factura en pesos con el mismo monto, no se puede pasar a otra moneda', async () => {
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
        [/Monto total/, '1.500'],
        [/Descripción/, ''],
        [/moneda/, 'Dólares'],
        [/Te pagan en dólares/, 'Sí'],
        [/Forma de pago/, ''],
        [/actividad/, '620100'],
        [/Agregamos/, []],
        [/Fecha de pago/, '25'],
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
        [/Mismo monto/, 'Sí'],
        [/Agregamos/, []],
        [/Fecha de pago/, '25'],
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
      'El comprobante va en dólares y lo cobrás en pesos: cotización oficial de ARCA o la acordada',
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

    const [message, options] = officialRateQuestion() ?? [];

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
