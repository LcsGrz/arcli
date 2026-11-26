import { describe, expect, it, vi } from 'vitest';

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
