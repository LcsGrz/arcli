import { describe, expect, it } from 'vitest';

import { asArray } from '../../../lib/arrays/as-array';
import { readExportAnswer } from '../../export/__tests__/export-answer.fixture';
import { EmissionUncertainError } from '../billing.errors';
import { formatArcaMessages } from '../billing.labels';
import { readCae, readCaeExpiration } from '../emission-response';

import { readBillingAnswer } from './billing-answer.fixture';

describe('lo que ARCA contesta a la emisión (ERR-16)', () => {
  it('asArray: un elemento, una lista o nada', () => {
    expect([asArray(undefined), asArray(null), asArray('ab'), asArray(['a'])]).toEqual([[], [], ['ab'], ['a']]);
  });

  it.each([undefined, null, '', ' ', 0])('%j no es un CAE', (value) => {
    expect(readCae(value)).toBeNull();
  });

  it.each([{}, [], true, Number.NaN])('con %j no se sabe si hay CAE', (value) => {
    expect(() => readCae(value)).toThrow('el CAE de la respuesta no es un texto ni un número');
  });

  it('el vencimiento es una fecha o null', () => {
    expect(['20261127', 20261127, '2026-11-27', '20260230', '27/11/2026', {}].map(readCaeExpiration)).toEqual([
      '20261127',
      '20261127',
      '20261127',
      null,
      null,
      null,
    ]);
  });

  it('un rechazo con algo ilegible en lugar del CAE sigue siendo un rechazo', async () => {
    const response = { FeDetResp: { FECAEDetResponse: [{ CAE: {}, Resultado: 'R' }] } };

    expect(await readBillingAnswer({ cae: '', caeFchVto: '', response })).toMatchObject({
      cae: null,
      status: 'rechazado',
    });
  });

  it('un texto suelto se lee en la terminal', () => {
    expect(formatArcaMessages([{ codigo: null, mensaje: 'hola' }])).toBe('1. hola');
  });

  it('la E con el resultado en una lista', async () => {
    const output = { FEXAuthorizeResult: { FEXResultAuth: [{ Cae: '1', Resultado: 'A' }] } };

    expect(await readExportAnswer(output)).toMatchObject({ cae: '1', status: 'aprobado' });
  });

  it.each([
    [
      { Fault: { faultstring: 'Invalid XML', detail: 'Unclosed root tag' } },
      'hubo un error inesperado al emitir (Invalid XML)',
    ],
    [{ message: 'algo' }, 'hubo un error inesperado al emitir (algo)'],
    [{ Fault: { faultstring: {} } }, 'hubo un error inesperado al emitir'],
    [null, 'hubo un error inesperado al emitir'],
    ['socket hang up', 'socket hang up'],
    [new TypeError(`a\n  b${'x'.repeat(300)}`), `hubo un error inesperado al emitir (a b${'x'.repeat(197)})`],
  ])('la causa %j se lee', (cause, causa) => {
    const error = new EmissionUncertainError({
      arcaType: 11,
      cause,
      environment: 'testing',
      pointOfSale: 3,
      shortcut: 'fc',
    });

    expect(error.details).toEqual({ causa, entorno: 'testing', puntoVenta: 3, tipoArca: 11 });
    expect((error.cause as Error).cause).toBe(cause);
  });

  it('el error interno queda en cause', () => {
    const original = new TypeError("Cannot read properties of undefined (reading 'x')");
    const error = new EmissionUncertainError({
      arcaType: 11,
      cause: original,
      environment: 'testing',
      pointOfSale: 3,
      shortcut: 'fc',
    });

    expect(error.message).toBe(
      "No se pudo confirmar la emisión: hubo un error inesperado al emitir (Cannot read properties of undefined (reading 'x'))",
    );
    expect((error.cause as Error).cause).toBe(original);
  });
});
