import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { BACK, runWizard, type WizardDependency, type WizardFinalize, type WizardStep } from '../wizard';

type State = Readonly<Record<string, string | undefined>>;
type Script = Array<string | typeof BACK>;

interface Run {
  readonly error?: string;
  readonly memo: unknown;
  readonly name: string;
  readonly previous?: string;
}

/**
 * Pasos que contestan segun el guion (sin guion, "ok") y anotan lo que reciben. Cada paso escribe el campo con su
 * nombre y guarda en su memo lo que respondio, o "a medias" si vuelve.
 */
function scriptedSteps(
  script: Record<string, Script>,
  shape: Record<string, Partial<Pick<WizardStep<State>, 'dependsOn' | 'skip' | 'writes'>>>,
) {
  const runs: Run[] = [];
  const steps: Array<WizardStep<State>> = Object.entries(shape).map(([name, extra]) => ({
    name,
    writes: [name],
    ...extra,
    run: async (_state, previous, memo, error) => {
      runs.push({ error, memo: memo.get(), name, previous: previous?.[name] });

      const answer = script[name]?.shift() ?? 'ok';

      memo.set(answer === BACK ? 'a medias' : answer);

      return answer === BACK ? BACK : { [name]: answer };
    },
  }));

  return { runs, steps };
}

describe('runWizard: memo', () => {
  it('cada paso recibe su memo, que sobrevive a Volver', async () => {
    const { runs, steps } = scriptedSteps({ a: ['1', '1'], b: [BACK, '2'] }, { a: {}, b: {} });

    expect(await runWizard(steps, {})).toEqual({ a: '1', b: '2' });
    expect(runs.map(({ memo, name }) => [name, memo])).toEqual([
      ['a', undefined],
      ['b', undefined],
      ['a', '1'],
      ['b', 'a medias'],
    ]);
  });

  it('si cambia una respuesta, los que dependen de ella olvidan respuesta y memo; los demas los conservan', async () => {
    const { runs, steps } = scriptedSteps(
      { a: ['1', '2'], b: ['x', BACK, 'x'], c: ['y', BACK, 'y'], d: [BACK] },
      { a: {}, b: { dependsOn: ['a'] }, c: {}, d: {} },
    );

    await runWizard(steps, {});

    // a=1, b=x, c=y, d volver, c volver (memo "a medias"), b volver, a=2: b olvido todo, c conserva los suyos.
    expect(runs.slice(6).map(({ memo, name, previous }) => [name, previous, memo])).toEqual([
      ['a', '1', '1'],
      ['b', undefined, undefined],
      ['c', 'y', 'a medias'],
      ['d', undefined, 'a medias'],
    ]);
  });

  it('con `dependsOn` por campos, el memo se olvida solo si cambia uno de esos campos', async () => {
    interface Nested {
      readonly options?: { readonly date?: string; readonly language?: string };
      readonly payment?: string;
    }

    const memos: unknown[] = [];
    const options: Array<NonNullable<Nested['options']>> = [
      { date: '1', language: 'es' },
      { date: '1', language: 'en' },
      { date: '2', language: 'en' },
    ];
    // pago responde, vuelve desde fin, vuelve a opcionales y responde de nuevo.
    const payment: Array<'pago' | typeof BACK> = ['pago', BACK, 'pago', BACK, 'pago'];
    const end: Array<'fin' | typeof BACK> = [BACK, BACK, 'fin'];
    const steps: Array<WizardStep<Nested>> = [
      { name: 'opcionales', run: async () => ({ options: options.shift() }) },
      {
        dependsOn: [{ fields: ['options.date'], step: 'opcionales' }],
        name: 'pago',
        run: async (_state, _previous, memo) => {
          memos.push(memo.get());
          memo.set('recordado');

          return payment.shift() === BACK ? BACK : { payment: 'x' };
        },
      },
      { name: 'fin', run: async () => (end.shift() === BACK ? BACK : {}) },
    ];

    expect(await runWizard(steps, {})).toEqual({ options: { date: '2', language: 'en' }, payment: 'x' });
    // Cambia el idioma: conserva el memo. Cambia la fecha: lo olvida.
    expect(memos).toEqual([undefined, 'recordado', 'recordado', 'recordado', undefined]);
  });

  it('el memo no cuenta para `dependsOn`: cambiarlo no hace olvidar a los que dependen del paso', async () => {
    let round = 0;
    const b: Script = ['x', BACK, 'x'];
    const c: Script = [BACK];
    const seen: Array<string | undefined> = [];
    const steps: Array<WizardStep<State>> = [
      {
        name: 'a',
        run: async (_state, _previous, memo) => {
          round += 1;
          memo.set(`memo ${round}`);

          return { a: 'igual' };
        },
      },
      {
        dependsOn: ['a'],
        name: 'b',
        run: async (_state, previous) => {
          seen.push(previous?.b);

          const answer = b.shift();

          return answer === BACK ? BACK : { b: answer };
        },
      },
      { name: 'c', run: async () => (c.shift() === BACK ? BACK : {}) },
    ];

    // a, b=x, c volver, b volver, a (mismo valor, otro memo), b sigue ofreciendo x.
    expect(await runWizard(steps, {})).toEqual({ a: 'igual', b: 'x' });
    expect(round).toBe(2);
    expect(seen).toEqual([undefined, 'x', 'x']);
  });

  it('`memos` se comparte entre corridas, como `answers`', async () => {
    const memos = new Map<string, unknown>();
    const { runs, steps } = scriptedSteps({ a: [BACK, BACK] }, { a: {} });

    await runWizard(steps, {}, new Map(), { memos });
    await runWizard(steps, {}, new Map(), { memos });

    expect(runs.map(({ memo }) => memo)).toEqual([undefined, 'a medias']);
    expect(memos.get('a')).toBe('a medias');
  });
});

