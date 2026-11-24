import { describe, expect, it } from 'vitest';

import { describeJsonError } from '../json-error';

/** Los textos de V8 cambian con la version de Node: de ellos solo se toma la posicion. */
describe('describeJsonError', () => {
  it.each([
    ['Node 18', 'Unexpected token s in JSON at position 9', '{\n  "a": sk-secreto\n}', 'en la línea 2, columna 8'],
    [
      'Node 22',
      "Expected property name or '}' in JSON at position 4 (line 2 column 3)",
      '{\n  sk-secreto\n}',
      'en la línea 2, columna 3',
    ],
    [
      'Node 22, clave PEM',
      'No number after minus sign in JSON at position 1 (line 1 column 2)',
      '-----BEGIN PRIVATE KEY-----\nsk-secreto\n-----END PRIVATE KEY-----',
      'en la línea 1, columna 2',
    ],
    [
      'Node 24, sin "in JSON"',
      'Unexpected non-whitespace character after JSON at position 3 (line 1 column 4)',
      '{} x',
      'en la línea 1, columna 4',
    ],
  ])('%s: línea y columna de la posición', (_name, message, content, where) => {
    expect(describeJsonError(new SyntaxError(message), content)).toBe(`el JSON está mal escrito ${where}`);
  });

  it.each([
    ['Node 22', `Unexpected token 'h', "hola" is not valid JSON`],
    ['Node 26, un texto que no conocemos', 'JSON Parse error: hola'],
    // El trozo del archivo no puede hacerse pasar por la posicion.
    ['la posición en el contenido', `Unexpected token 'h', "hola in JSON at position 1" is not valid JSON`],
    ['una posición que no está en el archivo', 'Bad in JSON at position 900'],
  ])('%s: sin línea ni columna y sin el contenido', (_name, message) => {
    expect(describeJsonError(new SyntaxError(message), 'hola in JSON at position 1')).toBe('el JSON está mal escrito');
  });

  it.each(['', '  \n', '﻿'])('vacío (%#)', (content) => {
    expect(describeJsonError(new SyntaxError('Unexpected end of JSON input'), content)).toBe('el archivo está vacío');
  });

  it.each([
    'Unexpected end of JSON input',
    'Unterminated string in JSON at position 12',
    'Unterminated string in JSON at position 12 (line 2 column 11)',
    "Expected ',' or '}' after property value in JSON at position 12 (line 2 column 11)",
  ])('cortado al final: %s', (message) => {
    expect(describeJsonError(new SyntaxError(message), '{\n"a": "hola')).toBe(
      'el JSON se corta en la línea 2, columna 11: falta el final',
    );
  });

  it('con el Node que corre, nunca muestra el contenido', () => {
    for (const content of [
      'hola',
      '{"a": hola}',
      '[hola',
      '{"a":1,}',
      '-----BEGIN hola',
      '"hola',
      '{} hola',
      'hola\n',
    ]) {
      try {
        JSON.parse(content);
        throw new Error('debería fallar');
      } catch (error) {
        expect(error).toBeInstanceOf(SyntaxError);
        expect(describeJsonError(error, content)).not.toContain('hola');
      }
    }
  });
});
