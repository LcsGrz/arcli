import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { InteractiveChoice } from '../choices';
import { composeOptionals, type OptionalDef, optionalGroup, type OptionalGroupDef } from '../optional-group';
import { BACK, type Back, runWizard, type WizardAnswers, type WizardStep } from '../wizard';

/** Opcionales sinteticos: `z` no es de nadie (un paso de P lo escribe igual, y no tiene que llegar). */
interface Values {
  readonly p?: string;
  readonly q?: string;
  readonly r?: string;
  readonly r2?: string;
  readonly z?: string;
}

/** Que se ofrece: Q y R dependen del contexto, P siempre. */
interface Context {
  readonly q: boolean;
  readonly r: boolean;
  /** De donde sale el valor inicial de Q, para `resetWhen`. */
  readonly source?: string;
}

type Key = 'p' | 'q' | 'r';

interface Parent {
  readonly context: Context;
  readonly values: Values;
}

type Script = Array<string | typeof BACK>;

/** Preguntas que contestan segun el guion de cada una (sin guion, "v") y anotan lo que reciben como ultima respuesta. */
function catalog(script: Record<string, Script> = {}) {
  const seen: Array<[string, string | undefined]> = [];
  const ask =
    (name: keyof Values, extra: Partial<Values> = {}): WizardStep<Values>['run'] =>
    async (_state, previous) => {
      seen.push([name, previous?.[name]]);

      const answer = script[name]?.shift() ?? 'v';

      return answer === BACK ? BACK : { ...extra, [name]: answer };
    };
  const options: Array<OptionalDef<Key, Values, Context>> = [
    {
      available: () => true,
      describe: (current) => current.p ?? 'sin p',
      key: 'p',
      label: 'P',
      owns: ['p'],
      steps: () => [{ name: 'p', run: ask('p', { z: 'se filtra' }) }],
    },
    {
      available: (context) => context.q,
      cleared: () => ({ q: undefined }),
      describe: (current) => current.q ?? 'sin q',
      key: 'q',
      label: 'Q',
      owns: ['q'],
      steps: () => [{ name: 'q', run: ask('q') }],
    },
    {
      available: (context) => context.r,
      describe: (current) => `${current.r ?? 'sin r'}/${current.r2 ?? 'sin r2'}`,
      key: 'r',
      label: 'R',
      owns: ['r', 'r2'],
      steps: () => [
        { name: 'r', run: ask('r') },
        { name: 'r2', run: ask('r2'), skip: (current) => current.r === 'corto' },
      ],
    },
  ];

  return { options, seen };
}

const ALL: Context = { q: true, r: true };

interface PickCall {
  readonly answer?: Key[] | typeof BACK;
  readonly choices: ReadonlyArray<InteractiveChoice<Key>>;
  readonly selected: readonly Key[];
}

/** La seleccion multiple segun el guion: sin guion, Enter con lo marcado. */
function scriptedPick(picks: Array<Key[] | typeof BACK>) {
  const calls: PickCall[] = [];
  const pick: OptionalGroupDef<Parent, Key, Values, Context>['pick'] = async (_message, choices, selected) => {
    const answer = picks.shift() ?? [...selected];

    calls.push({ answer, choices, selected });

    return answer;
  };

  return { calls, pick };
}

function group(
  options: ReadonlyArray<OptionalDef<Key, Values, Context>>,
  pick: OptionalGroupDef<Parent, Key, Values, Context>['pick'],
  extra: Partial<OptionalGroupDef<Parent, Key, Values, Context>> = {},
): WizardStep<Parent> {
  return optionalGroup<Parent, Key, Values, Context>({
    context: (state) => state.context,
    message: '¿Agregamos algún opcional?',
    name: 'opcionales',
    options,
    pick,
    read: (state) => state.values,
    write: (values) => ({ values }),
    ...extra,
  });
}

/** Un paso despues del grupo que vuelve las veces que diga el guion, para entrar de nuevo al grupo. */
function after(backs: number): WizardStep<Parent> {
  let left = backs;

  return {
    name: 'despues',
    run: async () => {
      left -= 1;

      return left >= 0 ? BACK : {};
    },
  };
}

const INITIAL: Parent = { context: ALL, values: { p: 'p0', q: 'q0', r: 'r0', r2: 'r20', z: 'z0' } };

