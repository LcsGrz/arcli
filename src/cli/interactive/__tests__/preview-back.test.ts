import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import { runInvoiceFlow } from '../invoice.flow';
import { runNoteFlow } from '../note.flow';
import { runRepeatFlow } from '../repeat.flow';
import type { InteractiveSession } from '../session';

import { createScreens, recordFlow, withoutTerminal } from './screens';
import { createBillingSession, createExportGateway, NOW } from './screens.fixtures';
import { editing, type ScriptedAnswer } from './script';

/**
 * TUI-15: Esc en "¿Emitimos…?" (la confirmacion despues de la vista previa) vuelve a la ultima pregunta del flujo con
 * todo lo respondido, en vez de ir al menu. Al avanzar de nuevo se llega a la misma vista previa: el mismo comando
 * equivalente. Uno por familia: A, B y C, nota, "Repetir", la E, su nota y "Repetir" E.
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

const ESC_AT_PREVIEW = [/Emitimos/, BACK] as const;
const NO_EMIT = [/Emitimos/, 'No, dejar sin emitir'] as const;

async function run(steps: Steps, flow: (session: InteractiveSession) => Promise<unknown>) {
  screens = createScreens(steps);

  const result = await recordFlow(screens, () => flow(createBillingSession({})));

  expect(screens.remaining(), 'quedaron respuestas del guion sin preguntar').toBe(0);

  return result;
}

/** Lo marcado con que arranco la seleccion de opcionales cada vez que se pregunto. */
const optionalsSelections = () => screens.script.chooseManyStep.mock.calls.map((call) => call[2]);

/** Lo que arranco escrito en `question` cada vez que se pregunto. */
const typedAt = (question: RegExp) =>
  screens.script.askTextStep.mock.calls
    .filter(([message]) => question.test(message))
    .map(([, options]) => options?.previousAnswer);

/** Dos vistas previas con el mismo comando equivalente: se llego a la misma con todo lo respondido. */
function expectSamePreviewTwice() {
  expect(commands).toHaveLength(2);
  expect(commands[1]).toBe(commands[0]);
  expect(screens.asked.filter((message) => /Emitimos/.test(message))).toHaveLength(2);
}

const creditNote = (session: InteractiveSession) => runNoteFlow(session, 'credito');

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

