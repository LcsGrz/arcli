import { describe, expect, it } from 'vitest';

import {
  type OptionalDef,
  optionalGroup,
  type OptionalGroupDef,
  type OptionalGroupMemo,
  requiredOptional,
} from '../optional-group';
import { requiredField } from '../required-field';
import { BACK, type Back, runWizard, type WizardStep } from '../wizard';

interface Values {
  readonly a?: string;
  readonly b?: string;
}

interface Parent {
  /** Con `need`, el opcional `a` es obligatorio. */
  readonly need?: boolean;
  readonly offer: boolean;
  readonly values: Values;
}

type Key = 'a' | 'b';

/** Un opcional con una pregunta por campo, que contesta "v". */
function option(
  key: Key,
  steps: Array<Partial<WizardStep<Values>>>,
  extra: Partial<OptionalDef<Key, Values, Parent>> = {},
) {
  const def: OptionalDef<Key, Values, Parent> = {
    available: () => true,
    describe: (current) => current[key] ?? '',
    key,
    label: key.toUpperCase(),
    owns: [key],
    steps: () => steps.map((step, index) => ({ name: `${key}${index}`, run: async () => ({ [key]: 'v' }), ...step })),
    ...extra,
  };

  return def;
}

function groupDef(
  options: Array<OptionalDef<Key, Values, Parent>>,
  pick: OptionalGroupDef<Parent, Key, Values, Parent>['pick'] = async () => [],
): OptionalGroupDef<Parent, Key, Values, Parent> {
  return {
    context: (state) => state,
    message: '¿Agregamos algún opcional?',
    name: 'opcionales',
    options,
    pick,
    read: (state) => state.values,
    write: (values) => ({ values }),
  };
}

function group(
  options: Array<OptionalDef<Key, Values, Parent>>,
  pick?: OptionalGroupDef<Parent, Key, Values, Parent>['pick'],
): WizardStep<Parent> {
  return optionalGroup(groupDef(options, pick));
}

/** Un paso que responde segun el guion (sin guion, sigue) y anota cuantas veces se pregunto. */
function scripted(
  name: string,
  script: Array<Partial<Parent> | typeof BACK>,
  calls: string[] = [],
): WizardStep<Parent> {
  return {
    name,
    run: async () => {
      calls.push(name);

      return script.shift() ?? {};
    },
  };
}

const INITIAL: Parent = { offer: true, values: { a: 'a0', b: 'b0' } };

describe('optionalGroup: el catalogo', () => {
  it('falla si dos opcionales tienen una pregunta con el mismo nombre', async () => {
    const step = group([option('a', [{ name: 'fecha' }]), option('b', [{ name: 'fecha' }])]);

    await expect(runWizard([step], INITIAL)).rejects.toThrow(
      'En el grupo opcionales, la pregunta fecha esta en los opcionales a y b.',
    );
  });

  it('falla si una pregunta depende de otro opcional, aunque no este marcado', async () => {
    const step = group([option('a', [{}]), option('b', [{ dependsOn: ['a0'] }])]);

    await expect(runWizard([step], INITIAL)).rejects.toThrow(
      'En el grupo opcionales, la pregunta b0 del opcional b depende de a0, del opcional a.',
    );
  });

  it('falla tambien si depende de otro opcional por campos', async () => {
    const step = group([option('a', [{}]), option('b', [{ dependsOn: [{ fields: ['a'], step: 'a0' }] }])]);

    await expect(runWizard([step], INITIAL)).rejects.toThrow('depende de a0, del opcional a.');
  });

  it('una pregunta que depende de algo fuera del grupo falla como en cualquier asistente', async () => {
    const step = group([option('a', [{ dependsOn: ['afuera'] }])], async () => ['a']);

    await expect(runWizard([step], INITIAL)).rejects.toThrow(
      'El paso a0 depende de afuera, que no es un paso anterior.',
    );
  });

  it('el catalogo se controla tambien sin nada para ofrecer', async () => {
    const step = group([
      option('a', [{ name: 'fecha' }], { available: () => false }),
      option('b', [{ name: 'fecha' }], { available: () => false }),
    ]);

    await expect(runWizard([step], INITIAL)).rejects.toThrow('la pregunta fecha esta en los opcionales a y b.');
  });

  it('una pregunta puede depender de otra del mismo opcional', async () => {
    const step = group([option('a', [{}, { dependsOn: [{ fields: ['a'], step: 'a0' }] }])], async () => ['a']);

    expect((await runWizard([step], INITIAL))?.values).toEqual({ a: 'v', b: 'b0' });
  });
});

