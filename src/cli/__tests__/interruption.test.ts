import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { finishCut, guardEmission, isCutting, REPEATED_SIGNAL_MS, ResentSignalError } from '../interruption';

/** ARQ-11: quién ataja las señales y cuándo. Los comandos enteros, en `interrupted-emission.test.ts`. */
const SENT = { arcaType: 11, environment: 'testing', pointOfSale: 3, shortcut: 'fc', voucherNumber: 42 } as const;

type Signal = 'SIGINT' | 'SIGTERM';

let stderr = '';
let now = 0;
const other = vi.fn();
const raw = () => [process.rawListeners('SIGINT'), process.rawListeners('SIGTERM')];
let before = raw();

/** Una señal que cuenta aparte de las anteriores. */
function send(signal: Signal): void {
  now += REPEATED_SIGNAL_MS;
  process.emit(signal, signal);
}

interface EmitOptions {
  readonly json?: boolean;
  readonly onCut?: () => void;
  readonly outcome?: { readonly error?: unknown; readonly results: string[] };
}

/** Una emisión que ya envió, recibe las señales y termina con `outcome`. */
function emitWith(signals: readonly Signal[], options: EmitOptions = {}) {
  const { json = true, onCut = vi.fn(), outcome = { results: ['CAE'] } } = options;

  return guardEmission({ json, onCut }, async ({ onSending }) => {
    onSending?.(SENT);
    signals.forEach(send);

    return outcome;
  });
}

const FAILED = { error: new Error('x'), results: [] };

beforeEach(() => {
  now = 0;
  stderr = '';
  other.mockClear();
  // Uno de cada forma: el `once` no tiene que perderse al apartarlos.
  process.once('SIGINT', other);
  process.on('SIGTERM', other);
  before = raw();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(process, 'kill').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);

    return true;
  });
});

afterEach(async () => {
  vi.mocked(performance.now).mockRestore();
  await finishCut();
  vi.restoreAllMocks();
  process.off('SIGINT', other);
  process.off('SIGTERM', other);
});

describe('el aviso', () => {
  it.each([
    [
      'SIGINT',
      'Esperamos a que ARCA conteste, para no dejar la emisión sin confirmar. Con otro Ctrl+C salís sin esperar la respuesta.',
    ],
    ['SIGTERM', 'Esperamos a que ARCA conteste, para no dejar la emisión sin confirmar.'],
  ] as const)('con %s, uno o un lote', async (signal, text) => {
    await emitWith([signal], { json: false });

    expect(stderr.replace(/[^\p{L}\p{N}+,.]+/gu, ' ').trim()).toBe(text);
  });

  it('con --json no hay', async () => {
    await emitWith(['SIGINT']);

    expect(stderr).toBe('');
  });

  it('si no se puede mostrar, la emisión sigue', async () => {
    vi.mocked(process.stderr.write).mockImplementation(() => {
      throw new Error('EIO');
    });

    await expect(emitWith(['SIGINT'], { json: false })).resolves.toEqual({ results: ['CAE'] });
  });
});

describe('sin nada enviado', () => {
  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)(
    '%s: detiene el spinner y repone los listeners antes de reenviarla, una vez',
    async (signal, exitCode) => {
      const order: string[] = [];
      const shouldStop: Array<boolean | undefined> = [];
      let atKill: ReturnType<typeof raw> | undefined;

      vi.mocked(process.kill).mockImplementation((_pid, sent) => {
        order.push(`kill ${String(sent)}`);
        atKill = raw();

        return true;
      });

      const run = guardEmission({ json: false, onCut: () => order.push('onCut') }, async (interruption) => {
        shouldStop.push(interruption.shouldStop?.());
        send(signal);
        shouldStop.push(interruption.shouldStop?.());

        return { results: [] };
      });
      const error = await run.catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(ResentSignalError);
      expect(error).toMatchObject({ exitCode });
      expect(order).toEqual(['onCut', `kill ${signal}`]);
      expect(atKill).toEqual(before);
      // Ni se reponen otra vez al terminar.
      expect(raw()).toEqual(before);
      expect(shouldStop).toEqual([false, true]);
      expect(stderr).toBe('');
    },
  );
});

describe('tras dos señales', () => {
  it('con todo contestado: no hay nada que cortar', async () => {
    const onCut = vi.fn();

    await emitWith(['SIGINT', 'SIGINT'], { onCut });

    expect(isCutting()).toBe(false);
    expect(raw()).toEqual(before);
    await finishCut();
    expect(process.kill).not.toHaveBeenCalled();
    expect(onCut).not.toHaveBeenCalled();
  });

  it('con error: se atajan hasta finishCut, que repone los listeners y recién ahí reenvía la última', async () => {
    let atKill: ReturnType<typeof raw> | undefined;
    const beforeCut = vi.fn(() => {
      expect(process.kill).not.toHaveBeenCalled();
    });

    vi.mocked(process.kill).mockImplementation(() => {
      atKill = raw();

      return true;
    });
    await emitWith(['SIGTERM', 'SIGINT'], { outcome: FAILED });

    expect(isCutting()).toBe(true);
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual([1, 1]);
    send('SIGINT');
    send('SIGTERM');
    expect(other).not.toHaveBeenCalled();
    expect(process.kill).not.toHaveBeenCalled();

    await finishCut(beforeCut);

    expect(beforeCut).toHaveBeenCalledOnce();
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(process.pid, 'SIGINT');
    expect(atKill).toEqual(before);
    expect(isCutting()).toBe(false);
  });
});

it.each([0, 1, 2])(
  'si emitir lanza tras %i señales, se reponen los listeners y no queda nada por cortar',
  async (times) => {
    await expect(
      guardEmission({ json: true, onCut: vi.fn() }, async ({ onSending }) => {
        onSending?.(SENT);
        Array.from({ length: times }, () => send('SIGINT'));

        throw new Error('se rompió');
      }),
    ).rejects.toThrow('se rompió');
    expect(raw()).toEqual(before);
    expect(isCutting()).toBe(false);
  },
);

it('con una señal y un error, no hay nada que cortar', async () => {
  await emitWith(['SIGINT'], { outcome: FAILED });

  expect(isCutting()).toBe(false);
  expect(raw()).toEqual(before);
});
