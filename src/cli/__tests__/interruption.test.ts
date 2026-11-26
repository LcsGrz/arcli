import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryCancelledError } from '../../lib/errors/query-cancelled';
import {
  finishCut,
  guardEmission,
  interruptibleWait,
  isCutting,
  isWaiting,
  REPEATED_SIGNAL_MS,
  ResentSignalError,
} from '../interruption';
import { isPromptCancellation } from '../prompt-cancellation';

/** ARQ-11: quién ataja las señales y cuándo. Los comandos enteros, en `interrupted-emission.test.ts`. */
const SENT = { arcaType: 11, environment: 'testing', pointOfSale: 3, shortcut: 'fc', voucherNumber: 42 } as const;

type Signal = 'SIGINT' | 'SIGTERM';

let stderr = '';
let now = 0;
const other = vi.fn();
const raw = () => [process.rawListeners('SIGINT'), process.rawListeners('SIGTERM')];
let before = raw();
const newListeners = process.listenerCount('newListener');

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

describe('mientras se entrega', () => {
  /** Una emisión enviada, entregada con `deliver`. */
  const deliverWith = (deliver: Parameters<typeof guardEmission<string>>[2], signals: readonly Signal[] = []) =>
    guardEmission<string>(
      { json: true, onCut: vi.fn() },
      async ({ onSending }) => {
        onSending?.(SENT);
        signals.forEach(send);

        return { results: ['CAE'] };
      },
      deliver,
    );

  it('la primera aborta; la segunda corta recién en finishCut, con los listeners de siempre', async () => {
    const seen: boolean[] = [];
    let atKill: ReturnType<typeof raw> | undefined;

    vi.mocked(process.kill).mockImplementation(() => {
      atKill = raw();

      return true;
    });
    await deliverWith(async (_outcome, { signal }) => {
      seen.push(signal.aborted);
      send('SIGINT');
      seen.push(signal.aborted);
      send('SIGTERM');
    });

    expect(seen).toEqual([false, true]);
    expect(process.kill).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();

    await finishCut();

    expect(process.kill).toHaveBeenCalledExactlyOnceWith(process.pid, 'SIGTERM');
    expect(atKill).toEqual(before);
  });

  it('con una sola, todo escrito: el eco no corta, una de verdad sí, y los listeners vuelven', async () => {
    await deliverWith(async () => send('SIGINT'));

    const exitIfStuck = vi.fn();

    vi.useFakeTimers({ toFake: ['setTimeout'] });

    try {
      await finishCut(undefined, exitIfStuck);
      now += REPEATED_SIGNAL_MS - 1;
      process.emit('SIGINT', 'SIGINT');
      expect(process.kill).not.toHaveBeenCalled();
      now += 1;
      process.emit('SIGINT', 'SIGINT');
      expect(process.kill).toHaveBeenCalledExactlyOnceWith(process.pid, 'SIGINT');
      expect(raw()).toEqual(before);
      expect(exitIfStuck).not.toHaveBeenCalled();
      vi.advanceTimersByTime(REPEATED_SIGNAL_MS);
      expect(raw()).toEqual(before);
      expect(exitIfStuck).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('en una pregunta los listeners son los de antes, y vuelven los propios', async () => {
    const seen: Array<ReturnType<typeof raw>> = [];

    await deliverWith(async (_outcome, { whileAsking }) => {
      expect(await whileAsking(async () => seen.push(raw()))).toBe(1);
      seen.push(raw());
      await expect(whileAsking(() => Promise.reject(new Error('Esc')))).rejects.toThrow('Esc');
      seen.push(raw());
    });

    expect(seen[0]).toEqual(before);
    expect(seen[1]).not.toEqual(before);
    expect(seen[2]).toEqual(seen[1]);
    expect(raw()).toEqual(before);
  });

  it('una pregunta espera a que pase el eco de la señal anterior', async () => {
    let asked = 0;
    const start = Date.now();

    await deliverWith(
      async (_outcome, { whileAsking }) => {
        await whileAsking(async () => {
          asked = Date.now();
        });
      },
      ['SIGINT'],
    );

    expect(asked - start).toBeGreaterThanOrEqual(REPEATED_SIGNAL_MS - 50);
    expect(process.kill).not.toHaveBeenCalled();
  });

  it('una pregunta espera solo lo que le falta al eco', async () => {
    let asked = 0;

    await deliverWith(
      async (_outcome, { whileAsking }) => {
        now += REPEATED_SIGNAL_MS - 100;

        const start = Date.now();

        await whileAsking(async () => {
          asked = Date.now() - start;
        });
      },
      ['SIGINT'],
    );

    expect(asked).toBeGreaterThanOrEqual(90);
    expect(asked).toBeLessThan(REPEATED_SIGNAL_MS - 50);
  });

  it('un listener de otro evento no se toca', async () => {
    const added = vi.fn();

    try {
      await deliverWith(async () => {
        process.on('warning', added);
        await Promise.resolve();
        expect(process.listeners('warning')).toContain(added);
      });

      expect(process.listeners('warning')).toContain(added);
    } finally {
      process.off('warning', added);
    }
  });

  it('un listener agregado justo antes de soltar no se aparta', async () => {
    const added = vi.fn();
    let whileAsked: readonly unknown[] = [];

    try {
      await deliverWith(async (_outcome, { whileAsking }) => {
        process.on('SIGINT', added);
        await whileAsking(async () => {
          await Promise.resolve();
          whileAsked = process.listeners('SIGINT');
        });
      });

      expect(whileAsked).toContain(added);
    } finally {
      process.off('SIGINT', added);
    }
  });

  it('ya cortado no se pregunta', async () => {
    const ask = vi.fn();
    let answer: unknown = 'sin responder';

    await deliverWith(async (_outcome, { whileAsking }) => {
      send('SIGINT');
      now += REPEATED_SIGNAL_MS;
      answer = await whileAsking(ask);
    });

    expect(answer).toBeUndefined();
    expect(ask).not.toHaveBeenCalled();
    await finishCut();
    await vi.waitFor(() => expect(raw()).toEqual(before), { timeout: 2000 });
  });

  it('si entregar falla, los listeners vuelven', async () => {
    await expect(deliverWith(() => Promise.reject(new Error('se rompió')))).rejects.toThrow('se rompió');
    // Hasta que se escriba el error.
    expect(raw()).not.toEqual(before);
    await finishCut();
    expect(raw()).toEqual(before);
  });

  it('sin señal no queda nada pendiente: los listeners vuelven apenas se entrega', async () => {
    let turned = false;

    setImmediate(() => {
      turned = true;
    });
    await deliverWith(async () => undefined);

    expect(turned).toBe(false);
    expect(raw()).toEqual(before);
  });

  it('con un error, se atajan hasta que se escribe; con una señal reciente, hasta que pasa su eco', async () => {
    const failing = () =>
      guardEmission<string>(
        { json: true, onCut: vi.fn() },
        async ({ onSending }) => {
          onSending?.(SENT);

          return { error: new Error('x'), results: [] };
        },
        async (outcome) => {
          throw 'error' in outcome ? outcome.error : outcome;
        },
      );

    await expect(failing()).rejects.toThrow('x');
    send('SIGINT');
    expect(other).not.toHaveBeenCalled();
    await finishCut();
    expect(raw()).not.toEqual(before);
    process.emit('SIGINT', 'SIGINT');
    expect(process.kill).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(raw()).toEqual(before), { timeout: 2000 });
  });

  it('una señal esperando a ARCA, sin PDF: el eco tampoco corta con todo escrito', async () => {
    await deliverWith(async () => undefined, ['SIGINT']);
    process.emit('SIGINT', 'SIGINT');
    await finishCut();
    process.emit('SIGINT', 'SIGINT');

    expect(process.kill).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(raw()).toEqual(before), { timeout: 2000 });
  });

  it.each<readonly [string, readonly Signal[]]>([
    ['sin cortar, no se repone', []],
    ['al cortar, se repone', ['SIGINT']],
  ])('el listener que otro agrega, como el de Puppeteer, se aparta: %s', async (_name, sent) => {
    const added = vi.fn();
    const alone: number[] = [];

    try {
      await deliverWith(async () => {
        process.on('SIGINT', added);
        await Promise.resolve();
        alone.push(process.listenerCount('SIGINT'));
        sent.forEach(send);
      });
      now += REPEATED_SIGNAL_MS;
      await finishCut();

      expect(alone).toEqual([1]);
      expect(added).not.toHaveBeenCalled();
      expect(process.listeners('SIGINT').filter((listener) => listener === added)).toHaveLength(sent.length);
      expect(process.listenerCount('newListener')).toBe(newListeners);
    } finally {
      process.off('SIGINT', added);
    }
  });

  it('dos señales: la reenviada le llega al listener agregado; si no termina, se sale con el código de la señal', async () => {
    const added = vi.fn();
    const exit = vi.fn();
    let exitCode: typeof process.exitCode;

    vi.mocked(process.kill).mockImplementation((_pid, signal) => {
      process.emit(signal as Signal, signal as Signal);

      return true;
    });
    exit.mockImplementation(() => {
      exitCode = process.exitCode;
      process.exitCode = undefined;
    });

    try {
      await deliverWith(async () => {
        process.on('SIGTERM', added);
        await Promise.resolve();
        send('SIGINT');
        send('SIGTERM');
      });
      expect(added).not.toHaveBeenCalled();
      await finishCut(undefined, exit);

      // El de otro (when-exit) puede reenviarla.
      expect(added).toHaveBeenCalled();
      expect(exit).toHaveBeenCalledOnce();
      expect(exitCode).toBe(143);
    } finally {
      process.off('SIGTERM', added);
    }
  });

  it('con todo escrito, si la señal reenviada no termina el proceso, se sale con el código de la señal', async () => {
    const added = vi.fn();
    const exitCodes: Array<typeof process.exitCode> = [];

    // Como el de Puppeteer con SIGTERM: cierra el navegador y nada más.
    vi.mocked(process.kill).mockImplementation(() => true);

    try {
      await deliverWith(async () => {
        process.on('SIGTERM', added);
        await Promise.resolve();
        send('SIGINT');
      });
      await finishCut(undefined, () => exitCodes.push(process.exitCode));
      send('SIGTERM');

      expect(process.kill).toHaveBeenCalledExactlyOnceWith(process.pid, 'SIGTERM');
      expect(process.listeners('SIGTERM')).toContain(added);
      await vi.waitFor(() => expect(exitCodes).toEqual([143, 143]));
    } finally {
      process.exitCode = undefined;
      process.off('SIGTERM', added);
    }
  });

  it('sin un PDF abandonado, la señal con todo escrito solo se reenvía', async () => {
    const exit = vi.fn();

    await deliverWith(async () => undefined, ['SIGINT']);
    await finishCut(undefined, exit);
    send('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(process.kill).toHaveBeenCalledExactlyOnceWith(process.pid, 'SIGTERM');
    expect(exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('sin nada enviado (una vista previa) no se ataja nada', async () => {
    let seen: ReturnType<typeof raw> | undefined;

    await guardEmission(
      { json: true, onCut: vi.fn() },
      async () => ({ results: [] }),
      async () => {
        seen = raw();
      },
    );

    expect(seen).toEqual(before);
  });
});

/** ARQ-11 PR 5: las esperas del asistente. Con el asistente entero, en `interactive/__tests__/assistant-waits.test.ts`. */
describe('interruptibleWait', () => {
  /** Una espera que no termina sola: contesta con `answer`. */
  function hangingWait() {
    let answer: (value: string) => void = () => undefined;
    let received: AbortSignal | undefined;
    const waiting = interruptibleWait(async (signal) => {
      received = signal;

      return new Promise<string>((resolve) => {
        answer = resolve;
      });
    });

    return { answer: (value: string) => answer(value), received: () => received, waiting };
  }

  const listenersBack = () =>
    vi.waitFor(() => expect(raw()).toEqual(before), { interval: 10, timeout: REPEATED_SIGNAL_MS * 3 });

  it('sin señal, devuelve lo de `run` y los listeners vuelven apenas termina', async () => {
    const { answer, waiting } = hangingWait();

    answer('ok');

    await expect(waiting).resolves.toBe('ok');
    expect(raw()).toEqual(before);
  });

  it('SIGINT rechaza enseguida como un Ctrl+C en una pregunta y corta las consultas, sin esperar a `run`', async () => {
    const { received, waiting } = hangingWait();

    send('SIGINT');

    const error = await waiting.catch((thrown: unknown) => thrown);

    expect(isPromptCancellation(error)).toBe(true);
    expect(received()?.aborted).toBe(true);
    expect(received()?.reason).toBeInstanceOf(QueryCancelledError);
    expect(other).not.toHaveBeenCalled();
    expect(process.kill).not.toHaveBeenCalled();
    expect(stderr).toBe('');
    await listenersBack();
  });

  it('SIGTERM no se ataja: sus listeners son los de siempre mientras se espera', async () => {
    const { answer, waiting } = hangingWait();

    expect(process.rawListeners('SIGTERM')).toEqual(before[1]);
    expect(process.rawListeners('SIGINT')).not.toEqual(before[0]);
    answer('ok');
    await waiting;
  });

  it('el eco de npx: otra SIGINT dentro de REPEATED_SIGNAL_MS no le llega a nadie; después vuelven los listeners', async () => {
    const { waiting } = hangingWait();

    send('SIGINT');
    await waiting.catch(() => undefined);
    process.emit('SIGINT', 'SIGINT');

    expect(other).not.toHaveBeenCalled();
    await listenersBack();
  });

  it('una adentro de otra usa la misma señal y no toca los listeners', async () => {
    let inner: AbortSignal | undefined;
    let outer: AbortSignal | undefined;
    let atInner: ReturnType<typeof raw> | undefined;
    let insideInner: ReturnType<typeof raw> | undefined;

    await interruptibleWait(async (signal) => {
      outer = signal;
      atInner = raw();

      return interruptibleWait(async (nested) => {
        inner = nested;
        insideInner = raw();
        expect(isWaiting()).toBe(true);
      });
    });

    expect(inner).toBe(outer);
    expect(insideInner).toEqual(atInner);
    expect(raw()).toEqual(before);
    expect(isWaiting()).toBe(false);
  });
});

describe('una espera adentro de una emisión', () => {
  it('es parte de ella: usa su señal de consultas, no le saca los listeners y la emisión sigue atajando', async () => {
    let queries: AbortSignal | undefined;
    let nested: AbortSignal | undefined;
    let duringWait: ReturnType<typeof raw> | undefined;
    let beforeWait: ReturnType<typeof raw> | undefined;

    await guardEmission({ json: false, onCut: vi.fn() }, async ({ onSending }, signal) => {
      queries = signal;
      beforeWait = raw();
      await interruptibleWait(async (inner) => {
        nested = inner;
        duringWait = raw();
      });
      onSending?.(SENT);
      // Si la espera la hubiera apagado, esta llegaria a `other`.
      send('SIGINT');

      return { results: ['CAE'] };
    });

    expect(nested).toBe(queries);
    expect(duringWait).toEqual(beforeWait);
    expect(other).not.toHaveBeenCalled();
    expect(stderr).toContain('Esperamos a que ARCA conteste');
    await finishCut();
    await vi.waitFor(() => expect(raw()).toEqual(before), { interval: 10, timeout: REPEATED_SIGNAL_MS * 3 });
  });
});

describe('SIGTERM en el asistente', () => {
  it('sin nada enviado no vuelve al menú: se reenvía como en los comandos', async () => {
    const error = await guardEmission({ cancelBeforeSending: true, json: false, onCut: vi.fn() }, async () => {
      send('SIGTERM');

      return { results: [] };
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ResentSignalError);
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(process.pid, 'SIGTERM');
  });

  it('con algo enviado, espera y entrega, y finishCut termina el proceso', async () => {
    const deliver = vi.fn();

    await guardEmission(
      { cancelBeforeSending: true, json: false, onCut: vi.fn() },
      async ({ onSending }) => {
        onSending?.(SENT);
        send('SIGTERM');

        return { results: ['CAE'] };
      },
      deliver,
    );

    expect(deliver).toHaveBeenCalledOnce();
    expect(process.kill).not.toHaveBeenCalled();
    expect(await finishCut()).toBe('SIGTERM');
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(process.pid, 'SIGTERM');
    expect(raw()).toEqual(before);
  });

  it('con una sola Ctrl+C, finishCut no corta', async () => {
    await guardEmission(
      { cancelBeforeSending: true, json: false, onCut: vi.fn() },
      async ({ onSending }) => {
        onSending?.(SENT);
        send('SIGINT');

        return { results: ['CAE'] };
      },
      vi.fn(),
    );

    expect(await finishCut()).toBeUndefined();
    expect(process.kill).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(raw()).toEqual(before), { interval: 10, timeout: REPEATED_SIGNAL_MS * 3 });
  });
});

describe('cancelBeforeSending (el asistente)', () => {
  it('sin nada enviado, la primera corta las consultas, no envía nada y rechaza como Ctrl+C, sin reenviarla', async () => {
    const onCut = vi.fn();
    let queries: AbortSignal | undefined;
    let shouldStop: boolean | undefined;

    const error = await guardEmission(
      { cancelBeforeSending: true, json: false, onCut },
      async (interruption, signal) => {
        queries = signal;
        send('SIGINT');
        // El eco.
        process.emit('SIGINT', 'SIGINT');
        await interruption.abandoned;
        shouldStop = interruption.shouldStop?.();

        return { error: new Error('se cortó antes de enviarlo'), results: [] };
      },
      vi.fn(),
    ).catch((thrown: unknown) => thrown);

    expect(isPromptCancellation(error)).toBe(true);
    expect(queries?.reason).toBeInstanceOf(QueryCancelledError);
    expect(shouldStop).toBe(true);
    expect(onCut).toHaveBeenCalledOnce();
    expect(process.kill).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    expect(stderr).toBe('');
    await vi.waitFor(() => expect(raw()).toEqual(before), { interval: 10, timeout: REPEATED_SIGNAL_MS * 3 });
  });

  it('si la consulta cortada llega como error, igual rechaza como Ctrl+C', async () => {
    const error = await guardEmission(
      { cancelBeforeSending: true, json: false, onCut: vi.fn() },
      async (_interruption, signal) => {
        send('SIGINT');

        throw signal.reason;
      },
    ).catch((thrown: unknown) => thrown);

    expect(isPromptCancellation(error)).toBe(true);
    await vi.waitFor(() => expect(raw()).toEqual(before), { interval: 10, timeout: REPEATED_SIGNAL_MS * 3 });
  });

  it('con algo enviado, el spinner se frena antes del aviso de que se espera', async () => {
    const order: string[] = [];

    vi.mocked(process.stderr.write).mockImplementation(() => {
      order.push('aviso');

      return true;
    });

    await guardEmission(
      { beforeNotice: () => order.push('spinner'), cancelBeforeSending: true, json: false, onCut: vi.fn() },
      async ({ onSending }) => {
        onSending?.(SENT);
        send('SIGINT');

        return { results: ['CAE'] };
      },
    );

    expect(order[0]).toBe('spinner');
    expect(order).toContain('aviso');
  });
});