describe('optionalGroup', () => {
  it('sin marcar nada, todo queda como al inicio', async () => {
    const { options } = catalog();
    const { pick } = scriptedPick([[]]);

    expect(await runWizard([group(options, pick)], INITIAL)).toEqual(INITIAL);
  });

  it('pregunta solo lo marcado, en el orden del catalogo, y aplica solo los campos de cada opcional', async () => {
    const { options, seen } = catalog({ p: ['p1'], r: ['r1'], r2: ['r21'] });
    const { pick } = scriptedPick([['r', 'p']]);
    const result = await runWizard([group(options, pick)], INITIAL);

    expect(seen.map(([name]) => name)).toEqual(['p', 'r', 'r2']);
    // `z` lo escribe la pregunta de P pero no es suyo: no llega.
    expect(result?.values).toEqual({ p: 'p1', q: 'q0', r: 'r1', r2: 'r21', z: 'z0' });
  });

  it('Volver en la primera pregunta vuelve a la seleccion con lo marcado y lo respondido a la vista', async () => {
    const { options } = catalog({ p: ['p1', BACK, 'p1'], q: [BACK] });
    const { calls, pick } = scriptedPick([['p', 'q'], ['p']]);
    const result = await runWizard([group(options, pick)], INITIAL);

    expect(calls[1]?.selected).toEqual(['p', 'q']);
    // P esta completo: se describe con lo respondido. Q quedo a medias: como al inicio.
    expect(calls[1]?.choices.map((choice) => choice.description)).toEqual(['p1', 'q0', 'r0/r20']);
    expect(result?.values.p).toBe('p1');
  });

  it('desmarcar vuelve a `initial`, y lo respondido se ofrece de nuevo al volver a marcarlo (REV-65)', async () => {
    const { options, seen } = catalog({ p: ['p1', 'p1', 'p1'], q: ['q1', 'q1'] });
    // Marca P y Q y responde; vuelve y desmarca Q; vuelve y marca Q de nuevo.
    const { calls, pick } = scriptedPick([['p', 'q'], ['p'], ['p', 'q']]);
    const result = await runWizard([group(options, pick), after(2)], INITIAL);

    // Con Q desmarcado, Q se ve como al inicio.
    expect(calls[2]?.choices.map((choice) => choice.description)).toEqual(['p1', 'q0', 'r0/r20']);
    expect(seen).toEqual([
      ['p', undefined],
      ['q', undefined],
      ['p', 'p1'],
      ['p', 'p1'],
      ['q', 'q1'],
    ]);
    expect(result?.values).toMatchObject({ p: 'p1', q: 'q1' });
  });

  it('lo desmarcado no llega aunque se haya respondido', async () => {
    const { options } = catalog({ q: ['q1'] });
    const { pick } = scriptedPick([['q'], []]);

    expect((await runWizard([group(options, pick), after(1)], INITIAL))?.values).toEqual(INITIAL.values);
  });

  it('lo marcado y lo respondido sobreviven a volver desde el paso siguiente (REV-68)', async () => {
    const { options, seen } = catalog({ p: ['p1', 'p1'], r: ['corto', 'corto'] });
    const { calls, pick } = scriptedPick([['p', 'r']]);
    const result = await runWizard([group(options, pick), after(1)], INITIAL);

    expect(calls.map(({ selected }) => selected)).toEqual([[], ['p', 'r']]);
    expect(calls[1]?.choices.map((choice) => choice.description)).toEqual(['p1', 'q0', 'corto/r20']);
    expect(seen).toEqual([
      ['p', undefined],
      ['r', undefined],
      ['p', 'p1'],
      ['r', 'corto'],
    ]);
    expect(result?.values).toMatchObject({ p: 'p1', r: 'corto', r2: 'r20' });
  });

  it('Volver en la seleccion vuelve al paso anterior', async () => {
    const { options } = catalog();
    const { pick } = scriptedPick([BACK]);

    expect(await runWizard([group(options, pick)], INITIAL)).toBeUndefined();
  });

  it('lo marcado que deja de estar disponible se desmarca y sus campos quedan en `cleared`', async () => {
    const { options } = catalog({ q: ['q1'] });
    const contexts: Context[] = [ALL, { q: false, r: true }];
    // Marca Q y responde; desde el paso siguiente vuelve hasta el contexto, que cambia; Enter en la seleccion.
    const { calls, pick } = scriptedPick([['q'], BACK]);
    const steps: Array<WizardStep<Parent>> = [
      { name: 'contexto', run: async () => ({ context: contexts.shift() ?? ALL }) },
      group(options, pick),
      after(1),
    ];
    const result = await runWizard(steps, INITIAL);

    expect(calls.at(-1)?.selected).toEqual([]);
    expect(calls.at(-1)?.choices.map((choice) => choice.value)).toEqual(['p', 'r']);
    expect(result?.values).toEqual({ ...INITIAL.values, q: undefined });
  });

  it('`preselected` marca solo la primera vez', async () => {
    const { options } = catalog();
    const { calls, pick } = scriptedPick([[]]);

    await runWizard([group(options, pick, { preselected: () => ['q', 'r'] }), after(1)], INITIAL);

    expect(calls.map(({ selected }) => selected)).toEqual([['q', 'r'], []]);
  });

  describe('`resetWhen`: un opcional sigue a la parte del contexto de la que sale', () => {
    /**
     * Marca P y Q y responde; desde el paso siguiente vuelve hasta el contexto, que pasa de `x` a `second`; Enter en la
     * seleccion.
     */
    async function changeSource(second: string, preselected: readonly Key[] = []) {
      const { options, seen } = catalog({ p: ['p1', 'p1'], q: ['q1', 'q2'] });
      const withReset = options.map((option) =>
        option.key === 'q' ? { ...option, resetWhen: (context: Context) => context.source ?? '' } : option,
      );
      const contexts: Context[] = [
        { ...ALL, source: 'x' },
        { ...ALL, source: second },
      ];
      const { calls, pick } = scriptedPick([['p', 'q'], BACK]);
      const result = await runWizard(
        [
          { name: 'contexto', run: async () => ({ context: contexts.shift() ?? ALL }) },
          group(withReset, pick, { preselected: () => preselected }),
          after(1),
        ],
        INITIAL,
      );

      return { calls, result, seen };
    }

    it('si la clave cambia, solo ese opcional olvida su marca y sus respuestas', async () => {
      const { calls, result, seen } = await changeSource('y');

      expect(calls.at(-1)?.selected).toEqual(['p']);
      expect(seen).toEqual([
        ['p', undefined],
        ['q', undefined],
        ['p', 'p1'],
      ]);
      expect(result?.values).toMatchObject({ p: 'p1', q: 'q0' });
    });

    it('si la clave cambia y el opcional esta en `preselected`, vuelve a arrancar marcado y sin respuesta', async () => {
      const { calls, result, seen } = await changeSource('y', ['q']);

      expect(calls.map(({ selected }) => selected)).toEqual([['q'], ['p', 'q'], ['p', 'q']]);
      expect(seen.at(-1)).toEqual(['q', undefined]);
      expect(result?.values).toMatchObject({ p: 'p1', q: 'q2' });
    });

    it('con la misma clave, todo sigue como estaba', async () => {
      const { calls, seen } = await changeSource('x', ['q']);

      expect(calls.at(-1)?.selected).toEqual(['p', 'q']);
      expect(seen.at(-1)).toEqual(['q', 'q1']);
    });

    it('si la clave cambia, tambien se olvida el memo de sus preguntas', async () => {
      const memos: unknown[] = [];
      const { options } = catalog();
      const withReset = options.map((option) =>
        option.key === 'q'
          ? {
              ...option,
              resetWhen: (context: Context) => context.source ?? '',
              steps: (): Array<WizardStep<Values>> => [
                {
                  name: 'q',
                  run: async (_state, _previous, memo) => {
                    memos.push(memo.get());
                    memo.set('a medias');

                    return { q: 'q1' };
                  },
                },
              ],
            }
          : option,
      );
      const contexts: Context[] = [
        { ...ALL, source: 'x' },
        { ...ALL, source: 'y' },
      ];
      const { pick } = scriptedPick([['q'], BACK]);

      await runWizard(
        [
          { name: 'contexto', run: async () => ({ context: contexts.shift() ?? ALL }) },
          group(withReset, pick, { preselected: () => ['q'] }),
          after(1),
        ],
        INITIAL,
      );

      expect(memos).toEqual([undefined, undefined]);
    });

    it('volver sin confirmar no deshace lo olvidado: la clave nueva queda guardada', async () => {
      const { options } = catalog({ q: ['q1'] });
      const withReset = options.map((option) =>
        option.key === 'q' ? { ...option, resetWhen: (context: Context) => context.source ?? '' } : option,
      );
      const contexts: Context[] = [
        { ...ALL, source: 'x' },
        { ...ALL, source: 'y' },
        { ...ALL, source: 'x' },
      ];
      // Marca Q y responde; vuelve hasta el contexto (`y`); en la seleccion vuelve sin confirmar; de nuevo `x`.
      const { calls, pick } = scriptedPick([['q'], BACK, BACK]);

      await runWizard(
        [
          { name: 'contexto', run: async () => ({ context: contexts.shift() ?? ALL }) },
          group(withReset, pick),
          after(1),
        ],
        INITIAL,
      );

      // Con `y`, Q se olvido; al volver a `x` sigue olvidado (no queda marcado sin respuesta).
      expect(calls.map(({ selected }) => selected)).toEqual([[], ['q'], [], []]);
    });
  });

  it('si cambia algo de lo que depende el grupo, olvida lo marcado y lo respondido', async () => {
    const { options, seen } = catalog({ p: ['p1'] });
    const { calls, pick } = scriptedPick([['p'], BACK]);
    const values: Array<Context> = [ALL, { q: true, r: false }];
    const steps: Array<WizardStep<Parent>> = [
      { name: 'contexto', run: async () => ({ context: values.shift() ?? ALL }) },
      group(options, pick, { dependsOn: ['contexto'] }),
    ];
    let backs = 1;

    await runWizard(
      [
        ...steps,
        {
          name: 'fin',
          run: async () => {
            backs -= 1;

            return backs >= 0 ? BACK : {};
          },
        },
      ],
      INITIAL,
    );

    expect(calls.map(({ selected }) => selected)).toEqual([[], ['p'], []]);
    expect(seen).toEqual([['p', undefined]]);
  });
});