describe('TUI-15: Esc en la vista previa vuelve a la última pregunta', () => {
  it('factura C: vuelve a los opcionales, con lo marcado y lo respondido', async () => {
    const { billingPayload } = await run(
      [
        [/comprobante/, 'Factura C'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '1.000'],
        [/Agregamos/, ['Fecha del comprobante']],
        [/Fecha del comprobante/, '17/11/2026'],
        ESC_AT_PREVIEW,
        [/Agregamos/, ['Fecha del comprobante']],
        [/Fecha del comprobante/, '17/11/2026'],
        NO_EMIT,
      ],
      runInvoiceFlow,
    );

    expect(optionalsSelections()[1]).toEqual(['fecha']);
    expect(typedAt(/Fecha del comprobante/)[1]).toBe('17/11/2026');
    expect(billingPayload?.CbteFch).toBe('20261117');
    expectSamePreviewTwice();
  });

  it('nota de crédito por período: vuelve a los opcionales y llega a la misma vista previa', async () => {
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
        ESC_AT_PREVIEW,
        [/Agregamos/, []],
        NO_EMIT,
      ],
      creditNote,
    );

    expectSamePreviewTwice();
  });

  it('Repetir: vuelve a los opcionales y el período sigue respondido', async () => {
    await run(
      [
        [/Qué comprobante querés repetir/, 'Factura C'],
        [/Cuál repetimos/, '00003-00000014'],
        [/Mismo monto/, 'Sí'],
        [/Período del servicio/, 'El mes pasado'],
        [/Agregamos/, []],
        ESC_AT_PREVIEW,
        // Volver desde los opcionales lleva al período, que arranca marcado con lo elegido.
        [/Agregamos/, BACK],
        [/Período del servicio/, 'El mes pasado'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      runRepeatFlow,
    );

    const periods = screens.script.chooseStep.mock.calls.filter(([message]) => /Período del servicio/.test(message));

    // La segunda vez arranca marcado lo elegido la primera ("El mes pasado"), no lo de la factura repetida.
    expect(periods[1]?.[2]).toBeDefined();
    expect(periods[1]?.[2]).not.toEqual(periods[0]?.[2]);
    expectSamePreviewTwice();
  });

  it('factura E: vuelve a la última pregunta con lo escrito', async () => {
    const { exportPayload } = await run(
      [
        [/comprobante/, 'Factura de exportación E'],
        [/cliente del exterior/, 'ACME LLC'],
        [/Domicilio/, '123 Main St'],
        [/País de destino/, 'ESTADOS UNIDOS'],
        [/ID impositivo/, '12-3456789'],
        [/Qué exportás/, 'Servicios'],
        [/moneda/, 'Dólares'],
        [/Te pagan en dólares/, 'Sí'],
        [/Descripción del ítem 1/, 'Consultoría'],
        [/Cantidad/, ''],
        [/Unidad/, 'unidades'],
        [/^(?:Importe|Precio unitario) en USD/, '1.500'],
        [/Descripción del ítem 2/, ''],
        [/Importe total/, 'Confirmar'],
        [/Forma de pago/, ''],
        [/actividad/, '620100'],
        [/Agregamos/, ['Observaciones']],
        [/Observaciones \(Enter/, 'Primera cuota'],
        [/Observaciones comerciales/, ''],
        [/Fecha de pago/, '30/11/2026'],
        ESC_AT_PREVIEW,
        [/Fecha de pago/, '30/11/2026'],
        NO_EMIT,
      ],
      runInvoiceFlow,
    );

    expect(typedAt(/Fecha de pago/)[1]).toBe('30/11/2026');
    expect(exportPayload?.Fecha_pago).toBe('20261130');
    expectSamePreviewTwice();
  });

  it('nota de crédito E: vuelve a los opcionales, con lo marcado y lo respondido', async () => {
    await run(
      [
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura de exportación E'],
        [/Punto de venta de la factura E/, '3'],
        [/Número de la factura E/, '7'],
        [/^Ítems de .*: marcá qué modificar/, editing({ edit: ['Según detalle'] })],
        [/Descripción del ítem 1/, ''],
        [/Cantidad/, ''],
        [/Unidad/, 'unidades'],
        [/^(?:Importe|Precio unitario) en USD/, '500'],
        [/Importe total/, 'Confirmar'],
        [/Agregamos/, ['Observaciones']],
        [/Observaciones \(Enter/, 'Ajuste de precio'],
        [/Observaciones comerciales/, ''],
        ESC_AT_PREVIEW,
        [/Agregamos/, ['Observaciones']],
        [/Observaciones \(Enter/, 'Ajuste de precio'],
        [/Observaciones comerciales/, ''],
        NO_EMIT,
      ],
      creditNote,
    );

    expect(optionalsSelections()[1]).toEqual(['observaciones']);
    expect(typedAt(/Observaciones \(Enter/)[1]).toBe('Ajuste de precio');
    expectSamePreviewTwice();
  });

  it('Repetir E: vuelve a la última pregunta con lo escrito', async () => {
    await run(
      [
        [/Qué comprobante querés repetir/, 'Factura de exportación E'],
        [/Cuál repetimos/, '00003-00000007'],
        [/^Ítems de .*: marcá qué modificar/, editing({})],
        [/Importe total/, 'Confirmar'],
        [/Agregamos/, []],
        [/Fecha de pago/, '30/11/2026'],
        ESC_AT_PREVIEW,
        [/Fecha de pago/, '30/11/2026'],
        NO_EMIT,
      ],
      runRepeatFlow,
    );

    expect(typedAt(/Fecha de pago/)[1]).toBe('30/11/2026');
    expectSamePreviewTwice();
  });

  it('"No, dejar sin emitir" sigue terminando el flujo sin volver', async () => {
    await run(
      [
        [/comprobante/, 'Factura C'],
        [/A quién/, 'Consumidor final'],
        [/Qué estás facturando/, 'Servicios'],
        [/Monto total/, '1.000'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      runInvoiceFlow,
    );

    expect(commands).toHaveLength(1);
  });
});