describe('runWizard: finalize', () => {
  /** Falla mientras `b` sea "malo". */
  const finalize: WizardFinalize<State> = (state) =>
    state.b === 'malo' ? { field: 'b', message: 'b no puede ser malo' } : undefined;

  it('si falla, vuelve al paso que escribe el campo, con el error y su respuesta, y despues sigue', async () => {
    const { runs, steps } = scriptedSteps({ a: ['1'], b: ['malo', 'bueno'], c: ['3', '3'] }, { a: {}, b: {}, c: {} });

    expect(await runWizard(steps, {}, new Map(), { finalize })).toEqual({ a: '1', b: 'bueno', c: '3' });
    expect(runs.map(({ error, name, previous }) => [name, previous, error])).toEqual([
      ['a', undefined, undefined],
      ['b', undefined, undefined],
      ['c', undefined, undefined],
      ['b', 'malo', 'b no puede ser malo'],
      ['c', '3', undefined],
    ]);
  });

  it('el estado vuelve al de antes del paso: lo que escribio queda como al inicio hasta que responda', async () => {
    const states: State[] = [];
    const steps: Array<WizardStep<State>> = [
      {
        name: 'b',
        run: async (state, _previous, _memo, error) => {
          states.push(state);

          return { b: error ? 'bueno' : 'malo' };
        },
        writes: ['b'],
      },
    ];

    expect(await runWizard(steps, { b: 'inicial' }, new Map(), { finalize })).toEqual({ b: 'bueno' });
    expect(states).toEqual([{ b: 'inicial' }, { b: 'inicial' }]);
  });

  it('el error se muestra una sola vez: si se vuelve desde el paso, ya no lo trae', async () => {
    const { runs, steps } = scriptedSteps({ a: ['1', '1'], b: ['malo', BACK, 'bueno'] }, { a: {}, b: {} });

    await runWizard(steps, {}, new Map(), { finalize });

    expect(runs.map(({ error, name }) => [name, error])).toEqual([
      ['a', undefined],
      ['b', undefined],
      ['b', 'b no puede ser malo'],
      ['a', undefined],
      ['b', undefined],
    ]);
  });

  it('si dos pasos escriben el campo, vuelve al ultimo que se respondio', async () => {
    const { runs, steps } = scriptedSteps({ a: ['1'], b: ['malo', 'bueno'] }, { a: { writes: ['a', 'b'] }, b: {} });

    await runWizard(steps, {}, new Map(), { finalize });

    expect(runs.map(({ name }) => name)).toEqual(['a', 'b', 'b']);
  });

  it('si ningun paso respondido escribe el campo, termina como hoy (el error queda para la vista previa)', async () => {
    const { runs, steps } = scriptedSteps({ a: ['1'] }, { a: {}, b: { skip: () => true } });

    expect(await runWizard(steps, { b: 'malo' }, new Map(), { finalize })).toEqual({ a: '1', b: 'malo' });
    expect(runs).toHaveLength(1);
  });

  it('sin `writes`, el paso no es dueño de nada', async () => {
    const { steps } = scriptedSteps({ b: ['malo'] }, { b: { writes: undefined } });

    expect(await runWizard(steps, {}, new Map(), { finalize })).toEqual({ b: 'malo' });
  });
});

