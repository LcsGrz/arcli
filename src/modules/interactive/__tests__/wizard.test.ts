import { describe, expect, it } from 'vitest';

import { BACK, requireStepValue, runWizard, type WizardStep } from '../wizard';

interface State {
  readonly a?: string;
  readonly b?: string;
  readonly c?: string;
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

  it('al volver, el paso recibe su ultima respuesta; si una respuesta cambia, los pasos siguientes la olvidan', async () => {
    const seen: Array<[string, string | undefined]> = [];
    const answers: Record<string, Array<string | typeof BACK>> = {
      a: ['1', '1', '2'],
      b: ['x', BACK, 'x', BACK, 'y'],
      c: [BACK, BACK, '3'],
    };
    const steps: Array<WizardStep<State>> = (['a', 'b', 'c'] as const).map((name) => ({
      name,
      run: async (_state, previous) => {
        seen.push([name, previous?.[name]]);
        const answer = answers[name]?.shift();

        return answer === BACK ? BACK : { [name]: answer };
      },
    }));

    // a=1, b=x, c volver, b volver, a=1 (igual), b=x (marcada), c volver, b volver, a=2 (cambia), b=y, c=3.
    expect(await runWizard(steps, {})).toEqual({ a: '2', b: 'y', c: '3' });
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
    ]);
  });

  it('las respuestas compartidas sobreviven a otra corrida del asistente', async () => {
    const answers = new Map<string, Partial<State>>();
    const previous: Array<Partial<State> | undefined> = [];
    const steps: Array<WizardStep<State>> = [
      {
        name: 'a',
        run: async (_state, last) => {
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
