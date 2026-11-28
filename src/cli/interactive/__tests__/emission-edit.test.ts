import { Separator } from '@inquirer/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InputValidationError } from '../../../lib/errors/app-error';
import { BACK, type Back, type WizardEditable } from '../../../modules/interactive/wizard';
import type { CliArcaRuntime } from '../../arca-runtime';
import { closeWithEmission, type EmissionClosing } from '../emission-closing';
import * as emissionPrompt from '../emission-prompt';
import { askEmission, DO_NOT_EMIT_LABEL, EMIT_NOW_LABEL } from '../emission-prompt';
import { listSelect } from '../list-select';
import { multiSelect } from '../multi-select';
import { emissionStep } from '../session';

/*
 * TUI-29 PR 1, "No, editar datos" en el cierre del asistente: la opcion en "¿Emitimos?", la lista "¿Qué datos
 * cambiamos?" y la vuelta sin consultar ARCA de nuevo. Sin mockear `chooseOne` ni `chooseManyStep`, como
 * `session.production-confirm.test.ts`: solo las dos listas de abajo (`listSelect` y `multiSelect`), que eligen por texto
 * o devuelven lo marcado.
 */

vi.mock('../list-select', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../list-select')>()),
  listSelect: vi.fn(),
}));
vi.mock('../multi-select', () => ({ multiSelect: vi.fn() }));

const selectMock = vi.mocked(listSelect);
const multiSelectMock = vi.mocked(multiSelect);

/** El texto de la opcion nueva, escrito aca para comparar con `EDIT_DATA_LABEL` de `emission-prompt.ts`. */
const EDIT_DATA_LABEL = 'No, editar datos';
const EMIT_WITH_PDF_LABEL = 'Sí, emitir y generar el PDF';

const EDITABLE: readonly WizardEditable[] = [
  { id: 'monto', label: 'Monto total', value: '$ 1.210' },
  { id: 'fecha', label: 'Fecha del comprobante', value: '27/11/2026' },
];

interface Asked {
  readonly choices: readonly string[];
  readonly default: unknown;
  readonly message: string;
}

/** Cada "¿Emitimos?" elige la opcion con ese texto, en orden, y anota las opciones y la inicial. */
function pickByName(...names: string[]): Asked[] {
  const asked: Asked[] = [];

  for (const name of names) {
    selectMock.mockImplementationOnce(async (config) => {
      const choices = config.choices.filter(
        (item): item is { name: string; value: unknown } => !Separator.isSeparator(item),
      );

      asked.push({ choices: choices.map((choice) => choice.name), default: config.default, message: config.message });

      const choice = choices.find((item) => item.name === name);

      if (!choice) {
        throw new Error(`"${config.message}" no tiene la opcion "${name}"`);
      }

      return choice.value as never;
    });
  }

  return asked;
}

/** Cada lista de datos devuelve, en orden, lo marcado (o BACK, Esc), y anota lo que arranca marcado. */
function markInList(...answers: Array<Back | string[]>): Array<{ readonly selected: readonly unknown[] }> {
  const opened: Array<{ readonly selected: readonly unknown[] }> = [];

  for (const answer of answers) {
    multiSelectMock.mockImplementationOnce(async (config) => {
      opened.push({ selected: config.selected });

      return answer as never;
    });
  }

  return opened;
}

/** Lo que el cierre usa de un resultado y de una vista previa, en cualquier familia. */
type Closing = Parameters<typeof closeWithEmission>[0];
type Result = Parameters<Closing['format']>[0];
type Preview = Awaited<ReturnType<Closing['preview']>>;

/**
 * El cierre de un flujo con todo falso: cuenta las vistas previas (cada una, un objeto nuevo) y lo que se muestra.
 * `emit` emite lo que recibe, aprobado.
 */
