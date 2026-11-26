import { constants } from 'node:os';
import { setTimeout } from 'node:timers/promises';

import { QueryCancelledError } from '../lib/errors/query-cancelled';
import type { EmissionOutcome } from '../modules/billing/billing.batch-run';
import type { EmissionInterruption } from '../modules/billing/emission-interruption';
import { noticePanel, writeTerminalError } from '../ui';

import { settleOutput } from './closed-output';
import { promptCancellation } from './prompt-cancellation';

/**
 * El unico modulo que escucha las señales, y solo mientras se emite y se entrega lo emitido, o mientras el asistente
 * espera a ARCA (ARQ-11). Fuera de ahi Ctrl+C corta como siempre.
 */
const SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/** Con un listener de otro (signal-exit) la señal reenviada tarda un turno: sin nada pendiente el proceso terminaria antes. */
const RESEND_GRACE_MS = 100;

/**
 * Una señal tan cerca de la primera es la misma: con `npx`, la terminal se la manda a todo el grupo y npm se la reenvia
 * a `arcli`. Es menos de lo que se tarda en apretar Ctrl+C otra vez despues de leer el aviso.
 *
 * @internal Exportado para los tests.
 */
export const REPEATED_SIGNAL_MS = 500;

/** Ya se reenvio la señal: el proceso esta por terminar y no se escribe nada. */
export class ResentSignalError extends Error {
  /** El que da una shell a lo que corta esa señal, por si la señal no lo corta. */
  public readonly exitCode: number;

  public constructor(signal: NodeJS.Signals) {
    super(`Cortado por ${signal}.`);
    this.name = 'ResentSignalError';
    this.exitCode = 128 + constants.signals[signal];
  }
}

/** Se dejo de esperar a ARCA: falta escribir lo que se sabe y cortar. Mientras tanto se siguen atajando las señales. */
let cut: { readonly signal: NodeJS.Signals; readonly stopListening: () => void } | undefined;

/** Llego una señal, o falta el error: se siguen atajando hasta que se escriba todo. */
let unfinished: { readonly abandonedPdf: () => boolean; readonly finish: (exit?: () => void) => void } | undefined;

/**
 * La señal de las consultas de la emision en curso (`guardEmission`), mientras emite y entrega: una espera adentro es
 * parte de ella y no toca sus listeners.
 */
let emitting: AbortSignal | undefined;

/** Deja de escuchar lo de una emision anterior del mismo proceso: cada una se atiende sola. */
let stopPrevious: () => void = () => undefined;

/** Hay que terminar ya: lo que se sabe se escribe, y nada mas. */
export function isCutting(): boolean {
  return cut !== undefined;
}

/**
 * Deja un solo listener de cada señal y devuelve como volver a los de antes. Los de otros se apartan porque el de
 * `when-exit` (lo trae `conf`) reenvia la señal apenas llega: seria una segunda que nadie mando. Nunca queda la señal
 * sin nadie que la ataje en el medio. Se guardan los originales (`rawListeners`) para no perder los `once`.
 *
 * Los que se agregan despues tambien se apartan: el de Puppeteer, con SIGINT, sale del proceso antes de que se escriba
 * nada. Se reponen solo si `keepsAdded`: si su dueño ya termino (un `off` de un apartado no hace nada), taparian la señal.
 * Sin `stealsAdded`, ya no se apartan: solo queda atajar el eco, y lo que se agrega es de la pregunta que sigue (el de
 * signal-exit de @inquirer), que no corta mientras haya otro listener.
 */
function takeOverSignals(
  listener: NodeJS.SignalsListener,
  {
    keepsAdded,
    signals = SIGNALS,
    stealsAdded = () => true,
  }: {
    readonly keepsAdded: () => boolean;
    readonly signals?: ReadonlyArray<NodeJS.Signals>;
    readonly stealsAdded?: () => boolean;
  },
): () => void {
  const others = signals.map((signal) => ({
    added: new Set<NodeJS.SignalsListener>(),
    listeners: process.rawListeners(signal) as NodeJS.SignalsListener[],
    signal,
  }));
  let isActive = true;

  const onNewListener = (event: string | symbol): void => {
    const other = others.find(({ signal }) => signal === event);

    if (!other) {
      return;
    }

    // Todavia no se agrego. Ninguna señal llega antes que un microtask.
    queueMicrotask(() => {
      if (!isActive || !stealsAdded()) {
        return;
      }

      for (const added of process.rawListeners(other.signal) as NodeJS.SignalsListener[]) {
        if (added !== listener) {
          other.added.add(added);
          process.off(other.signal, added);
        }
      }
    });
  };

  for (const { listeners, signal } of others) {
    process.on(signal, listener);
    listeners.forEach((other) => process.off(signal, other));
  }

  process.on('newListener', onNewListener);

  return () => {
    if (!isActive) {
      return;
    }

    isActive = false;
    process.off('newListener', onNewListener);

    for (const { added, listeners, signal } of others) {
      [...listeners, ...(keepsAdded() ? added : [])].forEach((other) => process.on(signal, other));
      process.off(signal, listener);
    }
  };
}

