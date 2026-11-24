import { describe, expect, it } from 'vitest';

import { InputValidationError } from '../../../lib/errors/app-error';
import type { Rule } from '../../../lib/rules/rules';
import { rulesFinalize, ruleValidator, scopedRuleValidator } from '../rule-validator';

interface Input {
  readonly a?: number;
  readonly b?: number;
}

interface Context {
  readonly max: number;
}

/** `a` no pasa de `b`; el texto del CLI nombra flags y el del asistente, preguntas. */
const ORDER: Rule<Input, Context> = {
  check: ({ a, b }) =>
    a !== undefined && b !== undefined && a > b
      ? { hint: 'Revisá `--a`.', message: '`--a` no puede pasar de `--b`.', question: '"A" no puede pasar de "B".' }
      : undefined,
  fields: ['a', 'b'],
  id: 'order',
};

/** `b` no pasa del maximo del contexto; mismo texto en los dos lados. */
const MAX: Rule<Input, Context> = {
  check: ({ b }, { max }) => (b !== undefined && b > max ? `B no puede pasar de ${max}.` : undefined),
  fields: ['b'],
  id: 'max',
};

/** Una regla que lee un dato mal escrito: lanza el error del CLI. */
const THROWS: Rule<Input, Context> = {
  check: ({ a }) => {
    if (a === -1) {
      throw new InputValidationError('La fecha "x" no es válida.');
    }

    if (a === -2) {
      throw new Error('bug');
    }

    return undefined;
  },
  fields: ['a'],
  id: 'throws',
};

const RULES = [ORDER, MAX, THROWS];
const CONTEXT: Context = { max: 10 };

describe('ruleValidator', () => {
  const validator = (field: string, validate?: (value: string) => string | true) =>
    ruleValidator<Input, Input, Context>({
      context: () => CONTEXT,
      draft: (state, candidate) => ({ ...state, [field]: Number(candidate) }),
      field,
      rules: RULES,
      validate,
    });

  it('corre solo las reglas que leen el campo, con el texto de la pregunta', () => {
    expect(validator('a')({ b: 5 })('6')).toBe('"A" no puede pasar de "B".');
    expect(validator('a')({ b: 5 })('5')).toBe(true);
    // `MAX` no lee `a`: con `b` fuera del maximo, la pregunta de `a` igual pasa.
    expect(validator('a')({ b: 50 })('1')).toBe(true);
    expect(validator('b')({ a: 1 })('11')).toBe('B no puede pasar de 10.');
    expect(validator('b')({ a: 3 })('2')).toBe('"A" no puede pasar de "B".');
  });

  it('primero el formato de la pregunta: si no pasa, no corre las reglas', () => {
    const format = (value: string) => (value === 'x' ? 'Formato inválido.' : true);

    expect(validator('a', format)({ b: 5 })('x')).toBe('Formato inválido.');
    expect(validator('a', format)({ b: 5 })('6')).toBe('"A" no puede pasar de "B".');
  });

  it('un dato mal escrito devuelve el error del CLI; un error que no es de entrada se lanza', () => {
    expect(validator('a')({})('-1')).toBe('La fecha "x" no es válida.');
    expect(() => validator('a')({})('-2')).toThrow('bug');
  });
});

describe('scopedRuleValidator', () => {
  it('arma la entrada con `draft` y lo que escribe la pregunta', () => {
    const scope = { context: () => CONTEXT, draft: (patch: Partial<Input>) => ({ b: 5, ...patch }) };

    expect(scopedRuleValidator(RULES, 'a', scope, (value) => ({ a: Number(value) }))('6')).toBe(
      '"A" no puede pasar de "B".',
    );
    expect(scopedRuleValidator(RULES, 'a', scope, (value) => ({ a: Number(value) }))('4')).toBe(true);
  });
});

describe('rulesFinalize', () => {
  const finalize = (state: Input | undefined) =>
    rulesFinalize<Input | undefined, Input, Context>({
      context: () => CONTEXT,
      draft: (current) => current,
      rules: RULES,
    })(state);

  it('con una regla que falla, vuelve a sus campos con el texto de la pregunta', () => {
    expect(finalize({ a: 6, b: 5 })).toEqual({ field: ['a', 'b'], message: '"A" no puede pasar de "B".' });
    expect(finalize({ a: 1, b: 11 })).toEqual({ field: ['b'], message: 'B no puede pasar de 10.' });
  });

  it('sin entrada, si todo pasa o con un dato mal escrito, no vuelve (queda para la vista previa)', () => {
    expect(finalize(undefined)).toBeUndefined();
    expect(finalize({ a: 1, b: 5 })).toBeUndefined();
    expect(finalize({ a: -1 })).toBeUndefined();
    expect(() => finalize({ a: -2 })).toThrow('bug');
  });
});