describe('runWizard: finalize con varios campos, `writes` segun el memo y `resume` (NAV-5)', () => {
  it('con varios campos vuelve al dueño del primero que tenga uno respondido, y se insiste una vez por error', async () => {
    const finalize: WizardFinalize<State> = (state) =>
      state.a === state.b ? { field: ['z', 'b', 'a'], message: 'a y b iguales' } : undefined;
    const { runs, steps } = scriptedSteps({ a: ['1'], b: ['1', '1'] }, { a: {}, b: {} });

    // El dueño de `z` no existe; el de `b` si. Repite la misma respuesta: termina.
    expect(await runWizard(steps, {}, new Map(), { finalize })).toEqual({ a: '1', b: '1' });
    expect(runs.map(({ error, name }) => [name, error])).toEqual([
      ['a', undefined],
      ['b', undefined],
      ['b', 'a y b iguales'],
    ]);
  });

  it('`writes` como funcion: escribe segun su memo (un grupo, solo lo marcado)', async () => {
    const finalize: WizardFinalize<State> = (state) => (state.b === 'malo' ? { field: 'b', message: 'no' } : undefined);
    const { runs, steps } = scriptedSteps(
      { a: ['malo', 'bueno'], b: ['malo', 'bueno'] },
      {
        a: { writes: (_state, memo) => (memo.get() === 'malo' ? ['b'] : []) },
        b: {},
      },
    );

    // `a` respondio "malo": su memo dice que escribe `b`, y es el ultimo dueño respondido... salvo `b`, que va despues.
    await runWizard(steps, {}, new Map(), { finalize });

    expect(runs.map(({ name }) => name)).toEqual(['a', 'b', 'b']);

    const owner = scriptedSteps(
      { a: ['malo', 'malo'] },
      { a: { writes: (_state, memo) => (memo.get() ? ['b'] : []) } },
    );

    await runWizard(owner.steps, { b: 'malo' }, new Map(), { finalize });

    expect(owner.runs.map(({ error, name }) => [name, error])).toEqual([
      ['a', undefined],
      ['a', 'no'],
    ]);
  });

  it('`resume` arranca en el paso que escribe el campo, con el error; los anteriores van como estaban', async () => {
    const answers = new Map([
      ['a', { a: '1' }],
      ['b', { b: '2' }],
      ['c', { c: '3' }],
    ]);
    const { runs, steps } = scriptedSteps({ b: ['nuevo'], c: ['3'] }, { a: {}, b: {}, c: {} });

    expect(await runWizard(steps, {}, answers, { resume: { fields: ['x', 'b'], message: 'b esta mal' } })).toEqual({
      a: '1',
      b: 'nuevo',
      c: '3',
    });
    expect(runs.map(({ error, name, previous }) => [name, previous, error])).toEqual([
      ['b', '2', 'b esta mal'],
      ['c', '3', undefined],
    ]);
  });

  it('`resume`: Volver desde el paso retomado pregunta el anterior; sin dueño, arranca desde el primero', async () => {
    const answers = new Map([
      ['a', { a: '1' }],
      ['b', { b: '2' }],
    ]);
    const back = scriptedSteps({ a: ['1'], b: [BACK, '2'] }, { a: {}, b: {} });

    await runWizard(back.steps, {}, answers, { resume: { fields: ['b'], message: 'mal' } });

    expect(back.runs.map(({ error, name }) => [name, error])).toEqual([
      ['b', 'mal'],
      ['a', undefined],
      ['b', undefined],
    ]);

    const none = scriptedSteps({}, { a: {}, b: {} });

    await runWizard(none.steps, {}, new Map(answers), { resume: { fields: ['z'], message: 'mal' } });

    expect(none.runs.map(({ error, name }) => [name, error])).toEqual([
      ['a', undefined],
      ['b', undefined],
    ]);
  });

  it('`resume` se corta en el primer paso sin respuesta y saltea lo que no aplica', async () => {
    const answers = new Map([['c', { c: '3' }]]);
    const { runs, steps } = scriptedSteps({}, { a: { skip: () => true }, b: {}, c: {} });

    await runWizard(steps, {}, answers, { resume: { fields: ['c'], message: 'mal' } });

    expect(runs.map(({ error, name }) => [name, error])).toEqual([
      ['b', undefined],
      ['c', undefined],
    ]);
  });
});