function createClosing(pdf: 'nunca' | 'siempre' = 'nunca') {
  const preview = vi.fn(async (): Promise<Preview> => ({
    preview: {
      dryRun: true,
      response: { cae: null, status: 'aprobado' },
      voucherKind: { displayName: 'factura C', family: 'factura' },
    },
  }));
  const emit = vi.fn(async (previewed: Preview) => ({
    results: [
      { ...previewed.preview, dryRun: false, response: { cae: '12345678901234', status: 'aprobado' as const } },
    ],
  }));
  const format = vi.fn((_result: Result, _options: { readonly previewShown: boolean }) => '');
  const equivalentCommand = vi.fn(() => 'arcli fc --monto 1210');
  const closing: EmissionClosing<Result, Preview> = {
    emit,
    equivalentCommand,
    format,
    generatePdf: vi.fn(async () => undefined),
    preview,
    runtime: { config: { pdf } as CliArcaRuntime['config'], environment: 'testing' },
  };

  // Como los flujos: el contexto que recibe `confirm` llega tal cual al cierre.
  const step = emissionStep<object, Preview>((_state, context) => closeWithEmission(closing, context));

  return { authorized: step.authorized, confirm: step.confirm, emit, equivalentCommand, format, preview };
}

describe('cierre del asistente: "No, editar datos" (TUI-29)', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    selectMock.mockReset();
    multiSelectMock.mockReset();
  });

  it('criterio 11: con datos editables, la opcion va entre emitir con PDF y no emitir, y la inicial no cambia', async () => {
    const { confirm, emit } = createClosing('siempre');
    const asked = pickByName(DO_NOT_EMIT_LABEL);

    await confirm({}, { editable: EDITABLE });

    expect(asked).toEqual([
      {
        choices: [EMIT_NOW_LABEL, EMIT_WITH_PDF_LABEL, EDIT_DATA_LABEL, DO_NOT_EMIT_LABEL],
        default: 'emitir-con-pdf',
        message: '¿Emitimos la factura C en testing?',
      },
    ]);
    expect(emit).not.toHaveBeenCalled();
  });

  it('criterio 11: Esc o Enter sin marcar nada en la lista vuelven a "¿Emitimos?" sin otra vista previa', async () => {
    const { confirm, emit, preview } = createClosing();
    const asked = pickByName(EDIT_DATA_LABEL, EDIT_DATA_LABEL, DO_NOT_EMIT_LABEL);
    const opened = markInList(BACK, []);

    const result = await confirm({}, { editable: EDITABLE });

    expect(asked.map(({ message }) => message)).toEqual([
      '¿Emitimos la factura C en testing?',
      '¿Emitimos la factura C en testing?',
      '¿Emitimos la factura C en testing?',
    ]);
    expect(opened).toHaveLength(2);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });

  it('criterio 11: lo marcado vuelve como `{ edit }`, y con `reopen` la lista abre con eso marcado, sin otra vista previa', async () => {
    const { confirm, emit, preview } = createClosing();
    const state = {};
    const asked = pickByName(EDIT_DATA_LABEL, DO_NOT_EMIT_LABEL);
    const opened = markInList(['monto'], BACK);

    expect(await confirm(state, { editable: EDITABLE })).toEqual({ edit: ['monto'] });

    // Esc en la primera pregunta editada: el motor vuelve con el mismo estado y lo marcado.
    const result = await confirm(state, { editable: EDITABLE, reopen: { marked: ['monto'] } });

    expect(opened).toEqual([{ selected: [] }, { selected: ['monto'] }]);
    // La segunda vez, primero la lista (Esc) y despues "¿Emitimos?" con la vista previa de antes.
    expect(asked).toHaveLength(2);
    expect(selectMock.mock.invocationCallOrder[1]).toBeGreaterThan(
      multiSelectMock.mock.invocationCallOrder[1] ?? Infinity,
    );
    expect(preview).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });

  it('la vista previa guardada sirve para varios `reopen` del mismo estado, y no para otro estado', async () => {
    const { confirm, preview } = createClosing();
    const state = {};

    pickByName(EDIT_DATA_LABEL, DO_NOT_EMIT_LABEL);
    markInList(['monto'], ['fecha'], BACK);

    expect(await confirm(state, { editable: EDITABLE })).toEqual({ edit: ['monto'] });
    expect(await confirm(state, { editable: EDITABLE, reopen: { marked: ['monto'] } })).toEqual({ edit: ['fecha'] });
    expect(preview).toHaveBeenCalledTimes(1);

    // Otro estado con `reopen` (no deberia pasar): no se muestra una vista previa de otra entrada.
    await confirm({}, { editable: EDITABLE, reopen: { marked: ['fecha'] } });

    expect(preview).toHaveBeenCalledTimes(2);
  });

  it('con `reopen`, volver a "¿Emitimos?" muestra de nuevo la vista previa guardada y el comando, sin consultar ARCA', async () => {
    const { confirm, equivalentCommand, format, preview } = createClosing();
    const state = {};

    pickByName(EDIT_DATA_LABEL, DO_NOT_EMIT_LABEL);
    markInList(['monto'], BACK);

    await confirm(state, { editable: EDITABLE });
    expect(format).toHaveBeenCalledTimes(1);
    expect(equivalentCommand).toHaveBeenCalledTimes(1);

    await confirm(state, { editable: EDITABLE, reopen: { marked: ['monto'] } });

    expect(preview).toHaveBeenCalledTimes(1);
    // La misma vista previa, sin marcarla como mostrada, entre la lista (Esc) y "¿Emitimos?".
    expect(format).toHaveBeenCalledTimes(2);
    expect(format.mock.calls[1]).toEqual([(await preview.mock.results[0]?.value)?.preview, { previewShown: false }]);
    expect(equivalentCommand).toHaveBeenCalledTimes(2);
    expect(format.mock.invocationCallOrder[1]).toBeGreaterThan(multiSelectMock.mock.invocationCallOrder[1] ?? Infinity);
    expect(format.mock.invocationCallOrder[1]).toBeLessThan(selectMock.mock.invocationCallOrder[1] ?? -Infinity);
  });

  it('con `reopen`, si se marca algo en la lista no se vuelve a mostrar la vista previa', async () => {
    const { confirm, format } = createClosing();
    const state = {};

    pickByName(EDIT_DATA_LABEL);
    markInList(['monto'], ['fecha']);

    await confirm(state, { editable: EDITABLE });
    await confirm(state, { editable: EDITABLE, reopen: { marked: ['monto'] } });

    expect(format).toHaveBeenCalledTimes(1);
  });

  it('con `reopen`, "Sí, emitir ahora" emite la vista previa de la primera vez', async () => {
    const { confirm, emit, preview } = createClosing();
    const state = {};

    pickByName(EDIT_DATA_LABEL, EMIT_NOW_LABEL);
    markInList(['monto'], BACK);

    await confirm(state, { editable: EDITABLE });
    await confirm(state, { editable: EDITABLE, reopen: { marked: ['monto'] } });

    expect(preview).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toBe(await preview.mock.results[0]?.value);
  });

  it('después de editar, con otro estado y sin `reopen`, emite la vista previa nueva', async () => {
    const { confirm, emit, preview } = createClosing();

    pickByName(EDIT_DATA_LABEL, EMIT_NOW_LABEL);
    markInList(['monto']);

    expect(await confirm({}, { editable: EDITABLE })).toEqual({ edit: ['monto'] });
    await confirm({}, { editable: EDITABLE });

    expect(preview).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toBe(await preview.mock.results[1]?.value);
    expect(emit.mock.calls[0]?.[0]).not.toBe(await preview.mock.results[0]?.value);
  });
});