export interface GuardedEmissionOptions {
  /** Antes del aviso de que se espera la respuesta: el spinner, para que el aviso no quede debajo de el. */
  readonly beforeNotice?: () => void;
  /**
   * Sin nada enviado, la primera Ctrl+C no corta el proceso: deja de esperar las consultas (se cortan con la señal que
   * recibe `emit`), no envia nada y `guardEmission` rechaza como un Ctrl+C en una pregunta. Es la del asistente, que
   * vuelve al menu. SIGTERM corta como en los comandos y, con algo enviado, `finishCut` termina el proceso despues de
   * entregarlo.
   */
  readonly cancelBeforeSending?: boolean;
  /** Con `--json` no hay aviso intermedio. */
  readonly json: boolean;
  /** Antes de cortar por la señal: el spinner, para devolver el cursor. */
  readonly onCut: () => void;
}

function waitingNotice(signal: NodeJS.Signals): string {
  return [
    'Esperamos a que ARCA conteste, para no dejar la emisión sin confirmar.',
    ...(signal === 'SIGINT' ? ['Con otro Ctrl+C salís sin esperar la respuesta.'] : []),
  ].join(' ');
}

/** Lo que necesita quien entrega lo emitido para no perderlo por una señal. */
export interface DeliveryInterruption {
  /** Se aborta con la primera señal: lo que falte del PDF no se espera. */
  readonly signal: AbortSignal;
  /** En una pregunta Ctrl+C es de la pregunta y cualquier otra señal corta como siempre. `undefined` si ya se corto. */
  readonly whileAsking: <T>(ask: () => Promise<T>) => Promise<T | undefined>;
}

/**
 * Corre `emit` atajando las señales. Sin nada enviado, la primera corta como siempre (o, con `cancelBeforeSending`,
 * corta las consultas y no envia nada). Con algo enviado, la primera espera la respuesta en curso y frena lo que sigue;
 * la segunda deja de esperar y, si algo quedo por decir, corta despues de que se escriba (`finishCut`). Nunca llega a la
 * llamada que emite: `queries`, la señal de las consultas, solo se aborta sin nada enviado.
 *
 * Con algo enviado, `deliver` tambien corre atajandolas: la primera aborta el PDF y la segunda corta, pero recien con
 * el resultado escrito.
 */
