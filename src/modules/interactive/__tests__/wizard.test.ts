import { describe, expect, it } from 'vitest';

import { BACK, runWizard, type WizardStep } from '../wizard';

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

  it('devuelve undefined si se vuelve desde el primer paso', async () => {
    expect(await runWizard(scripted({ a: [BACK] }), {})).toBeUndefined();
  });
});
