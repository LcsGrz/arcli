import { describe, expect, it, vi } from 'vitest';

import { startBackgroundQuery } from '../background-query';

const turn = () => new Promise((resolve) => setImmediate(resolve));

describe('startBackgroundQuery', () => {
  it('da lo que contesta, avisa una vez y termina', async () => {
    const listener = vi.fn();
    const query = startBackgroundQuery(async () => 'bien', 'falla');

    query.subscribe(listener);
    expect(query.value()).toBeUndefined();
    await query.settled;
    expect(query.value()).toBe('bien');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('si falla, contesta lo de error', async () => {
    const query = startBackgroundQuery(async () => Promise.reject(new Error('x')), 'falla');

    await query.settled;
    expect(query.value()).toBe('falla');
  });

  it('cancelarla termina aunque la consulta esté colgada, y le llega la señal', async () => {
    let received: AbortSignal | undefined;
    const query = startBackgroundQuery<string>((signal) => {
      received = signal;

      return new Promise(() => undefined);
    }, 'falla');

    expect(received?.aborted).toBe(false);
    query.cancel();
    await query.settled;
    expect(received?.aborted).toBe(true);
    expect(query.value()).toBeUndefined();
  });

  it.each(['contesta', 'falla'])('si %s después de cancelarla, no cuenta ni avisa', async (how) => {
    const listener = vi.fn();
    let finish: () => void = () => undefined;
    const query = startBackgroundQuery<string>(
      () =>
        new Promise((resolve, reject) => {
          finish = () => (how === 'contesta' ? resolve('tarde') : reject(new Error('tarde')));
        }),
      'falla',
    );

    query.subscribe(listener);
    query.cancel();
    finish();
    await turn();
    expect(query.value()).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it('al dejar de escuchar no avisa más, y los demás siguen', async () => {
    const left = vi.fn();
    const stays = vi.fn();
    const query = startBackgroundQuery(async () => 'bien', 'falla');
    const stop = query.subscribe(left);

    query.subscribe(stays);
    stop();
    await query.settled;
    expect(left).not.toHaveBeenCalled();
    expect(stays).toHaveBeenCalledTimes(1);
  });
});
