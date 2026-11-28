import { Separator } from '@inquirer/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BACK, type Back } from '../../../modules/interactive/wizard';
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
 *
 * El contexto y la respuesta `{ edit }` se tipan aca, como en el plan, y la llamada pasa por casts: asi el test no
 * depende de `EmissionContext` (`emission-closing.ts`), que suma la vista previa guardada a `WizardConfirmContext`.
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

interface Editable {
  readonly id: string;
  readonly label: string;
  readonly value: string;
}

interface ConfirmContext {
  readonly editable: readonly Editable[];
  readonly reopen?: { readonly marked: readonly string[] };
}

type ConfirmResult = Back | void | { readonly edit: readonly string[] };

const EDITABLE: readonly Editable[] = [
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

/** El cierre de un flujo con todo falso: cuenta las vistas previas y anota el orden de las preguntas. */
function createClosing(pdf: 'nunca' | 'siempre' = 'nunca') {
  const order: string[] = [];
  const preview = vi.fn(async () => {
    order.push('vista previa');

    return {
      preview: {
        dryRun: true,
        response: { status: 'aprobado' },
        voucherKind: { displayName: 'factura C', family: 'factura' },
      },
    };
  });
  const emit = vi.fn();
  const closing = {
    emit,
    equivalentCommand: () => 'arcli fc --monto 1210',
    format: () => '',
    generatePdf: vi.fn(async () => undefined),
    preview,
    runtime: { config: { pdf }, environment: 'testing' } as unknown as Pick<CliArcaRuntime, 'config' | 'environment'>,
  } as unknown as EmissionClosing<never, never>;

  // Como los flujos: el contexto que recibe `confirm` llega tal cual al cierre.
  const close = closeWithEmission as unknown as (
    closing: EmissionClosing<never, never>,
    context: ConfirmContext,
  ) => Promise<Back | boolean | { readonly edit: readonly string[] }>;
  const step = (
    emissionStep as unknown as (emit: (state: object, context: ConfirmContext) => ReturnType<typeof close>) => {
      readonly confirm: (state: object, context: ConfirmContext) => Promise<ConfirmResult>;
    }
  )((_state, context) => close(closing, context));

  return { confirm: step.confirm, emit, order, preview };
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
