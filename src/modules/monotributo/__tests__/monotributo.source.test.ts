import { afterEach, describe, expect, it, vi } from 'vitest';

import { QueryCancelledError } from '../../../lib/errors/query-cancelled';
import { fetchMonotributoPage } from '../monotributo.source';

describe('fetchMonotributoPage', () => {
  it('devuelve el HTML', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html></html>'));

    await expect(fetchMonotributoPage(fetchImpl)).resolves.toEqual({ html: '<html></html>', ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://www.afip.gob.ar/monotributo/categorias.asp',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('sin conexión', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(fetchMonotributoPage(fetchImpl)).resolves.toEqual({ ok: false, reason: 'sin-conexion' });
  });

  it('un error HTTP', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));

    await expect(fetchMonotributoPage(fetchImpl)).resolves.toEqual({ ok: false, reason: 'error-http', status: 503 });
  });

  it('corta si ARCA no responde a tiempo', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    await expect(fetchMonotributoPage(fetchImpl as typeof fetch, 10)).resolves.toEqual({
      ok: false,
      reason: 'sin-respuesta',
    });
  });
});

/** ARQ-11 PR 5: la pagina con la señal de quien la espera (Ctrl+C en el asistente) y su plazo propio. */
const hanging = vi.fn(
  (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }),
) as unknown as typeof fetch;

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchMonotributoPage con señal', () => {
  it('cortada con la señal de quien la pidió, lanza su razón: no es una página que no contestó', async () => {
    const controller = new AbortController();
    const reason = new QueryCancelledError();
    const page = fetchMonotributoPage(hanging, undefined, controller.signal);

    controller.abort(reason);

    await expect(page).rejects.toBe(reason);
  });

  it('con la señal sin abortar, su plazo de 5 s sigue cortando como "sin respuesta"', async () => {
    vi.useFakeTimers();

    const page = fetchMonotributoPage(hanging, undefined, new AbortController().signal);

    await vi.advanceTimersByTimeAsync(4999);
    await vi.advanceTimersByTimeAsync(1);

    await expect(page).resolves.toEqual({ ok: false, reason: 'sin-respuesta' });
  });

  it('antes de los 5 s no corta', async () => {
    vi.useFakeTimers();

    let settled = false;
    const page = fetchMonotributoPage(hanging, undefined, new AbortController().signal).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await page;
  });
});