describe('runWizard sobre grafos al azar (propiedades)', () => {
  const VALUES = ['x', 'y', 'malo'] as const;

  /** Hasta 5 pasos `s0..s4`; cada uno puede depender de anteriores (entero o por su campo) y saltearse si uno anterior es "x". */
  const graph = fc.integer({ max: 5, min: 1 }).chain((size) =>
    fc.tuple(
      ...Array.from({ length: size }, (_, index) =>
        fc.record({
          dependsOn: fc.subarray(
            Array.from({ length: index }, (__, earlier) => earlier),
            { maxLength: Math.min(2, index) },
          ),
          fields: fc.boolean(),
          skipIf: index === 0 ? fc.constant(undefined) : fc.option(fc.integer({ max: index - 1, min: 0 })),
        }),
      ),
    ),
  );
  const script = fc.array(fc.oneof(fc.constantFrom(...VALUES), fc.constant(BACK)), { maxLength: 30 });

  type Shape = Array<{ dependsOn: number[]; fields: boolean; skipIf?: number | null }>;

  function build(shape: Shape, answers: Script) {
    const runs: Array<{
      answer: string | typeof BACK;
      error?: string;
      memo: unknown;
      name: string;
      previous?: string;
    }> = [];
    const steps: Array<WizardStep<State>> = shape.map((node, index) => {
      const name = `s${index}`;

      return {
        dependsOn: node.dependsOn.map((earlier): WizardDependency =>
          node.fields ? { fields: [`s${earlier}`], step: `s${earlier}` } : `s${earlier}`,
        ),
        name,
        run: async (_state, previous, memo, error) => {
          // Sin guion, responde "y": el asistente termina.
          const answer = answers.shift() ?? 'y';

          runs.push({ answer, error, memo: memo.get(), name, previous: previous?.[name] });

          if (answer !== BACK) {
            memo.set(answer);
          }

          return answer === BACK ? BACK : { [name]: answer };
        },
        skip:
          node.skipIf === undefined || node.skipIf === null ? undefined : (state) => state[`s${node.skipIf}`] === 'x',
        writes: [name],
      };
    });

    return { runs, steps };
  }

  const finalize: WizardFinalize<State> = (state) => {
    const field = Object.keys(state).find((key) => state[key] === 'malo');

    return field ? { field, message: `${field} es malo` } : undefined;
  };

  it('el memo y la respuesta se recuerdan y se olvidan juntos', async () => {
    await fc.assert(
      fc.asyncProperty(graph, script, async (shape, answers) => {
        const { runs, steps } = build(shape, [...answers]);

        await runWizard(steps, {}, new Map(), { finalize });

        for (const run of runs) {
          expect(run.memo).toBe(run.previous);
        }
      }),
      { numRuns: 300, seed: 20261120 },
    );
  });

  it('el estado final es lo respondido en el camino, y pasa `finalize` salvo que el dueño insista', async () => {
    await fc.assert(
      fc.asyncProperty(graph, script, async (shape, answers) => {
        const recorded = new Map<string, Partial<State>>();
        const { runs, steps } = build(shape, [...answers]);
        const result = await runWizard(steps, {}, recorded, { finalize });

        if (result === undefined) {
          return;
        }

        // Todo campo escrito es de un paso que aplica con el estado final y vale su ultima respuesta.
        const expected: Record<string, string | undefined> = {};

        for (const step of steps) {
          if (!step.skip?.(expected)) {
            expected[step.name] = recorded.get(step.name)?.[step.name];
          }
        }

        expect(result).toEqual(expected);

        const failed = finalize(result);

        if (failed) {
          // El dueño recibio el error y volvio a dar la misma respuesta.
          const last = runs.findLast((run) => run.name === failed.field && run.answer !== BACK);

          expect(last).toMatchObject({ answer: 'malo', error: `${failed.field} es malo`, previous: 'malo' });
        }
      }),
      { numRuns: 300, seed: 20261121 },
    );
  });

  it('el error de `finalize` llega solo al paso dueño del campo y en la corrida siguiente al fallo', async () => {
    await fc.assert(
      fc.asyncProperty(graph, script, async (shape, answers) => {
        const { runs, steps } = build(shape, [...answers]);
        let failures = 0;

        await runWizard(steps, {}, new Map(), {
          finalize: (state) => {
            const failed = finalize(state);

            failures += failed ? 1 : 0;

            return failed;
          },
        });

        // Cada fallo vuelve a un dueño, salvo el ultimo si el dueño insistio: hubo al menos un error mostrado.
        if (failures > 0) {
          expect(runs.filter((run) => run.error !== undefined).length).toBeGreaterThanOrEqual(failures - 1);
          expect(runs.some((run) => run.error !== undefined)).toBe(true);
        }

        for (const run of runs) {
          if (run.error !== undefined) {
            expect(run.error).toBe(`${run.name} es malo`);
            expect(run.previous).toBe('malo');
          }
        }
      }),
      { numRuns: 300, seed: 20261122 },
    );
  });
});
