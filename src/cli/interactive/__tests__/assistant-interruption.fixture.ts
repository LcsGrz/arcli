import { afterEach, beforeEach, expect, type Mock, vi } from 'vitest';

import { currentQuerySignal } from '../../../services/arca/query-cancellation';
import { stripAnsi } from '../../../ui';
import type { ArcaProfileFixture } from '../../__tests__/arca-profile.fixture';
import { sdk } from '../../__tests__/clock.fixture';
import { REPEATED_SIGNAL_MS } from '../../interruption';
import { runInteractiveMode } from '../interactive-mode';

import { resetSpinners, spinning } from './fake-ora';
import { type OnePathRun, runAssistant, useOnePathFixture } from './one-path.fixture';
import type { Steps } from './one-path.prompts';

/**
 * ARQ-11 PR 5: Ctrl+C en el asistente entero (`runInteractiveMode`), con el SDK falso de `clock.fixture`, las preguntas
 * guionadas de `one-path.prompts` y un `ora` falso que anota que spinner sigue girando. La señal se simula con
 * `process.emit` adentro de la llamada a ARCA, como en `interrupted-emission.test.ts`; `process.kill` no hace nada, asi
 * una señal reenviada no corta al worker.
 *
 * Nada se queda esperando: si nadie deja de esperar, ARCA contesta igual a los `ANSWER_MS`.
 */

const ANSWER_MS = 1000;
export const MENU = /Qué querés hacer/;
export const EXIT: Steps[number] = [MENU, 'Salir'];
/** Las respuestas de "Estado de ARCA" y de la barra. */
export const SERVERS_OK = { appServer: 'OK', authServer: 'OK', dbServer: 'OK' };

/** El aviso de los comandos cuando se espera la respuesta de algo enviado (interruption.ts). */
export const WAITING_NOTICE =
  'Esperamos a que ARCA conteste, para no dejar la emisión sin confirmar. Con otro Ctrl+C salís sin esperar la respuesta.';
/** Nunca de un comprobante que se pudo haber enviado. */
export const DENIED = /no se (emitió|envió)/i;

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** stdout y stderr, en el orden en que se escribieron. */
export function written(): string {
  return [process.stdout, process.stderr]
    .flatMap(({ write }) =>
      vi.mocked(write).mock.calls.map(([chunk], index) => ({
        chunk: String(chunk),
        order: vi.mocked(write).mock.invocationCallOrder[index] ?? 0,
      })),
    )
    .sort((left, right) => left.order - right.order)
    .map(({ chunk }) => chunk)
    .join('');
}