describe('optionalGroup sin nada para ofrecer', () => {
  const options = [
    option('a', [{}], { available: (context) => context.offer }),
    option('b', [{}], { available: (context) => context.offer, cleared: () => ({ b: undefined }) }),
  ];

  it('no pregunta y aplica los `cleared`', async () => {
    let picks = 0;
    const step = group(options, async () => {
      picks += 1;

      return [];
    });

    expect((await runWizard([step], { ...INITIAL, offer: false }))?.values).toEqual({ a: 'a0', b: undefined });
    expect(picks).toBe(0);
  });

  it('"Volver" desde el paso siguiente lo pasa de largo', async () => {
    const seen: string[] = [];
    const answers: Array<'antes' | typeof BACK> = ['antes', 'antes'];
    const ends: Array<'fin' | typeof BACK> = [BACK, 'fin'];
    const steps: Array<WizardStep<Parent>> = [
      {
        name: 'antes',
        run: async () => {
          seen.push('antes');

          return answers.shift() === BACK ? BACK : {};
        },
      },
      group(options),
      {
        name: 'fin',
        run: async () => {
          seen.push('fin');

          return ends.shift() === BACK ? BACK : {};
        },
      },
    ];

    await runWizard(steps, { ...INITIAL, offer: false });

    expect(seen).toEqual(['antes', 'fin', 'antes', 'fin']);
  });
});

describe('optionalGroup: el memo de las preguntas internas', () => {
  it('sobrevive a volver a la seleccion (por ejemplo, los items de la E a medio cargar)', async () => {
    const memos: unknown[] = [];
    const answers: Array<'v' | typeof BACK> = [BACK, 'v'];
    const items: OptionalDef<Key, Values, Parent> = option('a', [
      {
        name: 'items',
        run: async (_state, { memo }) => {
          memos.push(memo.get());
          memo.set('dos items cargados');

          return answers.shift() === BACK ? BACK : { a: 'v' };
        },
      },
    ]);
    const outer = new Map<string, unknown>();
    const picks: Array<Key[] | Back> = [['a'], ['a']];

    await runWizard([group([items], async () => picks.shift() ?? [])], INITIAL, new Map(), { memos: outer });

    expect(memos).toEqual([undefined, 'dos items cargados']);
    expect((outer.get('opcionales') as OptionalGroupMemo<Key, Values>).memos.get('items')).toBe('dos items cargados');
  });
});

describe('optionalGroup: lo marcado que deja de estar disponible', () => {
  it('se desmarca aunque el grupo no pregunte nada', async () => {
    const options = [option('a', [{}], { available: (context) => context.offer })];
    const picks: Array<Key[] | Back> = [['a'], BACK];
    const selected: Array<readonly Key[]> = [];
    const steps: Array<WizardStep<Parent>> = [
      scripted('contexto', [{ offer: true }, { offer: false }, { offer: true }]),
      optionalGroup({
        ...groupDef(options),
        pick: async (_message, _choices, current) => {
          selected.push(current);

          return picks.shift() ?? [...current];
        },
      }),
      scripted('fin', [BACK, BACK]),
    ];

    // Marca a; vuelve hasta el contexto, que la saca (el grupo no pregunta); vuelve y la ofrece de nuevo.
    expect((await runWizard(steps, INITIAL))?.values).toEqual(INITIAL.values);
    expect(selected).toEqual([[], ['a'], []]);
  });
});

