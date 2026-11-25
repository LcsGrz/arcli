import { afterEach, describe, expect, it, vi } from 'vitest';

import { exitWhenWritten, type OutputState } from '../closed-output';

/** ARQ-11: salir tras abandonar un PDF, sin perder lo que todavía no se leyó. */
function prepare(pending: { stderr?: number; stdout?: number }, timeoutMs = 5000) {
  const order: string[] = [];
  const outputs = { stderr: { writableLength: pending.stderr ?? 0 }, stdout: { writableLength: pending.stdout ?? 0 } };
  const state: OutputState = { closed: new Map(), failures: new Map() };
  const run = () =>
    exitWhenWritten(() => order.push('aviso'), { exit: () => order.push('salir'), outputs, state, timeoutMs });

  return { order, outputs, run, state };
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('exitWhenWritten', () => {
  it('sin nada pendiente sale enseguida, con el código que había', async () => {
    const { order, run } = prepare({});

    process.exitCode = 2;
    void run();

    expect(order).toEqual(['aviso', 'salir']);
    expect(process.exitCode).toBe(2);
  });

  it.each(['stdout', 'stderr'] as const)('con %s pendiente espera a que se escriba', async (output) => {
    const { order, outputs, run } = prepare({ [output]: 1 });
    const running = run();
    let wasWaiting = false;

    setTimeout(() => {
      wasWaiting = order.length === 0;
      outputs[output].writableLength = 0;
    }, 300);
    // El plazo no retiene el proceso: en el test lo retiene este.
    await vi.waitFor(() => expect(order).toEqual(['aviso', 'salir']), { timeout: 3000 });
    await running;

    expect(wasWaiting).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('con una salida que ya no lee nadie, no espera', async () => {
    const { order, run, state } = prepare({ stdout: 1 });

    state.closed.set('stdout', new Error('EPIPE'));
    void run();

    expect(order).toEqual(['aviso', 'salir']);
    expect(process.exitCode).toBeUndefined();
  });

  it.each([
    [undefined, 1],
    [2, 2],
    [143, 143],
  ])('vencido el plazo con algo pendiente y exit %s, sale con %i', async (before, after) => {
    const { order, run } = prepare({ stdout: 1 }, 0);

    process.exitCode = before;
    await run();

    expect(order).toEqual(['aviso', 'salir']);
    expect(process.exitCode).toBe(after);
  });
});
