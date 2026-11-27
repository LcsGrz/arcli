import { describe, expect, it, vi } from 'vitest';

import { LocalDataError } from '../../../modules/local-data/local-data-error';
import { withWriteRetry, WRITE_ATTEMPTS } from '../write-retry';

const locked = () => new LocalDataError('locked', 'tomada por otro proceso');

describe('withWriteRetry (ARQ-12): reintenta la unidad entera, solo si la base está tomada', () => {
  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('tomada dos veces y libre a la tercera: guarda', () => {
    const unit = vi
      .fn<() => string>()
      .mockImplementationOnce(() => {
        throw locked();
      })
      .mockImplementationOnce(() => {
        throw locked();
      })
      .mockReturnValue('guardado');

    expect(withWriteRetry(unit)).toBe('guardado');
    expect(unit).toHaveBeenCalledTimes(3);
  });

  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('tomada en todos los intentos: sale locked después de 3', () => {
    const unit = vi.fn<() => string>(() => {
      throw locked();
    });

    expect(WRITE_ATTEMPTS).toBe(3);
    expect(() => withWriteRetry(unit)).toThrow(expect.objectContaining({ reason: 'locked' }));
    expect(unit).toHaveBeenCalledTimes(WRITE_ATTEMPTS);
  });

  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails.each(['read-only', 'damaged', 'disk-full', 'newer-version', 'mismatch', 'unavailable'] as const)(
    'con %s no reintenta',
    (reason) => {
      const unit = vi.fn<() => string>(() => {
        throw new LocalDataError(reason, 'no es un bloqueo');
      });

      expect(() => withWriteRetry(unit)).toThrow(expect.objectContaining({ reason }));
      expect(unit).toHaveBeenCalledTimes(1);
    },
  );

  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('un error que no es de la base sale enseguida, el mismo', () => {
    const bug = new TypeError('un parámetro undefined');
    const unit = vi.fn<() => string>(() => {
      throw bug;
    });

    expect(() => withWriteRetry(unit)).toThrow(bug);
    expect(unit).toHaveBeenCalledTimes(1);
  });
});
