import { describe, expect, it, vi } from 'vitest';

import { LocalDataError } from '../../../modules/local-data/local-data-error';
import { RETRY_PAUSE_MS, withWriteRetry, WRITE_ATTEMPTS } from '../write-retry';

const locked = () => new LocalDataError('locked', 'tomada por otro proceso');

/** Las pausas que pidió, sin esperar de verdad. */
function pauses(random = () => 0.5) {
  const pause = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());

  return { options: { pause, random }, pause };
}

describe('withWriteRetry (ARQ-12): reintenta la unidad entera, solo si la base está tomada', () => {
  it('tomada dos veces y libre a la tercera: guarda', async () => {
    const unit = vi
      .fn<() => string>()
      .mockImplementationOnce(() => {
        throw locked();
      })
      .mockImplementationOnce(() => {
        throw locked();
      })
      .mockReturnValue('guardado');

    await expect(withWriteRetry(unit, pauses().options)).resolves.toBe('guardado');
    expect(unit).toHaveBeenCalledTimes(3);
  });

  it('tomada en todos los intentos: sale locked después de 3', async () => {
    const unit = vi.fn<() => string>(() => {
      throw locked();
    });

    expect(WRITE_ATTEMPTS).toBe(3);
    await expect(withWriteRetry(unit, pauses().options)).rejects.toMatchObject({ reason: 'locked' });
    expect(unit).toHaveBeenCalledTimes(WRITE_ATTEMPTS);
  });

  it.each(['read-only', 'damaged', 'disk-full', 'newer-version', 'mismatch', 'unavailable'] as const)(
    'con %s no reintenta',
    async (reason) => {
      const { options, pause } = pauses();
      const unit = vi.fn<() => string>(() => {
        throw new LocalDataError(reason, 'no es un bloqueo');
      });

      await expect(withWriteRetry(unit, options)).rejects.toMatchObject({ reason });
      expect(unit).toHaveBeenCalledTimes(1);
      expect(pause).not.toHaveBeenCalled();
    },
  );

  it('un error que no es de la base sale enseguida, el mismo', async () => {
    const bug = new TypeError('un parámetro undefined');
    const unit = vi.fn<() => string>(() => {
      throw bug;
    });

    await expect(withWriteRetry(unit, pauses().options)).rejects.toBe(bug);
    expect(unit).toHaveBeenCalledTimes(1);
  });
});

describe('withWriteRetry: la pausa entre intentos, para que los procesos que esperan no vuelvan a la vez', () => {
  it('una entre cada intento bloqueado y el siguiente, ninguna después del último', async () => {
    const { options, pause } = pauses();
    const unit = vi.fn<() => string>(() => {
      throw locked();
    });

    await expect(withWriteRetry(unit, options)).rejects.toMatchObject({ reason: 'locked' });
    expect(pause).toHaveBeenCalledTimes(WRITE_ATTEMPTS - 1);
  });

  it('libre al primer intento: no espera', async () => {
    const { options, pause } = pauses();

    await expect(withWriteRetry(() => 'guardado', options)).resolves.toBe('guardado');
    expect(pause).not.toHaveBeenCalled();
  });

  it.each([
    [0, 50],
    [0.5, 175],
    [0.999_999, 300],
  ])('al azar de 50 a 300 ms: con %s, %s ms', async (random, ms) => {
    const { options, pause } = pauses(() => random);
    const unit = vi
      .fn<() => string>()
      .mockImplementationOnce(() => {
        throw locked();
      })
      .mockReturnValue('guardado');

    expect(RETRY_PAUSE_MS).toEqual({ max: 300, min: 50 });
    await withWriteRetry(unit, options);
    expect(pause).toHaveBeenCalledWith(ms);
  });

  it('reintenta recién cuando terminó la pausa', async () => {
    let wake: () => void = () => undefined;
    const pause = vi.fn(() => new Promise<void>((resolve) => (wake = resolve)));
    const unit = vi
      .fn<() => string>()
      .mockImplementationOnce(() => {
        throw locked();
      })
      .mockReturnValue('guardado');

    const saving = withWriteRetry(unit, { pause, random: () => 0 });

    await vi.waitFor(() => expect(pause).toHaveBeenCalled());
    expect(unit).toHaveBeenCalledTimes(1);
    wake();
    await expect(saving).resolves.toBe('guardado');
    expect(unit).toHaveBeenCalledTimes(2);
  });

  it('sin opciones espera de verdad, sin bloquear el proceso', async () => {
    const unit = vi
      .fn<() => string>()
      .mockImplementationOnce(() => {
        throw locked();
      })
      .mockReturnValue('guardado');
    let ticks = 0;
    const ticking = setInterval(() => (ticks += 1), 5);
    const started = performance.now();

    try {
      await expect(withWriteRetry(unit)).resolves.toBe('guardado');
    } finally {
      clearInterval(ticking);
    }

    expect(performance.now() - started).toBeGreaterThanOrEqual(RETRY_PAUSE_MS.min - 5);
    expect(ticks).toBeGreaterThan(0);
  });
});