describe('cierre del asistente: lo que vuelve de la lista y la vista previa guardada (TUI-29)', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    selectMock.mockReset();
    multiSelectMock.mockReset();
  });

  it('`{ edit }` vuelve al motor desde `confirm` y no cuenta como autorizado', async () => {
    const { authorized, confirm, emit } = createClosing();

    pickByName(EDIT_DATA_LABEL);
    markInList(['monto']);

    expect(authorized()).toBe(false);
    expect(await confirm({}, { editable: EDITABLE })).toEqual({ edit: ['monto'] });
    expect(authorized()).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it('sin nada que emitir (`emit` del flujo devuelve undefined), `authorized` queda en false', async () => {
    const step = emissionStep<object, never>(() => undefined);

    expect(await step.confirm({}, { editable: EDITABLE })).toBeUndefined();
    expect(step.authorized()).toBe(false);
  });

  it.each([
    ['Enter sin marcar nada', [] as string[]],
    ['Esc', BACK],
  ] as const)(
    '%s en la lista vuelve a "¿Emitimos?", y lo que se elige ahi decide: nunca `{ edit: [] }`',
    async (_name, answer) => {
      const { authorized, confirm, emit, preview } = createClosing();
      const asked = pickByName(EDIT_DATA_LABEL, EMIT_NOW_LABEL);

      markInList(answer === BACK ? BACK : [...answer]);

      const result = await confirm({}, { editable: EDITABLE });

      expect(result).toBeUndefined();
      expect(asked).toHaveLength(2);
      expect(preview).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(authorized()).toBe(true);
    },
  );

  it('sin `reopen`, volver de la lista a "¿Emitimos?" no vuelve a mostrar la vista previa', async () => {
    const { confirm, equivalentCommand, format } = createClosing();

    pickByName(EDIT_DATA_LABEL, EDIT_DATA_LABEL, DO_NOT_EMIT_LABEL);
    markInList(BACK, []);

    await confirm({}, { editable: EDITABLE });

    expect(format).toHaveBeenCalledTimes(1);
    expect(equivalentCommand).toHaveBeenCalledTimes(1);
  });

  it('con `reopen`, la vista previa guardada se vuelve a mostrar una sola vez aunque la lista se abra dos veces', async () => {
    const { confirm, equivalentCommand, format, preview } = createClosing();
    const state = {};

    pickByName(EDIT_DATA_LABEL, EDIT_DATA_LABEL, DO_NOT_EMIT_LABEL);
    markInList(['monto'], BACK, []);

    await confirm(state, { editable: EDITABLE });
    await confirm(state, { editable: EDITABLE, reopen: { marked: ['monto'] } });

    expect(preview).toHaveBeenCalledTimes(1);
    expect(format).toHaveBeenCalledTimes(2);
    expect(equivalentCommand).toHaveBeenCalledTimes(2);
  });

  it('la vista previa guardada sigue sirviendo despues de reusarla: un segundo `reopen` del mismo estado tampoco consulta', async () => {
    const { confirm, preview } = createClosing();
    const state = {};

    markInList(['monto'], ['fecha'], ['monto']);
    pickByName(EDIT_DATA_LABEL);

    await confirm(state, { editable: EDITABLE });
    await confirm(state, { editable: EDITABLE, reopen: { marked: ['monto'] } });
    await confirm(state, { editable: EDITABLE, reopen: { marked: ['fecha'] } });

    expect(preview).toHaveBeenCalledTimes(1);
  });

  it('otra entrada sin `reopen` descarta la vista previa guardada, aunque su vista previa no se haga', async () => {
    const { confirm, preview } = createClosing();
    const first = {};

    pickByName(EDIT_DATA_LABEL, DO_NOT_EMIT_LABEL);
    markInList(['monto'], BACK);

    await confirm(first, { editable: EDITABLE });
    // La vista previa de la otra rechaza la entrada: vuelve BACK sin guardar nada.
    preview.mockRejectedValueOnce(new InputValidationError('La vista previa no acepta esto.'));
    expect(await confirm({}, { editable: EDITABLE })).toBe(BACK);

    await confirm(first, { editable: EDITABLE, reopen: { marked: ['monto'] } });

    expect(preview).toHaveBeenCalledTimes(3);
  });

  it('`reopen` sin nada guardado hace la vista previa y abre la lista', async () => {
    const { confirm, preview } = createClosing();

    pickByName(DO_NOT_EMIT_LABEL);
    const opened = markInList(BACK);

    await expect(confirm({}, { editable: EDITABLE, reopen: { marked: ['fecha'] } })).resolves.toBeUndefined();

    expect(preview).toHaveBeenCalledTimes(1);
    expect(opened).toEqual([{ selected: ['fecha'] }]);
  });
});

describe('askEmission en los comandos con flags (TUI-29)', () => {
  afterEach(() => {
    selectMock.mockReset();
  });

  it('criterio 12: sin el modo del asistente no ofrece "No, editar datos"', async () => {
    const asked = pickByName(DO_NOT_EMIT_LABEL);

    expect(emissionPrompt.EDIT_DATA_LABEL).toBe(EDIT_DATA_LABEL);
    expect(await askEmission('¿Emitimos la factura C en testing?', { initial: 'emitir', offerPdf: true })).toBe(false);
    expect(asked.map(({ choices }) => choices)).toEqual([[EMIT_NOW_LABEL, EMIT_WITH_PDF_LABEL, DO_NOT_EMIT_LABEL]]);
  });
});
