import { describe, expect, it } from 'vitest';

import { AppError } from '../app-error';
import { ERROR_CODES } from '../error-codes';

describe('códigos de error', () => {
  it('no repite ninguno', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it('un código que no está en la lista no compila', () => {
    // @ts-expect-error: `CODIGO_INVENTADO` no está en ERROR_CODES.
    expect(new AppError('Falló.', { code: 'CODIGO_INVENTADO' }).code).toBe('CODIGO_INVENTADO');
  });
});
