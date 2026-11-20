import { describe, expect, it } from 'vitest';

import { BACK, runWizard, type WizardFinalize, type WizardStep } from '../wizard';

type State = Readonly<Record<string, unknown>>;
type Script = Array<string | typeof BACK>;

interface Run {
  readonly error?: string;
  readonly name: string;
  readonly previous?: unknown;
}

/** Pasos que contestan segun el guion (sin guion, "ok"), escriben el campo con su nombre y anotan lo que reciben. */
function scriptedSteps(
  script: Record<string, Script>,
  shape: Record<string, Partial<Omit<WizardStep<State>, 'name' | 'run'>>>,
) {
  const runs: Run[] = [];
  const steps: Array<WizardStep<State>> = Object.entries(shape).map(([name, extra]) => ({
    name,
    writes: [name],
    ...extra,
    run: async (_state, { error, memo, previous }) => {
      runs.push({ error, name, previous: previous?.[name] });

      const answer = script[name]?.shift() ?? 'ok';

      memo.set(answer === BACK ? 'a medias' : answer);

      return answer === BACK ? BACK : { [name]: answer };
    },
  }));

  return { runs, steps };
}

describe('runWizard: finalize con un dueño que insiste', () => {
  const finalize: WizardFinalize<State> = (state) =>
    state.b === 'malo' ? { field: 'b', message: 'b no puede ser malo' } : undefined;

  it('si el dueño repite la respuesta que fallo, termina con ella (el error queda para la vista previa)', async () => {
    let runs = 0;
    const steps: Array<WizardStep<State>> = [
      {
        name: 'b',
        run: async () => {
          runs += 1;

          return { b: 'malo' };
        },
        writes: ['b'],
      },
    ];

    expect(await runWizard(steps, {}, new Map(), { finalize })).toEqual({ b: 'malo' });
    expect(runs).toBe(2);
  });

  it('si la cambia por otra que tambien falla, vuelve a preguntar', async () => {
    const strict: WizardFinalize<State> = (state) =>
      state.b === 'bueno' ? undefined : { field: 'b', message: 'b tiene que ser bueno' };
    const { runs, steps } = scriptedSteps({ b: ['malo', 'peor', 'peor'] }, { b: {} });

    expect(await runWizard(steps, {}, new Map(), { finalize: strict })).toEqual({ b: 'peor' });
    expect(runs.map(({ error }) => error)).toEqual([undefined, 'b tiene que ser bueno', 'b tiene que ser bueno']);
  });

  it('busca al dueño en lo respondido, no en un paso salteado que tambien lo escribe', async () => {
    const { runs, steps } = scriptedSteps(
      { a: ['1'], b: ['malo', 'bueno'] },
      { a: {}, b: {}, c: { skip: () => true, writes: ['b'] } },
    );

    expect(await runWizard(steps, {}, new Map(), { finalize })).toEqual({ a: '1', b: 'bueno' });
    expect(runs.map(({ name }) => name)).toEqual(['a', 'b', 'b']);
  });
});