export async function guardEmission<R>(
  options: GuardedEmissionOptions,
  emit: (interruption: EmissionInterruption, queries: AbortSignal) => Promise<EmissionOutcome<R>>,
  deliver?: (outcome: EmissionOutcome<R>, delivery: DeliveryInterruption) => Promise<void>,
): Promise<EmissionOutcome<R>> {
  let first: NodeJS.Signals | undefined;
  /** Cuando llego la ultima que conto: hasta `REPEATED_SIGNAL_MS` despues, otra es la misma. */
  let countedAt = -Infinity;
  let resent: NodeJS.Signals | undefined;
  let hasSent = false;
  let isDelivering = false;
  let isWritten = false;
  let exitAfterPdf: (() => void) | undefined;
  let abandon: (() => void) | undefined;
  const abandoned = new Promise<void>((resolve) => {
    abandon = resolve;
  });
  const pdf = new AbortController();
  const queries = new AbortController();
  /** Se dejo sin enviar nada (`cancelBeforeSending`): se sigue atajando el eco mientras ya se pregunta otra cosa. */
  let isCancelled = false;

  const keepsAdded = (): boolean => pdf.signal.aborted;
  // Con todo escrito, o vuelto al menu, solo se ataja el eco: lo que se agrega es de la pregunta que sigue.
  const stealsAdded = (): boolean => !isWritten && !isCancelled;
  stopPrevious();

  let restore = takeOverSignals(onSignal, { keepsAdded, stealsAdded });
  const stopListening = (): void => restore();

  stopPrevious = stopListening;
  emitting = queries.signal;

  function onSignal(signal: NodeJS.Signals): void {
    const now = performance.now();

    // Solo Ctrl+C vuelve al menu: SIGTERM corta como en los comandos.
    if (!hasSent && options.cancelBeforeSending && signal === 'SIGINT') {
      if (first === undefined) {
        first = signal;
        countedAt = now;
        options.onCut();
        queries.abort(new QueryCancelledError());
        abandon?.();
      }

      return;
    }

    if (!hasSent) {
      first ??= signal;
      resent = signal;
      options.onCut();
      // Primero los listeners: signal-exit (el cursor, @inquirer) solo corta si el propio no esta.
      stopListening();
      process.kill(process.pid, signal);

      return;
    }

    if (cut || now - countedAt < REPEATED_SIGNAL_MS) {
      return;
    }

    const isFirst = first === undefined;

    first ??= signal;
    countedAt = now;

    if (isWritten) {
      stopListening();
      void resend(signal, pdf.signal.aborted ? exitAfterPdf : undefined);
    } else if (isDelivering ? pdf.signal.aborted : !isFirst) {
      cut = { signal, stopListening };
      abandon?.();
    } else if (isDelivering) {
      pdf.abort();
    } else if (!options.json) {
      try {
        options.beforeNotice?.();
        writeTerminalError(() => noticePanel(waitingNotice(signal), 'warning'));
      } catch {
        // Un error aca cortaria el proceso con algo enviado: sin aviso, igual se espera.
      }
    }
  }

  async function whileAsking<T>(ask: () => Promise<T>): Promise<T | undefined> {
    const echoMs = countedAt + REPEATED_SIGNAL_MS - performance.now();

    if (echoMs > 0) {
      await setTimeout(echoMs);
    }

    if (pdf.signal.aborted) {
      return undefined;
    }

    stopListening();

    try {
      return await ask();
    } finally {
      restore = takeOverSignals(onSignal, { keepsAdded, stealsAdded });
    }
  }

  let hasFailed = true;
  let hasOutcome = false;

  const isCancelledBeforeSending = (): boolean =>
    Boolean(options.cancelBeforeSending) && first !== undefined && !hasSent;

  try {
    let outcome: EmissionOutcome<R>;

    try {
      outcome = await emit(
        {
          abandoned,
          onSending: () => {
            hasSent = true;
          },
          shouldStop: () => first !== undefined,
          stopMessage: () => (first === 'SIGINT' ? 'Cortaste el lote con Ctrl+C.' : 'Se cortó el lote.'),
        },
        queries.signal,
      );
    } catch (error) {
      // Una consulta cortada puede llegar como error y no como resultado: igual no se envio nada.
      if (!isCancelledBeforeSending()) {
        throw error;
      }

      outcome = { error, results: [] };
    }

    if (resent) {
      await setTimeout(RESEND_GRACE_MS);

      throw new ResentSignalError(resent);
    }

    if (isCancelledBeforeSending()) {
      isCancelled = true;

      const echoMs = countedAt + REPEATED_SIGNAL_MS - performance.now();

      globalThis.setTimeout(stopListening, Math.max(echoMs, 0)).unref();

      throw promptCancellation();
    }

    if (!('error' in outcome)) {
      cut = undefined;
    }

    hasOutcome = true;

    if (!hasSent) {
      // Nada que perder: ya no se ataja nada.
      stopListening();
    }

    isDelivering = true;
    await deliver?.(outcome, { signal: pdf.signal, whileAsking });
    hasFailed = 'error' in outcome;

    return outcome;
  } finally {
    if (emitting === queries.signal) {
      emitting = undefined;
    }

    if (!hasOutcome) {
      cut = undefined;
    }

    if (deliver && hasSent && hasOutcome && (first || hasFailed)) {
      unfinished = {
        abandonedPdf: () => pdf.signal.aborted,
        finish: (exit) => {
          exitAfterPdf = exit;

          const echoMs = countedAt + REPEATED_SIGNAL_MS - performance.now();

          isWritten = true;

          // El eco de npx puede llegar con todo escrito: tampoco corta.
          if (echoMs > 0) {
            globalThis.setTimeout(stopListening, echoMs).unref();
          } else {
            stopListening();
          }
        },
      };
    } else if (!cut && !isCancelled) {
      stopListening();
    }

    // En el asistente, otra señal que Ctrl+C termina el proceso igual, recien con lo emitido escrito (`finishCut`).
    if (options.cancelBeforeSending && hasSent && hasOutcome && first !== undefined && first !== 'SIGINT') {
      cut ??= { signal: first, stopListening };
    }
  }
}

