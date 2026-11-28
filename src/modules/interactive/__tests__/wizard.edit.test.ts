import { describe, expect, it } from 'vitest';

import {
  BACK,
  NOT_ASKED,
  runWizard,
  type WizardAnswers,
  type WizardConfirmContext,
  type WizardConfirmResult,
  type WizardFinalize,
  type WizardStep,
} from '../wizard';

/*
 * TUI-29 PR 1, "No, editar datos": el paso de edicion del motor, con pasos falsos. Desde "¿Emitimos?" (`confirm`) se
 * marcan datos (`{ edit: ids }`) y se pregunta solo eso, con lo que depende de eso; el resto pasa sin preguntar.
 */

type State = Readonly<Record<string, unknown>>;
type Script = Array<string | typeof BACK | typeof NOT_ASKED>;
type ConfirmContext = WizardConfirmContext;
type ConfirmResult = WizardConfirmResult;
type EditableStep = WizardStep<State>;

const runEditable = runWizard<State>;

interface Run {
  readonly error?: string;
  readonly name: string;
  readonly previous?: unknown;
  readonly state: State;
}

/**
 * Pasos que contestan segun el guion (sin guion, "ok"), escriben el campo con su nombre, guardan la respuesta en el memo
 * y anotan lo que reciben. Como los de `wizard.engine.test.ts`.
 */
function scriptedSteps(
  script: Record<string, Script>,
  shape: Record<string, Partial<Omit<EditableStep, 'name' | 'run'>>>,
) {
  const runs: Run[] = [];
  const steps: EditableStep[] = Object.entries(shape).map(([name, extra]) => ({
    name,
    writes: [name],
    ...extra,
    run: async (state, { error, memo, previous }) => {
      runs.push({ error, name, previous: previous?.[name], state });

      const answer = script[name]?.shift() ?? 'ok';

      if (answer === NOT_ASKED) {
        return NOT_ASKED;
      }

      memo.set(answer === BACK ? 'a medias' : answer);

      return answer === BACK ? BACK : { [name]: answer };
    },
  }));

  return { runs, steps };
}

/** Un dato editable que se muestra como `<etiqueta>: <campo>`. */
const editAs = (id: string, label = id, field = id) => ({
  describe: (state: State) => `${label}: ${String(state[field])}`,
  id,
  label,
});

/** `confirm` que responde en orden y anota lo que recibe. Sin respuestas, confirma. */
function scriptedConfirm(...results: ConfirmResult[]) {
  const calls: Array<{ readonly context: ConfirmContext; readonly state: State }> = [];
  const confirm = async (state: State, context: ConfirmContext): Promise<ConfirmResult> => {
    calls.push({ context, state });

    return results.shift();
  };

  return { calls, confirm };
}

/** Lo que se pregunto despues de las primeras `firstPass` preguntas (la primera pasada): nombre y respuesta anterior. */
const askedAfter = (runs: readonly Run[], firstPass: number) =>
  runs.slice(firstPass).map(({ name, previous }) => [name, previous]);

