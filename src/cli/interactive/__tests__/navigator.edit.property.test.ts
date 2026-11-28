import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { BACK, runWizard, type WizardStep } from '../../../modules/interactive/wizard';

/*
 * Los tests al azar del navegador (NAV-0, `navigator.property.test.ts`) para la accion "editar" de "No, editar datos"
 * (TUI-29): en cada "¿Emitimos?", confirmar, volver o marcar un subconjunto de los datos editables, y en cada pregunta,
 * responder o volver. Aparte de aquel archivo porque no corre los flujos reales y aquel ya llega al tope de lineas.
 *
 * En el PR 1 de TUI-29 ningun paso real declara `edit`, asi que la accion se prueba con un asistente falso que tiene lo
 * que la complica: un dato que depende de otro (`dependsOn`), uno que aparece o desaparece segun otro (`skip`), un grupo
 * (dos pasos con el mismo id), un paso `auto` y uno sin `edit`. Cuando los flujos declaren `edit` (PR 2 y 3), el
 * asistente al azar de `random-assistant.ts` tiene que poder elegir "No, editar datos" en los flujos de
 * `navigator.property.test.ts`.
 *
 * La API todavia no existe: el contexto y la respuesta `{ edit }` se tipan aca, como en el plan.
 */

type EditState = Readonly<Record<string, unknown>>;

interface EditContext {
  readonly editable: ReadonlyArray<{ readonly id: string; readonly label: string; readonly value: string }>;
  readonly reopen?: { readonly marked: readonly string[] };
}

type EditableStep = WizardStep<EditState> & {
  readonly edit?: { readonly describe: (state: EditState) => string; readonly id: string; readonly label: string };
};

const runEditable = runWizard as unknown as (
  steps: ReadonlyArray<EditableStep>,
  initial: EditState,
  answers?: Map<string, Partial<EditState>>,
  options?: {
    // Opcional solo mientras el motor no lo pase (hoy llama a `confirm` con el estado solo).
    readonly confirm?: (
      state: EditState,
      context?: EditContext,
    ) => Promise<typeof BACK | void | { readonly edit: readonly string[] }>;
  },
) => Promise<EditState | undefined>;

/** Los pasos del asistente falso, con las respuestas que puede dar cada uno. */
const EDIT_FLOW: ReadonlyArray<{
  readonly answers?: readonly string[];
  readonly step: Omit<EditableStep, 'run'>;
}> = [
  { answers: ['a', 'b'], step: { edit: { describe: (s) => String(s.tipo), id: 'tipo', label: 'Tipo' }, name: 'tipo' } },
  {
    answers: ['d1', 'd2'],
    step: {
      dependsOn: ['tipo'],
      edit: { describe: (s) => String(s.doc), id: 'doc', label: 'Documento' },
      name: 'doc',
      skip: (s) => s.tipo === 'a',
    },
  },
  {
    answers: ['PES', 'DOL'],
    step: {
      edit: { describe: (s) => `${String(s.moneda)} ${String(s.monto)}`, id: 'importe', label: 'Importe' },
      name: 'moneda',
    },
  },
  {
    answers: ['100', '200'],
    step: { edit: { describe: () => '', id: 'importe', label: 'Importe' }, name: 'monto' },
  },
  { step: { auto: (s) => ({ total: `${String(s.moneda)} ${String(s.monto)}` }), name: 'total' } },
  {
    answers: ['c1', 'c2'],
    step: {
      dependsOn: [{ fields: ['moneda'], step: 'moneda' }],
      edit: { describe: (s) => String(s.cotizacion), id: 'cotizacion', label: 'Cotización' },
      name: 'cotizacion',
      skip: (s) => s.moneda !== 'DOL',
    },
  },
  { answers: ['n1', 'n2'], step: { name: 'nota' } },
];

/** Los pasos que pueden preguntarse sin estar marcados: los que dependen de otro o aparecen segun otro. */
const ASKED_WITHOUT_MARK = new Set(['doc', 'cotizacion']);

