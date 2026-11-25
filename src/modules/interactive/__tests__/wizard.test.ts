import { describe, expect, it, vi } from 'vitest';

import { BACK, NOT_ASKED, requireStepValue, runWizard, type WizardStep } from '../wizard';

interface State {
  readonly a?: string;
  readonly b?: string;
  readonly c?: string;
}

interface FourState extends State {
  readonly d?: string;
}

function scripted(answers: Record<string, Array<string | typeof BACK>>): Array<WizardStep<State>> {
  const take = (name: keyof State) => async () => {
    const answer = answers[name]?.shift();

    return answer === BACK ? BACK : { [name]: answer };
  };

  return [
    { name: 'a', run: take('a') },
    { name: 'b', run: take('b'), skip: (state) => state.a === 'saltar-b' },
    { name: 'c', run: take('c') },
  ];
}

describe('requireStepValue', () => {
  it('devuelve el dato, tambien si es falsy', () => {
    expect(requireStepValue('fc', 'voucherKind')).toBe('fc');
    expect(requireStepValue(0, 'monto')).toBe(0);
  });

  it('falla si un paso anterior no lo completo', () => {
    expect(() => requireStepValue(undefined, 'voucherKind')).toThrow('Falta voucherKind');
  });
});

describe('runWizard', () => {
  it('corre los pasos en orden y junta las respuestas', async () => {
    expect(await runWizard(scripted({ a: ['1'], b: ['2'], c: ['3'] }), {})).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('vuelve al paso anterior y lo vuelve a preguntar', async () => {
    const result = await runWizard(scripted({ a: ['1'], b: ['2', '2bis'], c: [BACK, '3'] }), {});

    expect(result).toEqual({ a: '1', b: '2bis', c: '3' });
  });

  it('al volver descarta la respuesta del paso que se rehace', async () => {
    // a cambia de "1" a "saltar-b": b ya no aplica y su respuesta vieja no queda en el estado.
    // c vuelve a b, b vuelve a a, y a cambia a "saltar-b".
    const result = await runWizard(scripted({ a: ['1', 'saltar-b'], b: ['2', BACK], c: [BACK, '3'] }), {});

    expect(result).toEqual({ a: 'saltar-b', c: '3' });
  });

  it('salta los pasos que no aplican, tambien al volver', async () => {
    const result = await runWizard(scripted({ a: ['saltar-b', 'x'], c: [BACK, '3'] }), {});

    expect(result).toEqual({ a: 'x', b: undefined, c: '3' });
  });

  /** Pasos a, b, c y d que anotan lo que reciben como ultima respuesta y contestan segun el guion. */
  function recording(
    script: Record<string, Array<string | typeof BACK>>,
    dependsOn: Partial<Record<keyof FourState, readonly string[]>> = {},
  ) {
    const seen: Array<[string, string | undefined]> = [];
    const steps: Array<WizardStep<FourState>> = (['a', 'b', 'c', 'd'] as const).map((name) => ({
      dependsOn: dependsOn[name],
      name,
      run: async (_state, { previous }) => {
        seen.push([name, previous?.[name]]);
        const answer = script[name]?.shift();

        return answer === BACK ? BACK : { [name]: answer };
      },
    }));

    return { seen, steps };
  }

  it('al volver, el paso recibe su ultima respuesta; si una respuesta cambia, olvidan la suya los que dependen de ella', async () => {
    const { seen, steps } = recording(
      { a: ['1', '1', '2'], b: ['x', BACK, 'x', BACK, 'y'], c: [BACK, BACK, '3'], d: ['4'] },
      { b: ['a'] },
    );

    // a=1, b=x, c volver, b volver, a=1 (igual), b=x (marcada), c volver, b volver, a=2 (cambia), b=y, c=3, d=4.
    expect(await runWizard(steps, {})).toEqual({ a: '2', b: 'y', c: '3', d: '4' });
    expect(seen).toEqual([
      ['a', undefined],
      ['b', undefined],
      ['c', undefined],
      ['b', 'x'],
      ['a', '1'],
      ['b', 'x'],
      ['c', undefined],
      ['b', 'x'],
      ['a', '1'],
      ['b', undefined],
      ['c', undefined],
      ['d', undefined],
    ]);
  });

  it('olvida tambien las respuestas que dependen de forma indirecta', async () => {
    // c depende de b y b de a; d no depende de nadie. Se responde todo, se vuelve hasta a y se cambia.
    const { seen, steps } = recording(
      { a: ['1', '2'], b: ['x', BACK, 'y'], c: ['3', BACK, '3'], d: [BACK, '4'] },
      { b: ['a'], c: ['b'] },
    );

    expect(await runWizard(steps, {})).toEqual({ a: '2', b: 'y', c: '3', d: '4' });
    expect(seen).toEqual([
      ['a', undefined],
      ['b', undefined],
      ['c', undefined],
      ['d', undefined],
      ['c', '3'],
      ['b', 'x'],
      ['a', '1'],
      ['b', undefined],
      ['c', undefined],
      ['d', undefined],
    ]);
  });

  it('si cambia una respuesta de la que nadie depende, los pasos siguientes conservan la suya', async () => {
    const { seen, steps } = recording(
      { a: ['1', '2'], b: ['x', BACK, 'x'], c: ['3', BACK, '3'], d: [BACK, '4'] },
      { c: ['b'], d: ['c'] },
    );

    expect(await runWizard(steps, {})).toEqual({ a: '2', b: 'x', c: '3', d: '4' });
    expect(seen.slice(6)).toEqual([
      ['a', '1'],
      ['b', 'x'],
      ['c', '3'],
      ['d', undefined],
    ]);
  });

  it('un paso que cambia de respuesta no hace olvidar a los anteriores que dependen de otro', async () => {
    // c cambia: d depende de c y olvida; b depende de a y conserva.
    const { seen, steps } = recording(
      { a: ['1'], b: ['x', 'x'], c: ['3', BACK, '5'], d: [BACK, '4'] },
      { b: ['a'], d: ['c'] },
    );

    expect(await runWizard(steps, {})).toEqual({ a: '1', b: 'x', c: '5', d: '4' });
    expect(seen).toEqual([
      ['a', undefined],
      ['b', undefined],
      ['c', undefined],
      ['d', undefined],
      ['c', '3'],
      ['b', 'x'],
      ['c', '3'],
      ['d', undefined],
    ]);
  });

  describe('con `fields`, solo cuenta el cambio de esos campos', () => {
    interface FieldsState {
      readonly options?: { readonly language?: string; readonly voucherDate?: string };
      readonly paymentDate?: string;
    }

    /** opcionales, fecha de pago y un paso al final que vuelve una vez, para llegar de nuevo a la fecha ya respondida. */
    function stepsWith(options: Array<FieldsState['options'] | typeof BACK>) {
      const seen: Array<string | undefined> = [];
      let returned = false;
      const steps: Array<WizardStep<FieldsState>> = [
        {
          name: 'opcionales',
          run: async () => {
            const answer = options.shift();

            return answer === BACK ? BACK : { options: answer };
          },
        },
        {
          dependsOn: [{ fields: ['options.voucherDate'], step: 'opcionales' }],
          name: 'fecha-pago',
          run: async (_state, { previous }) => {
            seen.push(previous?.paymentDate);

            return seen.length === 2 ? BACK : { paymentDate: '20/11/2026' };
          },
        },
        {
          name: 'despues',
          run: async () => {
            const back = !returned;

            returned = true;

            return back ? BACK : {};
          },
        },
      ];

      return { seen, steps };
    }

    it('si cambia otro campo de la respuesta, conserva la suya', async () => {
      const { seen, steps } = stepsWith([
        { language: 'es', voucherDate: '14/11/2026' },
        { language: 'en', voucherDate: '14/11/2026' },
      ]);

      await runWizard(steps, {});

      expect(seen).toEqual([undefined, '20/11/2026', '20/11/2026']);
    });

    it('si cambia uno de esos campos, la olvida', async () => {
      const { seen, steps } = stepsWith([
        { language: 'es', voucherDate: '14/11/2026' },
        { language: 'es', voucherDate: '16/11/2026' },
      ]);

      await runWizard(steps, {});

      expect(seen).toEqual([undefined, '20/11/2026', undefined]);
    });
  });

  it('falla si `dependsOn` no nombra un paso anterior', async () => {
    const { steps } = recording({ a: ['1'] }, { a: ['b'] });

    await expect(runWizard(steps, {})).rejects.toThrow('El paso a depende de b, que no es un paso anterior.');
  });

  it('las respuestas compartidas sobreviven a otra corrida del asistente', async () => {
    const answers = new Map<string, Partial<State>>();
    const previous: Array<Partial<State> | undefined> = [];
    const steps: Array<WizardStep<State>> = [
      {
        name: 'a',
        run: async (_state, { previous: last }) => {
          previous.push(last);

          return previous.length === 1 ? { a: '1' } : BACK;
        },
      },
      { name: 'b', run: async () => BACK },
    ];

    expect(await runWizard(steps, {}, answers)).toBeUndefined();
    expect(await runWizard(steps, {}, answers)).toBeUndefined();
    expect(previous).toEqual([undefined, { a: '1' }, { a: '1' }]);
  });

  it('devuelve undefined si se vuelve desde el primer paso', async () => {
    expect(await runWizard(scripted({ a: [BACK] }), {})).toBeUndefined();
  });
});

describe('un paso que no preguntó (NOT_ASKED)', () => {
  it('no es una pregunta a la que volver: ni con "Volver" ni desde la vista previa', async () => {
    const calls: string[] = [];
    let asked = 0;
    const confirm = vi.fn(async () => {
      calls.push('confirmar');

      return confirm.mock.calls.length < 2 ? BACK : undefined;
    });
    const state = await runWizard<{ a?: number; b?: number }>(
      [
        { name: 'a', run: async () => ({ a: (calls.push('a'), 1) }) },
        {
          name: 'consulta',
          run: async () => {
            calls.push('consulta');

            return NOT_ASKED;
          },
        },
        {
          name: 'b',
          run: async () => {
            calls.push('b');
            asked += 1;

            return asked === 1 ? BACK : { b: asked };
          },
        },
        {
          name: 'consulta-final',
          run: async () => {
            calls.push('consulta-final');

            return NOT_ASKED;
          },
        },
      ],
      {},
      undefined,
      { confirm },
    );

    expect(state).toEqual({ a: 1, b: 3 });
    expect(calls).toEqual([
      ...['a', 'consulta', 'b'],
      // "Volver" en b llega a la pregunta anterior, no a la consulta.
      ...['a', 'consulta', 'b', 'consulta-final', 'confirmar'],
      ...['b', 'consulta-final', 'confirmar'],
    ]);
  });

  it('una respuesta vacía de un paso que sí preguntó entra en la historia', async () => {
    const asked: string[] = [];
    const confirm = vi.fn(async () => (confirm.mock.calls.length < 2 ? BACK : undefined));

    await runWizard<object>(
      ['a', 'b'].map((name) => ({
        name,
        run: async () => {
          asked.push(name);

          return {};
        },
      })),
      {},
      undefined,
      { confirm },
    );

    expect(asked).toEqual(['a', 'b', 'b']);
  });
});
