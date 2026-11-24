import { describe, expect, it } from 'vitest';

import { asArray } from '../../../lib/arrays/as-array';
import { mapExportResponse } from '../../export/export.response';
import { EmissionUncertainError } from '../billing.errors';
import { mapBillingResponse } from '../billing-response';
import { readCae, readCaeExpiration } from '../emission-response';

describe('lo que ARCA contesta a la emisión (ERR-16)', () => {
  it('asArray: un elemento, una lista o nada', () => {
    expect([asArray(undefined), asArray(null), asArray('ab'), asArray(['a'])]).toEqual([[], [], ['ab'], ['a']]);
  });

  it.each([undefined, null, '', ' ', 0])('%j no es un CAE', (value) => {
    expect(readCae(value)).toBeNull();
  });

  it.each([{}, [], true, Number.NaN])('con %j no se sabe si hay CAE', (value) => {
    expect(() => readCae(value)).toThrow('ARCA contestó algo que ARCLI no pudo leer');
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

  it('un rechazo con algo ilegible en lugar del CAE sigue siendo un rechazo', () => {
    const response = { FeDetResp: { FECAEDetResponse: [{ CAE: {}, Resultado: 'R' }] } };

    expect(mapBillingResponse({ cae: '', caeFchVto: '', response } as never)).toMatchObject({
      cae: null,
      status: 'rechazado',
    });
  });

  it('la E con el resultado en una lista', () => {
    const output = { FEXAuthorizeResult: { FEXResultAuth: [{ Cae: '1', Resultado: 'A' }] } };

    expect(mapExportResponse(output as never)).toMatchObject({ cae: '1', status: 'aprobado' });
  });

  it('el error interno queda en cause', () => {
    const original = new TypeError("Cannot read properties of undefined (reading 'x')");
    const error = new EmissionUncertainError({
      cause: original,
      environment: 'testing',
      pointOfSale: 3,
      shortcut: 'fc',
    });

    expect(error.message).toBe('No se pudo confirmar la emisión: ARCA contestó algo que ARCLI no pudo leer');
    expect((error.cause as Error).cause).toBe(original);
  });
});