describe('composeOptionals (propiedades)', () => {
  const { options } = catalog();
  const text = fc.constantFrom('a', 'b', 'corto', undefined);
  const values = fc.record({ p: text, q: text, r: text, r2: text, z: text }) as fc.Arbitrary<Values>;
  const context = fc.record({ q: fc.boolean(), r: fc.boolean() });
  const marked = fc.subarray<Key>(['p', 'q', 'r']);
  const answers = fc
    .record(
      {
        p: fc.record({ p: text, z: text }),
        q: fc.record({ q: text }),
        r: fc.record({ r: text }),
        r2: fc.record({ r2: text }),
      },
      { requiredKeys: [] },
    )
    .map((record) => new Map(Object.entries(record)) as WizardAnswers<Values>);
  const OWNS: Record<Key, Array<keyof Values>> = { p: ['p'], q: ['q'], r: ['r', 'r2'] };
  const owned = (value: Values, key: Key) => Object.fromEntries(OWNS[key].map((field) => [field, value[field]]));
  const PARAMETERS = { numRuns: 500, seed: 20261120 };

  it('es idempotente: componer sobre lo compuesto da lo mismo', () => {
    fc.assert(
      fc.property(values, marked, context, answers, (initial, keys, ctx, recorded) => {
        const once = composeOptionals(initial, keys, options, ctx, recorded);

        expect(composeOptionals(once, keys, options, ctx, recorded)).toEqual(once);
      }),
      PARAMETERS,
    );
  });

  it('lo desmarcado y disponible queda como en `initial`, y lo que no es de nadie no cambia', () => {
    fc.assert(
      fc.property(values, marked, context, answers, (initial, keys, ctx, recorded) => {
        const result = composeOptionals(initial, keys, options, ctx, recorded);

        for (const option of options) {
          if (option.available(ctx) && !keys.includes(option.key)) {
            expect(owned(result, option.key)).toEqual(owned(initial, option.key));
          }
        }

        expect(result.z).toBe(initial.z);
      }),
      PARAMETERS,
    );
  });

  it('lo no disponible queda en `cleared` (por defecto, como en `initial`), este marcado o no', () => {
    fc.assert(
      fc.property(values, marked, context, answers, (initial, keys, ctx, recorded) => {
        const result = composeOptionals(initial, keys, options, ctx, recorded);

        if (!ctx.q) {
          expect(result.q).toBeUndefined();
        }

        if (!ctx.r) {
          expect(owned(result, 'r')).toEqual(owned(initial, 'r'));
        }
      }),
      PARAMETERS,
    );
  });

  it('lo marcado, disponible y completo toma sus respuestas; a medias queda como en `initial`', () => {
    fc.assert(
      fc.property(values, marked, context, answers, (initial, keys, ctx, recorded) => {
        const result = composeOptionals(initial, keys, options, ctx, recorded);

        if (keys.includes('p') && recorded.has('p')) {
          expect(result.p).toBe(recorded.get('p')?.p);
        }

        if (keys.includes('r') && ctx.r) {
          const r = recorded.get('r');
          const complete = r !== undefined && (r.r === 'corto' || recorded.has('r2'));

          expect(owned(result, 'r')).toEqual(
            complete ? { r: r.r, r2: r.r === 'corto' ? initial.r2 : recorded.get('r2')?.r2 } : owned(initial, 'r'),
          );
        }
      }),
      PARAMETERS,
    );
  });
});