describe('requiredOptional', () => {
  const required = (
    extra: Partial<OptionalDef<Key, Values, Parent>> = {},
    steps: Array<Partial<WizardStep<Values>>> = [{}],
  ) => option('a', steps, { required: (context) => (context.need ? { reason: 'hace falta' } : undefined), ...extra });

  it('controla el catalogo antes de preguntar, aunque vaya antes del grupo', async () => {
    const asked: string[] = [];
    const def = groupDef([
      required({}, [{ name: 'fecha', run: async () => (asked.push('fecha'), { a: 'v' }) }]),
      option('b', [{ name: 'fecha' }]),
    ]);

    await expect(
      runWizard(
        [
          ...requiredOptional(def, { key: 'a', name: 'obligatorio', notice: () => {}, questions: ['fecha'] }),
          optionalGroup(def),
        ],
        {
          ...INITIAL,
          need: true,
        },
      ),
    ).rejects.toThrow('la pregunta fecha esta en los opcionales a y b.');
    expect(asked).toEqual([]);
  });

  it('las preguntas internas guardan su memo entre corridas del paso', async () => {
    const memos: unknown[] = [];
    const answers: Array<'v' | typeof BACK> = [BACK, 'v'];
    const def = groupDef([
      required({}, [
        {
          run: async (_state, { memo }) => {
            memos.push(memo.get());
            memo.set('a medio cargar');

            return answers.shift() === BACK ? BACK : { a: 'v' };
          },
        },
      ]),
    ]);

    await runWizard(
      [
        scripted('antes', []),
        ...requiredOptional(def, { key: 'a', name: 'obligatorio', notice: () => {}, questions: ['a0'] }),
        optionalGroup(def),
      ],
      { ...INITIAL, need: true },
    );

    expect(memos).toEqual([undefined, 'a medio cargar']);
  });

  it('un paso por pregunta, con su nombre y lo que escribe la pregunta (para `finalize`)', () => {
    const memo = { get: () => undefined, set: () => {} };
    const steps = requiredOptional(
      groupDef([
        required({}, [
          { name: 'tipo', writes: ['a'] },
          { name: 'numero', writes: (current) => [`numero-${current.a}`] },
          { name: 'sin-writes' },
        ]),
      ]),
      { key: 'a', name: 'obligatorio', notice: () => {}, questions: ['tipo', 'numero', 'sin-writes'] },
    );
    const state = { ...INITIAL, need: true };

    expect(steps.map((step) => step.name)).toEqual([
      'obligatorio:tipo',
      'obligatorio:numero',
      'obligatorio:sin-writes',
    ]);
    expect(steps.map((step) => (typeof step.writes === 'function' ? step.writes(state, memo) : step.writes))).toEqual([
      ['a'],
      ['numero-a0'],
      [],
    ]);
  });

  it('falla si una pregunta pedida no es del opcional', async () => {
    const def = groupDef([required()]);

    await expect(
      runWizard(
        [
          ...requiredOptional(def, { key: 'a', name: 'obligatorio', notice: () => {}, questions: ['otra'] }),
          optionalGroup(def),
        ],
        {
          ...INITIAL,
          need: true,
        },
      ),
    ).rejects.toThrow('El opcional a no tiene la pregunta otra.');
  });

  it('si cambia una respuesta, la pregunta que depende de ella arranca de cero', async () => {
    const seen: Array<[string, unknown]> = [];
    const types = ['dni', 'cuit'];
    const numbers: Array<string | typeof BACK> = ['1', BACK, '2'];
    let backs = 1;
    const def = groupDef([
      required({ owns: ['a', 'b'] }, [
        {
          name: 'tipo',
          run: async (_current, { previous }) => (seen.push(['tipo', previous?.a]), { a: types.shift() }),
        },
        {
          dependsOn: ['tipo'],
          name: 'numero',
          run: async (_current, { previous }) => {
            seen.push(['numero', previous?.b]);

            const number = numbers.shift();

            return number === BACK ? BACK : { b: number };
          },
        },
      ]),
    ]);

    const done = await runWizard(
      [
        ...requiredOptional(def, { key: 'a', name: 'obligatorio', notice: () => {}, questions: ['tipo', 'numero'] }),
        optionalGroup(def),
        // Vuelve una vez: Esc en el numero lleva al tipo, que cambia.
        { name: 'fin', run: async () => (backs-- > 0 ? BACK : {}) },
      ],
      { ...INITIAL, need: true },
    );

    expect(seen).toEqual([
      ['tipo', undefined],
      ['numero', undefined],
      ['numero', '1'],
      ['tipo', 'dni'],
      ['numero', undefined],
    ]);
    expect(done?.values).toEqual({ a: 'cuit', b: '2' });
  });

  // Pendiente de NAV-2: el paso obligatorio miraba lo elegido en la seleccion sin olvidar lo que cambio de contexto.
  it('para saltearse olvida, como el grupo, lo que cambio de contexto (`resetWhen`)', async () => {
    const asked: string[] = [];
    const picks: Array<Key[] | typeof BACK> = [['a'], BACK, ['a']];
    const def = groupDef(
      [
        required({ resetWhen: (context) => String(context.offer) }, [
          { run: async () => (asked.push('a0'), { a: 'v' }) },
        ]),
      ],
      async () => picks.shift() ?? [],
    );
    let backs = 1;
    const contexts: Array<Partial<Parent>> = [{ need: false }, { need: true, offer: false }];

    await runWizard(
      [
        { name: 'antes', run: async () => contexts.shift() ?? {} },
        ...requiredOptional(def, { key: 'a', name: 'obligatorio', notice: () => {}, questions: ['a0'] }),
        optionalGroup(def),
        {
          // Vuelve una vez: Esc en la seleccion lleva a "antes", que cambia el contexto sin pasar por el grupo.
          name: 'fin',
          run: async () => (backs-- > 0 ? BACK : {}),
        },
      ],
      INITIAL,
    );

    // Elegido en la seleccion con un contexto; con otro, lo respondido se olvido y se pide como obligatorio.
    expect(asked).toEqual(['a0', 'a0']);
  });
});

describe('requiredField', () => {
  it('las preguntas internas guardan su memo entre corridas del paso', async () => {
    const memos: unknown[] = [];
    const answers: Array<'v' | typeof BACK> = [BACK, 'v'];
    const step = requiredField<Parent, Values, Parent>({
      answered: () => false,
      context: (state) => state,
      field: {
        available: () => true,
        key: 'a',
        required: () => ({ reason: 'hace falta' }),
        steps: () => [
          {
            name: 'items',
            run: async (_state, { memo }) => {
              memos.push(memo.get());
              memo.set('a medio cargar');

              return answers.shift() === BACK ? BACK : { a: 'v' };
            },
          },
        ],
      },
      name: 'obligatorio',
      notice: () => {},
      read: (state) => state.values,
      write: (values) => ({ values }),
    });

    expect((await runWizard([scripted('antes', []), step], INITIAL))?.values).toEqual({ a: 'v', b: 'b0' });
    expect(memos).toEqual([undefined, 'a medio cargar']);
  });
});