describe('runWizard: datos editables en "¿Emitimos?" (TUI-29)', () => {
  it('criterio 2: `editable` lista los pasos respondidos con `edit`, uno por id y en orden, con `describe` del estado final', async () => {
    const { steps } = scriptedSteps(
      { cot: [NOT_ASKED], f: ['uno'], g: ['dos'], monto: ['100'] },
      {
        monto: { edit: editAs('monto', 'Monto total') },
        salteado: { edit: editAs('salteado'), skip: () => true },
        automatico: { auto: () => ({ automatico: 'solo' }), edit: editAs('automatico') },
        cot: { edit: editAs('cot') },
        sinEdit: {},
        // Un grupo: los dos pasos con el mismo id son un solo dato, que describe el primero con el estado final.
        f: { edit: { describe: (state) => `${String(state.f)} y ${String(state.g)}`, id: 'grupo', label: 'Grupo' } },
        g: { edit: { describe: () => 'el segundo no se usa', id: 'grupo', label: 'Grupo' } },
      },
    );
    const { calls, confirm } = scriptedConfirm();

    await runEditable(steps, {}, new Map(), { confirm });

    expect(calls[0]?.context?.editable).toEqual([
      { id: 'monto', label: 'Monto total', value: 'Monto total: 100' },
      { id: 'grupo', label: 'Grupo', value: 'uno y dos' },
    ]);
  });

  it('criterio 3: `{ edit: [monto] }` pregunta solo el monto, con su respuesta anterior, y confirma el monto nuevo', async () => {
    const { runs, steps } = scriptedSteps(
      { monto: ['100', '250'] },
      { tipo: {}, monto: { edit: editAs('monto') }, fecha: { edit: editAs('fecha') }, nota: {} },
    );
    const { calls, confirm } = scriptedConfirm({ edit: ['monto'] });

    const result = await runEditable(steps, {}, new Map(), { confirm });

    expect(askedAfter(runs, 4)).toEqual([['monto', '100']]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.state).toEqual({ fecha: 'ok', monto: '250', nota: 'ok', tipo: 'ok' });
    expect(result).toEqual({ fecha: 'ok', monto: '250', nota: 'ok', tipo: 'ok' });
  });

  it('criterio 4: pregunta tambien lo que depende de lo editado y lo que ahora aplica; lo que deja de aplicar no queda', async () => {
    const { runs, steps } = scriptedSteps(
      { dep: ['x', 'y'], nuevo: ['n'], tipo: ['a', 'b'], viejo: ['v'] },
      {
        tipo: { edit: editAs('tipo') },
        dep: { dependsOn: ['tipo'] },
        // Antes se salteaba (tipo a): con tipo b aplica y no tiene respuesta.
        nuevo: { skip: (state) => state.tipo !== 'b' },
        // Antes aplicaba: con tipo b deja de aplicar.
        viejo: { skip: (state) => state.tipo !== 'a' },
        otro: {},
      },
    );
    const { calls, confirm } = scriptedConfirm({ edit: ['tipo'] });

    await runEditable(steps, {}, new Map(), { confirm });

    expect(askedAfter(runs, 4)).toEqual([
      ['tipo', 'a'],
      ['dep', undefined],
      ['nuevo', undefined],
    ]);
    expect(calls[1]?.state).toEqual({ dep: 'y', nuevo: 'n', otro: 'ok', tipo: 'b' });
  });

  it('criterio 5: un grupo (dos pasos con el mismo id) marcado pregunta los dos', async () => {
    const { runs, steps } = scriptedSteps(
      { moneda: ['PES', 'DOL'], monto: ['100', '80'] },
      {
        tipo: {},
        moneda: { edit: editAs('importe', 'Importe', 'monto') },
        monto: { edit: editAs('importe', 'Importe', 'monto') },
        nota: {},
      },
    );
    const { calls, confirm } = scriptedConfirm({ edit: ['importe'] });

    await runEditable(steps, {}, new Map(), { confirm });

    expect(askedAfter(runs, 4)).toEqual([
      ['moneda', 'PES'],
      ['monto', '100'],
    ]);
    expect(calls[1]?.state).toEqual({ moneda: 'DOL', monto: '80', nota: 'ok', tipo: 'ok' });
  });

  it('criterio 6: Esc en la primera pregunta editada reabre la lista con lo marcado, el mismo estado y las respuestas y memos de antes', async () => {
    // tipo cambia (dep olvida su respuesta y su memo), dep empieza a responder y vuelve, y tipo vuelve: nada de eso queda.
    const { steps } = scriptedSteps(
      { dep: ['x', BACK], tipo: ['a', 'b', BACK] },
      { tipo: { edit: editAs('tipo') }, dep: { dependsOn: ['tipo'] }, monto: { edit: editAs('monto') } },
    );
    const answers: WizardAnswers<State> = new Map();
    const memos = new Map<string, unknown>();
    const { calls, confirm } = scriptedConfirm({ edit: ['tipo', 'monto'] });
    let before: { answers: unknown; memos: unknown } | undefined;

    const result = await runEditable(steps, {}, answers, {
      confirm: async (state, context) => {
        before ??= { answers: structuredClone([...answers]), memos: structuredClone([...memos]) };

        return confirm(state, context);
      },
      memos,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.context?.reopen).toEqual({ marked: ['tipo', 'monto'] });
    expect(calls[1]?.state).toBe(calls[0]?.state);
    expect([...answers]).toEqual(before?.answers);
    expect([...memos]).toEqual(before?.memos);
    expect(result).toEqual({ dep: 'x', monto: 'ok', tipo: 'a' });
  });

  it('criterio 6: despues del descarte, Esc en "¿Emitimos?" vuelve a la misma pregunta que antes de editar', async () => {
    // La historia vuelve a ser la de antes de editar: sin eso, Esc iria a lo que paso sin preguntar al editar o saldria.
    const { runs, steps } = scriptedSteps(
      { monto: ['100', BACK, '150'], tipo: ['a', 'b', BACK] },
      { tipo: { edit: editAs('tipo') }, nota: {}, monto: { edit: editAs('monto') } },
    );
    const { calls, confirm } = scriptedConfirm({ edit: ['tipo', 'monto'] }, BACK);

    const result = await runEditable(steps, {}, new Map(), { confirm });

    // Primera pasada (tipo, nota, monto), la edicion (tipo b, Esc en monto, Esc en tipo) y, con Esc en el "¿Emitimos?"
    // reabierto, el monto de antes de editar.
    expect(askedAfter(runs, 6)).toEqual([['monto', '100']]);
    expect(runs[6]?.state).toEqual({ nota: 'ok', tipo: 'a' });
    expect(calls).toHaveLength(3);
    expect(calls[2]?.state).toEqual({ monto: '150', nota: 'ok', tipo: 'a' });
    expect(result).toEqual({ monto: '150', nota: 'ok', tipo: 'a' });
  });

  it('criterio 7: Esc en la segunda pregunta editada vuelve a la primera editada, no al paso que paso sin preguntar', async () => {
    const { runs, steps } = scriptedSteps(
      { a: ['1', '2', '3'], c: ['x', BACK, 'y'] },
      { a: { edit: editAs('a') }, medio: {}, c: { edit: editAs('c') }, d: {} },
    );
    const { calls, confirm } = scriptedConfirm({ edit: ['a', 'c'] });

    await runEditable(steps, {}, new Map(), { confirm });

    expect(askedAfter(runs, 4)).toEqual([
      ['a', '1'],
      ['c', 'x'],
      ['a', '2'],
      ['c', 'x'],
    ]);
    expect(calls[1]?.state).toEqual({ a: '3', c: 'y', d: 'ok', medio: 'ok' });
  });

  it('criterio 8: despues de editar, Esc en el "¿Emitimos?" nuevo vuelve a la ultima pregunta del flujo con los datos nuevos', async () => {
    const { runs, steps } = scriptedSteps({ a: ['1', '2'], c: ['x', 'z'] }, { a: { edit: editAs('a') }, b: {}, c: {} });
    const { calls, confirm } = scriptedConfirm({ edit: ['a'] }, BACK);

    await runEditable(steps, {}, new Map(), { confirm });

    // Primera pasada (a, b, c), la edicion (a) y, con Esc en el "¿Emitimos?" nuevo, la ultima pregunta (c).
    expect(askedAfter(runs, 3)).toEqual([
      ['a', '1'],
      ['c', 'x'],
    ]);
    expect(runs[4]?.state).toEqual({ a: '2', b: 'ok' });
    expect(calls).toHaveLength(3);
    expect(calls[2]?.state).toEqual({ a: '2', b: 'ok', c: 'z' });
  });

  it('criterio 9: si `finalize` falla despues de editar, vuelve al dueño del campo aunque no este marcado', async () => {
    // Como la moneda de los opcionales, que lleva al monto: lo editado es la moneda, el que falla es el monto.
    const finalize: WizardFinalize<State> = (state) =>
      state.moneda === 'DOL' && state.monto === '100'
        ? { field: 'monto', message: 'el monto no va en dólares' }
        : undefined;
    const { runs, steps } = scriptedSteps(
      { moneda: ['PES', 'DOL', 'DOL'], monto: ['100', '80'] },
      { monto: {}, moneda: { edit: editAs('moneda') }, nota: {} },
    );
    const { calls, confirm } = scriptedConfirm({ edit: ['moneda'] });

    await runEditable(steps, {}, new Map(), { confirm, finalize });

    expect(runs.slice(3, 5).map(({ error, name }) => [name, error])).toEqual([
      ['moneda', undefined],
      ['monto', 'el monto no va en dólares'],
    ]);
    expect(calls[1]?.state).toEqual({ moneda: 'DOL', monto: '80', nota: 'ok' });
  });

  /** `tipo` editable segun el guion y `doc`, que pregunta solo con `tipo` b y si no da `NOT_ASKED`, como `requiredOptional`. */
  function stateDecidedSteps(tipo: Script, docShape: Partial<Omit<EditableStep, 'name' | 'run'>> = {}) {
    const { runs, steps } = scriptedSteps({ tipo }, { tipo: { edit: editAs('tipo') } });
    const docRuns: State[] = [];
    const doc: EditableStep = {
      name: 'doc',
      writes: ['doc'],
      ...docShape,
      run: async (state) => {
        docRuns.push(state);

        return state.tipo === 'b' ? { doc: `dni de ${String(state.tipo)}` } : NOT_ASKED;
      },
    };

    return { docRuns, runs, steps: [...steps, doc] };
  }

  it('un paso que no pregunto (`NOT_ASKED`) vuelve a correr al editar: con el estado nuevo puede preguntar', async () => {
    // Sin `dependsOn`, como el documento del consumidor final segun el tope de la RG 5700: el estado decide en `run`.
    const { docRuns, runs, steps } = stateDecidedSteps(['a', 'b']);
    const { calls, confirm } = scriptedConfirm({ edit: ['tipo'] });

    await runEditable(steps, {}, new Map(), { confirm });

    expect(runs.map(({ name }) => name)).toEqual(['tipo', 'tipo']);
    expect(docRuns).toEqual([{ tipo: 'a' }, { tipo: 'b' }]);
    expect(calls[1]?.state).toEqual({ doc: 'dni de b', tipo: 'b' });
  });

  it('con `resume`, un paso que no pregunto (`NOT_ASKED`) sigue pasando de largo', async () => {
    const { docRuns, steps } = stateDecidedSteps([]);
    const answers: WizardAnswers<State> = new Map<string, State>([
      ['tipo', { tipo: 'a' }],
      ['doc', NOT_ASKED],
      ['nota', { nota: 'vieja' }],
    ]);
    const nota: EditableStep = { name: 'nota', run: async () => ({ nota: 'n' }), writes: ['nota'] };

    const result = await runEditable([...steps, nota], {}, answers, {
      resume: { fields: ['nota'], message: 'la nota no va' },
    });

    expect(docRuns).toHaveLength(0);
    expect(result).toEqual({ nota: 'n', tipo: 'a' });
  });

  it('un paso que pregunto y con el estado nuevo no pregunta, con `dependsOn`, no deja su respuesta vieja', async () => {
    // El caso inverso: el motor solo sabe que un paso con respuesta dejo de aplicar si lo dice `dependsOn` (o `skip`).
    const { docRuns, steps } = stateDecidedSteps(['b', 'a'], { dependsOn: ['tipo'] });
    const { calls, confirm } = scriptedConfirm({ edit: ['tipo'] });

    await runEditable(steps, {}, new Map(), { confirm });

    expect(calls[0]?.state).toEqual({ doc: 'dni de b', tipo: 'b' });
    expect(docRuns).toEqual([{ tipo: 'b' }, { tipo: 'a' }]);
    expect(calls[1]?.state).toEqual({ tipo: 'a' });
  });
});
