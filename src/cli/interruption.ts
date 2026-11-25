import { constants } from 'node:os';
import { setTimeout } from 'node:timers/promises';

import type { EmissionOutcome } from '../modules/billing/billing.batch-run';
import type { EmissionInterruption } from '../modules/billing/emission-interruption';
import { noticePanel, writeTerminalError } from '../ui';

import { settleOutput } from './closed-output';

/**
 * El unico modulo que escucha las señales, y solo mientras se emite y se entrega lo emitido (ARQ-11). Fuera de ahi Ctrl+C corta como siempre.
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
 */
function takeOverSignals(listener: NodeJS.SignalsListener, keepsAdded: () => boolean): () => void {
  const others = SIGNALS.map((signal) => ({
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
      if (!isActive) {
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
 * Corre `emit` atajando las señales. Sin nada enviado, la primera corta como siempre. Con algo enviado, la primera
 * espera la respuesta en curso y frena lo que sigue; la segunda deja de esperar y, si algo quedo por decir, corta
 * despues de que se escriba (`finishCut`). Nunca llega a la llamada que emite.
 *
 * Con algo enviado, `deliver` tambien corre atajandolas: la primera aborta el PDF y la segunda corta, pero recien con
 * el resultado escrito.
 */
export async function guardEmission<R>(
  options: GuardedEmissionOptions,
  emit: (interruption: EmissionInterruption) => Promise<EmissionOutcome<R>>,
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

  const keepsAdded = (): boolean => pdf.signal.aborted;
  stopPrevious();

  let restore = takeOverSignals(onSignal, keepsAdded);
  const stopListening = (): void => restore();

  stopPrevious = stopListening;

  function onSignal(signal: NodeJS.Signals): void {
    const now = performance.now();

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
      restore = takeOverSignals(onSignal, keepsAdded);
    }
  }

  let hasFailed = true;
  let hasOutcome = false;

  try {
    const outcome = await emit({
      abandoned,
      onSending: () => {
        hasSent = true;
      },
      shouldStop: () => first !== undefined,
      stopMessage: () => (first === 'SIGINT' ? 'Cortaste el lote con Ctrl+C.' : 'Se cortó el lote.'),
    });

    if (resent) {
      await setTimeout(RESEND_GRACE_MS);

      throw new ResentSignalError(resent);
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
    } else if (!cut) {
      stopListening();
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
 */
export async function finishCut(beforeCut?: () => void, exit?: () => void): Promise<void> {
  if (!cut && !unfinished) {
    return;
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

    return;
  }

  const { signal, stopListening } = cut;

  beforeCut?.();
  await settleOutput('stdout');
  await settleOutput('stderr');

  cut = undefined;
  unfinished = undefined;
  stopListening();
  await resend(signal, abandonedPdf ? exit : undefined);
}