/** Lo que se ve, sin colores, marcos ni saltos de linea. */
export const plain = (text: string): string =>
  stripAnsi(text)
    .replace(/[^\p{L}\p{N}\p{P}$+`<>=| ]/gu, ' ')
    .replace(/\s+/g, ' ');

type Listeners = Record<'SIGINT' | 'SIGTERM', NodeJS.SignalsListener[]>;

/** Los listeners de las dos señales, con los `once` como estan (`rawListeners`). */
export function signalListeners(): Listeners {
  return {
    SIGINT: process.rawListeners('SIGINT') as NodeJS.SignalsListener[],
    SIGTERM: process.rawListeners('SIGTERM') as NodeJS.SignalsListener[],
  };
}

export interface CtrlC {
  /** En cual de las llamadas que cumplen `when` llega la señal. */
  readonly call?: number;
  /**
   * Si la cancelacion de las consultas la corta, como `soap-deadline` con el SDK real: rechaza con la razon de la señal
   * del contexto (`currentQuerySignal`). Por defecto si; no en lo que emite ni en lo que no es de ARCA.
   */
  readonly cancellable?: boolean;
  /**
   * Con que señal se corta, si no es la del contexto: la que recibe la llamada, como `fetchMonotributoPage`, que no pasa
   * por el SDK.
   */
  readonly cancelWith?: (...args: unknown[]) => AbortSignal | undefined;
  /** Cuanto pasa entre una señal y la otra. Por defecto, lo justo para que cuenten por separado. */
  readonly gap?: number;
  /** Al llegar a la llamada, antes de las señales. */
  readonly onReach?: () => void;
  readonly signal?: NodeJS.Signals;
  /** Con 0 no manda ninguna y ARCA contesta enseguida: sirve para ver cuando se llega a la llamada. */
  readonly times?: number;
  /** Las señales se mandan recien cuando se cumple (por ejemplo, con el spinner girando), o a los `ANSWER_MS`. */
  readonly until?: () => boolean;
  /** Que llamadas cuentan, por los argumentos (`genericService.call` atiende varios metodos). */
  readonly when?: (...args: unknown[]) => boolean;
}

export interface PendingAnswer {
  /** ARCA ya contesto (no cuenta si la consulta se corto). */
  readonly answered: () => boolean;
  /** La señal con la que se corta la consulta (la del contexto o `cancelWith`) quedo abortada con las señales. */
  readonly cut: () => boolean;
  /** Se llego a la llamada y se mandaron las señales. */
  readonly reached: () => boolean;
  /** ARCA contesta ya. */
  readonly release: () => void;
  /** Los spinners que giraban apenas despues de las señales. */
  readonly spinningAfterSignals: () => readonly string[];
  /** Lo escrito entre la primera señal y la respuesta de ARCA (o, si no contesto todavia, hasta ahora). */
  readonly whileWaiting: () => string;
}

/**
 * En esa llamada a `mock` manda las señales y recien despues contesta lo de siempre: cuando el test llama a `release`
 * o, si nadie la libera, a los `ANSWER_MS`.
 */
export function ctrlCDuring(
  mock: Mock,
  {
    call = 1,
    cancellable = true,
    cancelWith,
    gap = REPEATED_SIGNAL_MS,
    onReach,
    signal = 'SIGINT',
    times = 1,
    until = () => true,
    when = () => true,
  }: CtrlC = {},
): PendingAnswer {
  const original = mock.getMockImplementation();
  let seen = 0;
  let isReached = false;
  let isAnswered = false;
  let wasCut = false;
  let before = '';
  let after: string | undefined;
  let spinningAfter: readonly string[] = [];
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  async function sendSignals(): Promise<void> {
    const now = Math.floor(performance.now());
    const clock = vi.spyOn(performance, 'now');

    before = written();

    for (let sent = 0; sent < times; sent += 1) {
      clock.mockReturnValue(now + sent * gap);
      process.emit(signal, signal);
      await pause(5);
    }

    clock.mockRestore();
    spinningAfter = spinning();
  }

  mock.mockImplementation(async (...args: unknown[]) => {
    if (when(...args)) {
      seen += 1;

      if (seen === call) {
        isReached = true;
        onReach?.();

        if (times === 0) {
          return original?.(...args);
        }

        const query = cancellable ? (cancelWith ? cancelWith(...args) : currentQuerySignal()) : undefined;
        const cut = new Promise<never>((_resolve, reject) => {
          if (query?.aborted) {
            reject(query.reason);
          }

          query?.addEventListener('abort', () => reject(query.reason), { once: true });
        });

        // Si nadie la corta, no queda como un rechazo sin atender.
        cut.catch(() => undefined);
        await vi.waitFor(() => expect(until()).toBe(true), { interval: 5, timeout: ANSWER_MS }).catch(() => undefined);
        await sendSignals();
        wasCut = query?.aborted === true;

        try {
          await Promise.race([released, pause(ANSWER_MS), cut]);
        } finally {
          after = written();
        }

        isAnswered = true;
      }
    }

    return original?.(...args);
  });

  return {
    answered: () => isAnswered,
    cut: () => wasCut,
    reached: () => isReached,
    release,
    spinningAfterSignals: () => spinningAfter,
    whileWaiting: () => (after ?? written()).slice(before.length),
  };
}

export interface MenuRun extends OnePathRun {
  /** Lo escrito despues de que termino el asistente, cuando ARCA ya contesto tarde. */
  readonly late: string;
  /** En cada vez que se pregunto el menu: lo escrito hasta ahi, los spinners que giraban y si ARCA ya habia contestado. */
  readonly menus: ReadonlyArray<{
    readonly answered: boolean;
    readonly spinning: readonly string[];
    readonly written: string;
  }>;
  /** Todo lo escrito por el asistente. */
  readonly output: string;
}

export interface MenuRunOptions {
  readonly onAsk?: (message: string) => void;
  readonly pending?: PendingAnswer;
  readonly prepare?: () => void;
}

/**
 * El asistente desde el menu con el guion `steps`, que tiene que incluir las preguntas del menu. Al terminar, ARCA
 * contesta lo que tenga pendiente y se anota lo que se escriba despues.
 */
export async function runMenu(steps: Steps, { onAsk, pending, prepare }: MenuRunOptions = {}): Promise<MenuRun> {
  const start = written().length;
  const menus: Array<MenuRun['menus'][number]> = [];
  const run = await runAssistant(() => runInteractiveMode({}), {
    onAsk: (message) => {
      if (MENU.test(message)) {
        menus.push({ answered: pending?.answered() ?? false, spinning: spinning(), written: written().slice(start) });
      }

      onAsk?.(message);
    },
    prepare,
    steps,
  });
  const atEnd = written();

  pending?.release();
  await pause(20);

  return { ...run, late: written().slice(atEnd.length), menus, output: atEnd.slice(start) };
}

/** Lo escrito desde que se volvio a preguntar el menu por `time`.ª vez (1 es la primera). */
export const sinceMenu = (run: MenuRun, time: number): string => run.output.slice(run.menus[time - 1]?.written.length);

/**
 * La fixture de un solo camino, mas lo de este archivo: `process.kill` simulado, sin npm, ancho de terminal conocido
 * para que haya spinners y los listeners de las señales de vuelta como estaban entre un test y otro.
 */
export function useAssistantInterruptionFixture(): ArcaProfileFixture {
  const profile = useOnePathFixture();
  const original = { columns: process.stdout.columns, notifier: process.env.NO_UPDATE_NOTIFIER };
  let listeners = signalListeners();

  beforeEach(() => {
    listeners = signalListeners();
    process.env.NO_UPDATE_NOTIFIER = '1';
    process.stdout.columns = 100;
    resetSpinners();
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    sdk.wsfe.getServerStatus.mockResolvedValue(SERVERS_OK);
    sdk.wsfe.getCurrencyTypes.mockResolvedValue({
      resultGet: { moneda: [{ desc: 'Dólar Estadounidense', fchHasta: 'NULL', id: 'DOL' }] },
    });
    sdk.wsfe.getSalesPoints.mockResolvedValue({ resultGet: { ptoVenta: [] } });
  });

  afterEach(async () => {
    process.stdout.columns = original.columns as number;

    if (original.notifier === undefined) {
      delete process.env.NO_UPDATE_NOTIFIER;
    } else {
      process.env.NO_UPDATE_NOTIFIER = original.notifier;
    }

    // Lo que una espera cortada todavia escucha por el eco. Si no volvieron, se reponen para el test siguiente y este
    // falla: un listener que no vuelve es un error.
    const restored = await vi
      .waitFor(() => expect(signalListeners()).toEqual(listeners), { timeout: REPEATED_SIGNAL_MS + 250 })
      .then(
        () => true,
        () => false,
      );

    if (!restored) {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.removeAllListeners(signal);
        listeners[signal].forEach((listener) => process.on(signal, listener));
      }

      throw new Error('Los listeners de SIGINT y SIGTERM no volvieron a ser los de antes del test.');
    }
  });

  return profile;
}
