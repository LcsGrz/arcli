import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { exchangeRateWarnings } from '../../../modules/billing/billing.currency';
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
 * Reproducciones de la auditoria del asistente del 19/11 (REV-67 a REV-74, docs/backlog/auditoria-asistente-19-11.md):
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

/** El validador con que se pregunto `question` la ultima vez. */
function lastValidator(question: RegExp): (value: string) => string | true {
  const call = screens.script.askTextStep.mock.calls.findLast(([message]) => question.test(message));
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

  // Tests primero (REV-69): pasa a it() al implementarlo.
  it.fails(
    'REV-69: "Servicio hasta" y "Vencimiento del pago" se cruzan con las otras fechas al preguntarlas',
    async () => {
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
      expect(lastValidator(/Vencimiento del pago/)('16/11/2026')).toEqual(
        expect.stringMatching(/no puede ser anterior/),
      );
    },
  );

  // Tests primero (REV-70): pasa a it() al implementarlo.
  it.fails('REV-70: exento más no gravado se controla contra el total al preguntarlo', async () => {
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

  // Tests primero (REV-71): pasa a it() al implementarlo.
  it.fails(
    'REV-71: en una nota por período, "Período hasta" no acepta un día posterior a la fecha de la nota',
    async () => {
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
    },
  );

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
  // BUG: "CUIT del receptor" acepta el CUIT del emisor y recien la vista previa lo rechaza ("El receptor no puede ser
  // el mismo CUIT que emite (20111111112): ARCA lo rechaza (error 10069)."), que vuelve al menu y pierde todo. Viola la
  // invariante 1 de `navigator.property.test.ts`: con '20-11111111-2' en la fila "CUIT del receptor" de su tabla falla
  // con { seed: 20261119, path: "8" } en factura, "22" en recibo y "13" en notas. Sin ticket todavia.
  it.skip('"CUIT del receptor" no acepta el CUIT del emisor', async () => {
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