/** Lo que daria recorrer el flujo a mano con la ultima respuesta de cada paso. */
function walkByHand(latest: ReadonlyMap<string, string>): EditState {
  let state: EditState = {};

  for (const { step } of EDIT_FLOW) {
    const memo = { get: () => undefined, set: () => undefined };

    if (step.skip?.(state, memo)) {
      continue;
    }

    const automatic = step.auto?.(state, memo);

    state = { ...state, ...(automatic ?? { [step.name]: latest.get(step.name) }) };
  }

  return state;
}

/** Una corrida del asistente falso: responde, vuelve, confirma o edita al azar, y controla cada confirmacion. */
async function walkEditing(g: fc.GeneratorValue): Promise<number> {
  const latest = new Map<string, string>();
  let beforeEdit: { readonly ids: readonly string[]; readonly latest: Map<string, string> } | undefined;
  let marked: ReadonlySet<string> | undefined;
  let questions = 0;
  let confirms = 0;
  let edits = 0;
  /** Despues de `{ edit }` el asistente tiene que volver a "¿Emitimos?", con los datos nuevos o los de antes. */
  let pendingEdit = false;
  const steps: EditableStep[] = EDIT_FLOW.map(({ answers, step }) => ({
    ...step,
    run: async () => {
      questions += 1;

      if (marked) {
        expect(
          marked.has(step.name) || ASKED_WITHOUT_MARK.has(step.name),
          `${step.name} se pregunto sin estar marcado`,
        ).toBe(true);
      }

      // Sin tope, una corrida podria ir y volver sin terminar: pasado el tope, vuelve hasta salir.
      if (questions > 200 || g(fc.integer, { max: 99, min: 0 }) < 20) {
        return BACK;
      }

      const answer = g(fc.constantFrom, ...(answers ?? ['ok']));

      latest.set(step.name, answer);

      return { [step.name]: answer };
    },
  }));

  await runEditable(steps, {}, new Map(), {
    confirm: async (state, context) => {
      confirms += 1;
      pendingEdit = false;

      // Esc en la primera pregunta editada: lo respondido en el paso de edicion no cuenta.
      if (context?.reopen && beforeEdit) {
        expect(context.reopen.marked, 'la lista no reabre con lo marcado').toEqual(beforeEdit.ids);
        latest.clear();
        beforeEdit.latest.forEach((value, key) => latest.set(key, value));
      }

      marked = undefined;
      expect(state, 'lo confirmado no es lo de recorrer el flujo a mano').toEqual(walkByHand(latest));

      const ids = (context?.editable ?? []).map(({ id }) => id);
      const action =
        questions > 200 || confirms > 6 ? 'emitir' : g(fc.constantFrom, 'emitir', 'volver', 'editar', 'editar');

      if (action === 'volver') {
        return BACK;
      }

      if (action === 'emitir' || ids.length === 0) {
        return undefined;
      }

      const edit = g(fc.subarray, ids, { minLength: 1 });

      edits += 1;
      pendingEdit = true;
      beforeEdit = { ids: edit, latest: new Map(latest) };
      marked = new Set(
        EDIT_FLOW.filter(({ step }) => step.edit && edit.includes(step.edit.id)).map(({ step }) => step.name),
      );

      return { edit };
    },
  });

  expect(pendingEdit, 'despues de editar no volvio a "¿Emitimos?"').toBe(false);

  return edits;
}

describe('asistente al azar: "No, editar datos" (TUI-29)', () => {
  // Tests primero (TUI-29): pasa a it() al implementarlo.
  it.fails(
    'criterio 10: editar al azar pregunta solo lo marcado y lo que depende, y confirma lo mismo que recorrer el flujo a mano',
    async () => {
      let edits = 0;

      await fc.assert(
        fc.asyncProperty(fc.gen(), async (g) => {
          edits += await walkEditing(g);
        }),
        { endOnFailure: true, numRuns: 300, seed: 20261127 },
      );

      // Si casi ninguna corrida edita, la propiedad no prueba nada.
      expect(edits, 'pocas ediciones').toBeGreaterThanOrEqual(50);
    },
  );
});