describe('runWizard: dependsOn', () => {
  it('olvida en cadena (a → b → c → d) aunque los del medio ya no se pregunten', async () => {
    // a cambia a "saltar": b y c se saltean y no vuelven a responder, pero d depende de c, y c de b: olvida igual.
    const skip = (state: State) => state.a === 'saltar';
    const { runs, steps } = scriptedSteps(
      { a: ['1', 'saltar'], b: ['x', BACK], c: ['y', BACK], d: ['z', BACK, 'z'], e: [BACK] },
      {
        a: {},
        b: { dependsOn: ['a'], skip },
        c: { dependsOn: ['b'], skip },
        d: { dependsOn: ['c'] },
        e: {},
      },
    );

    await runWizard(steps, {});

    expect(runs.slice(-2).map(({ name, previous }) => [name, previous])).toEqual([
      ['d', undefined],
      ['e', undefined],
    ]);
  });

  it('no olvida a quien depende de un paso que no cambio', async () => {
    // a cambia: b olvida; d depende de c, que no depende de nadie: conserva.
    const { runs, steps } = scriptedSteps(
      { a: ['1', '2'], b: ['x', BACK, 'x'], c: ['y', BACK, 'y'], d: ['z', BACK, 'z'], e: [BACK] },
      { a: {}, b: { dependsOn: ['a'] }, c: {}, d: { dependsOn: ['c'] }, e: {} },
    );

    await runWizard(steps, {});

    expect(runs.slice(-4).map(({ name, previous }) => [name, previous])).toEqual([
      ['b', undefined],
      ['c', 'y'],
      ['d', 'z'],
      ['e', undefined],
    ]);
  });

  /**
   * "otro" escribe `a` (con un valor distinto cada vez), "opcionales" escribe `options` segun el guion y "pago" depende
   * de los campos `fields` del paso `step`. Desde el final se vuelve hasta "otro" una vez.
   */
  function fieldsFlow(options: unknown[], fields: string[], step = 'opcionales') {
    const seen: unknown[] = [];
    const end: Array<'fin' | typeof BACK> = [BACK, 'fin'];
    const payment: Array<'pago' | typeof BACK> = ['pago', BACK, 'pago'];
    const optionsBack: Array<'sigue' | typeof BACK> = ['sigue', BACK, 'sigue'];
    let round = 0;
    const steps: Array<WizardStep<State>> = [
      {
        name: 'otro',
        run: async () => {
          round += 1;

          return { a: { date: String(round) } };
        },
      },
      {
        name: 'opcionales',
        run: async () => {
          const value = options.shift();

          return optionsBack.shift() === BACK ? BACK : { options: value };
        },
      },
      {
        dependsOn: [{ fields, step }],
        name: 'pago',
        run: async (_state, { previous }) => {
          seen.push(previous?.b);

          return payment.shift() === BACK ? BACK : { b: 'pagado' };
        },
      },
      { name: 'fin', run: async () => (end.shift() === BACK ? BACK : {}) },
    ];

    return { seen, steps };
  }

  it('con varios campos, alcanza con que cambie uno', async () => {
    const { seen, steps } = fieldsFlow(
      [{ date: '1', language: 'es' }, undefined, { date: '2', language: 'es' }],
      ['options.language', 'options.date'],
    );

    await runWizard(steps, {});

    expect(seen).toEqual([undefined, 'pagado', undefined]);
  });

  it('con campos, el cambio del mismo campo en otro paso no cuenta', async () => {
    // pago mira `a.date` de "opcionales"; cambia `a.date` de "otro", que es otro paso.
    const { seen, steps } = fieldsFlow([{ date: '1' }, undefined, { date: '1' }], ['a.date']);

    await runWizard(steps, {});

    expect(seen).toEqual([undefined, 'pagado', 'pagado']);
  });

  it('con campos, un camino que pasa por null o por un texto no rompe y no cuenta como cambio', async () => {
    const { seen, steps } = fieldsFlow([null, undefined, 'texto'], ['options.date']);

    await runWizard(steps, {});

    expect(seen).toEqual([undefined, 'pagado', 'pagado']);
  });

  it('con campos, el camino solo entra en objetos: la propiedad de un texto no cuenta', async () => {
    // `options.length` de "texto" y de "otro" difieren, pero un texto no es un objeto: no hay cambio.
    const { seen, steps } = fieldsFlow(['texto', undefined, 'otro'], ['options.length']);

    await runWizard(steps, {});

    expect(seen).toEqual([undefined, 'pagado', 'pagado']);
  });

  it('el error de `dependsOn` nombra todos los pasos que faltan', async () => {
    const { steps } = scriptedSteps({}, { a: { dependsOn: ['x', 'y'] } });

    await expect(runWizard(steps, {})).rejects.toThrow('El paso a depende de x, y, que no es un paso anterior.');
  });
});