describe('optionalGroup con un asistente al azar (propiedades)', () => {
  const pickArbitrary = fc.oneof(fc.constant(BACK), fc.subarray<Key>(['p', 'q', 'r']));
  const answerArbitrary = fc.oneof(fc.constant(BACK), fc.constantFrom('a', 'b', 'corto'));
  const scriptArbitrary = fc.record({
    contexts: fc.array(fc.oneof(fc.constant(BACK), fc.record({ q: fc.boolean(), r: fc.boolean() })), {
      maxLength: 4,
    }),
    ends: fc.array(fc.boolean(), { maxLength: 4 }),
    p: fc.array(answerArbitrary, { maxLength: 4 }),
    picks: fc.array(pickArbitrary, { maxLength: 6 }),
    q: fc.array(answerArbitrary, { maxLength: 4 }),
    r: fc.array(answerArbitrary, { maxLength: 4 }),
    r2: fc.array(answerArbitrary, { maxLength: 4 }),
  });

  it('el resultado es `composeOptionals` de lo marcado, y lo respondido se ofrece de nuevo mientras no cambie', async () => {
    await fc.assert(
      fc.asyncProperty(scriptArbitrary, async (script) => {
        const { options, seen } = catalog({ p: [...script.p], q: [...script.q], r: [...script.r], r2: [...script.r2] });
        const picks: Array<Key[] | Back> = [...script.picks];
        const { calls, pick } = scriptedPick(picks);
        const contexts = [...script.contexts];
        const ends = [...script.ends];
        const memos = new Map<string, unknown>();
        const steps: Array<WizardStep<Parent>> = [
          {
            name: 'contexto',
            run: async (state) => {
              const next = contexts.shift();

              // Volver desde el primer paso sale: se reemplaza por seguir, para llegar al grupo.
              return next === undefined || next === BACK ? { context: state.context } : { context: next };
            },
          },
          group(options, pick),
          { name: 'fin', run: async () => (ends.shift() ? BACK : {}) },
        ];
        const result = await runWizard(steps, INITIAL, new Map(), { memos });

        if (!result) {
          return;
        }

        // Cada pregunta recibe lo ultimo que respondio: nada en el catalogo depende de otra cosa.
        const last = new Map<string, string>();
        const answered = { p: [...script.p], q: [...script.q], r: [...script.r], r2: [...script.r2] };

        for (const [name, previous] of seen) {
          expect(previous).toBe(last.get(name));

          const answer = answered[name as keyof typeof answered].shift() ?? 'v';

          if (answer !== BACK) {
            last.set(name, answer);
          }
        }

        // Oraculo armado aca, sin `composeOptionals`: lo elegido en la ultima seleccion confirmada, con las ultimas
        // respuestas; lo demas como al inicio; Q no disponible, vacio.
        const chosen = calls.findLast((call) => call.answer !== BACK)?.answer as Key[];
        const { context } = result;
        const expected: Values = {
          ...INITIAL.values,
          ...(chosen.includes('p') ? { p: last.get('p') } : {}),
          ...(chosen.includes('q') && context.q ? { q: last.get('q') } : {}),
          ...(context.q ? {} : { q: undefined }),
          ...(chosen.includes('r') && context.r
            ? { r: last.get('r'), r2: last.get('r') === 'corto' ? INITIAL.values.r2 : last.get('r2') }
            : {}),
        };

        expect(result.values).toEqual(expected);
      }),
      { numRuns: 300, seed: 20261123 },
    );
  });
});