/**
 * La señal, ya sin los listeners propios. Con un PDF abandonado, el listener del plugin, ya repuesto, puede quedarse
 * con ella sin terminar el proceso: ahi se sale con `exit`.
 */
async function resend(signal: NodeJS.Signals, exit?: () => void): Promise<void> {
  if (exit) {
    process.exitCode = 128 + constants.signals[signal];
  }

  process.kill(process.pid, signal);
  await setTimeout(RESEND_GRACE_MS);
  exit?.();
}

/** Lo que se le da al plugin abandonado para terminar solo antes de salir igual. */
const ABANDONED_PDF_MS = 200;

/**
 * Con todo escrito, corta por la segunda señal, como si nunca se hubiera atajado. Con una sola, el proceso termina solo;
 * si se abandono un PDF, con `exit`, para que el plugin cierre su navegador. Sin señales ni error no hace nada.
 * Devuelve la señal que reenvio, si corto: el proceso esta por terminar y no se escribe nada mas.
 */
export async function finishCut(
  beforeCut?: () => Promise<void> | void,
  exit?: () => void,
): Promise<NodeJS.Signals | undefined> {
  if (!cut && !unfinished) {
    return undefined;
  }

  await settleOutput('stdout');
  await settleOutput('stderr');

  const abandonedPdf = unfinished?.abandonedPdf() ?? false;

  // Puede haber llegado mientras se escribia.
  if (!cut) {
    unfinished?.finish(exit);
    unfinished = undefined;

    if (abandonedPdf && exit) {
      globalThis.setTimeout(exit, ABANDONED_PDF_MS).unref();
    }

    return undefined;
  }

  const { signal, stopListening } = cut;

  await beforeCut?.();
  await settleOutput('stdout');
  await settleOutput('stderr');

  cut = undefined;
  unfinished = undefined;
  stopListening();
  await resend(signal, abandonedPdf ? exit : undefined);

  return signal;
}

/** La espera en curso de `interruptibleWait`: una adentro de otra es la misma. */
let waiting: AbortSignal | undefined;

/** Hay una espera de `interruptibleWait` en curso: otra adentro es la misma, sin un spinner mas. */
export function isWaiting(): boolean {
  return waiting !== undefined || emitting !== undefined;
}

/**
 * Corre `run`, una espera a ARCA del asistente, atajando Ctrl+C (solo SIGINT: SIGTERM corta como siempre). Con la
 * señal, aborta `signal` y rechaza enseguida como un Ctrl+C en una pregunta (`promptCancellation`), sin esperar a
 * `run`: lo que devuelva despues se descarta. Despues de cortar sigue atajando SIGINT `REPEATED_SIGNAL_MS`, por el eco de
 * `npx`, sin apartar los listeners que agregue en ese medio segundo una pregunta abierta (la del menu). Adentro de otra
 * espera o de una emision (`guardEmission`) es parte de ella.
 */
export async function interruptibleWait<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  // Adentro de otra espera, o de una emision, es parte de ella: la señal es la suya y sus listeners no se tocan.
  const outer = waiting ?? emitting;

  if (outer) {
    return run(outer);
  }

  const controller = new AbortController();
  let isCut = false;
  let rejectCut: (error: Error) => void = () => undefined;
  const cutShort = new Promise<never>((_resolve, reject) => {
    rejectCut = reject;
  });

  stopPrevious();

  const stopListening = takeOverSignals(onSignal, {
    keepsAdded: () => false,
    signals: ['SIGINT'],
    stealsAdded: () => !isCut,
  });

  stopPrevious = stopListening;
  waiting = controller.signal;

  function onSignal(): void {
    if (isCut) {
      return;
    }

    isCut = true;
    // Primero el rechazo: `run` puede rechazar con la razon de la señal, y lo que se ve es que se cancelo.
    rejectCut(promptCancellation());
    controller.abort(new QueryCancelledError());
    globalThis.setTimeout(stopListening, REPEATED_SIGNAL_MS).unref();
  }

  try {
    return await Promise.race([run(controller.signal), cutShort]);
  } finally {
    if (waiting === controller.signal) {
      waiting = undefined;
    }

    if (!isCut) {
      stopListening();
    }
  }
}