describe('runWizard: skip con memo, auto y memoOf', () => {
  it('`skip` recibe el memo del paso', async () => {
    const memos = new Map<string, unknown>([['b', 'saltar']]);
    const { runs, steps } = scriptedSteps({}, { a: {}, b: { skip: (_state, memo) => memo?.get() === 'saltar' } });

    expect(await runWizard(steps, {}, new Map(), { memos })).toEqual({ a: 'ok' });
    expect(runs.map(({ name }) => name)).toEqual(['a']);
  });

  it('`auto` escribe sin preguntar y "Volver" lo pasa de largo', async () => {
    const { runs, steps } = scriptedSteps({ a: ['1', '2'], c: [BACK, 'z'] }, { a: {}, c: {} });
    const [a, c] = steps as [WizardStep<State>, WizardStep<State>];
    const automatic: WizardStep<State> = {
      auto: (state) => ({ b: `de ${String(state.a)}` }),
      name: 'b',
      run: async () => {
        throw new Error('no pregunta');
      },
    };

    expect(await runWizard([a, automatic, c], {})).toEqual({ a: '2', b: 'de 2', c: 'z' });
    expect(runs.map(({ name }) => name)).toEqual(['a', 'c', 'a', 'c']);
  });

  it('lo que escribe `auto` cuenta como respuesta para `dependsOn`', async () => {
    const { runs, steps } = scriptedSteps(
      { a: ['1', '2'], c: ['y', BACK, 'y'], d: [BACK] },
      { a: {}, c: { dependsOn: ['b'] }, d: {} },
    );
    const [a, c, d] = steps as [WizardStep<State>, WizardStep<State>, WizardStep<State>];
    const automatic: WizardStep<State> = { auto: (state) => ({ b: state.a }), name: 'b', run: async () => BACK };

    await runWizard([a, automatic, c, d], {});

    expect(runs.at(-2)).toMatchObject({ name: 'c', previous: undefined });
  });

  it('si `auto` no devuelve campos, el paso pregunta', async () => {
    const { runs, steps } = scriptedSteps({}, { a: { auto: () => undefined } });

    expect(await runWizard(steps, {})).toEqual({ a: 'ok' });
    expect(runs).toHaveLength(1);
  });

  it('`memoOf` comparte el memo de otro paso, que se olvida con el de ese paso', async () => {
    const seen: unknown[] = [];
    const { steps } = scriptedSteps(
      { a: ['1', '2'], b: ['x', BACK, 'y'], c: [BACK] },
      { a: {}, b: { dependsOn: ['a'] }, c: {} },
    );
    const [a, b, c] = steps as [WizardStep<State>, WizardStep<State>, WizardStep<State>];
    const reader: WizardStep<State> = {
      memoOf: 'b',
      name: 'lector',
      run: async (_state, { memo }) => {
        seen.push(memo.get());

        return seen.length === 2 ? BACK : {};
      },
    };

    await runWizard([a, b, reader, c], {});

    // Lee lo que guardo b; cuando a cambia, b olvida su memo antes de volver a responder.
    expect(seen).toEqual(['x', 'x', 'y']);
  });

  it('falla si `memoOf` no nombra un paso del asistente', async () => {
    const { steps } = scriptedSteps({}, { a: { memoOf: 'otro' } });

    await expect(runWizard(steps, {})).rejects.toThrow(
      'El paso a usa el memo de otro, que no es un paso del asistente.',
    );
  });
});

// TUI-15: la vista previa es el cierre del asistente; Esc en "¿Emitimos?" vuelve a la ultima pregunta.
describe('runWizard: confirm', () => {
  it('con BACK vuelve a la ultima pregunta respondida, con su respuesta, y al seguir confirma lo mismo', async () => {
    const { runs, steps } = scriptedSteps({ c: ['3', '3'] }, { a: {}, b: {}, c: {} });
    const confirmed: State[] = [];
    const answers: Array<typeof BACK | undefined> = [BACK, undefined];

    const state = await runWizard(steps, {}, undefined, {
      confirm: async (current) => {
        confirmed.push(current);

        return answers.shift();
      },
    });

    expect(runs.map((run) => run.name)).toEqual(['a', 'b', 'c', 'c']);
    expect(runs.at(-1)?.previous).toBe('3');
    expect(confirmed).toEqual([
      { a: 'ok', b: 'ok', c: '3' },
      { a: 'ok', b: 'ok', c: '3' },
    ]);
    expect(state).toEqual({ a: 'ok', b: 'ok', c: '3' });
  });

  it('corre despues de `finalize`: si falla, vuelve al dueño antes de confirmar', async () => {
    const { runs, steps } = scriptedSteps({ a: ['malo', 'bueno'] }, { a: {} });
    const confirmed: State[] = [];

    await runWizard(steps, {}, undefined, {
      confirm: async (current) => {
        confirmed.push(current);
      },
      finalize: (current) => (current.a === 'malo' ? { field: 'a', message: 'a no puede ser malo' } : undefined),
    });

    expect(runs.map((run) => run.error)).toEqual([undefined, 'a no puede ser malo']);
    expect(confirmed).toEqual([{ a: 'bueno' }]);
  });

  it('al volver pasa de largo los pasos salteados y automaticos; sin preguntas respondidas, sale del flujo', async () => {
    const { runs, steps } = scriptedSteps({}, { a: {}, b: { skip: () => true }, c: { auto: () => ({ c: 'auto' }) } });

    await runWizard(steps, {}, undefined, { confirm: async () => (runs.length === 1 ? BACK : undefined) });
    expect(runs.map((run) => run.name)).toEqual(['a', 'a']);

    const none = scriptedSteps({}, { b: { skip: () => true } });

    await expect(runWizard(none.steps, {}, undefined, { confirm: async () => BACK })).resolves.toBeUndefined();
  });
});
