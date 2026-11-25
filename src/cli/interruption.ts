import { setTimeout } from 'node:timers/promises';

import type { EmissionOutcome } from '../modules/billing/billing.batch-run';
import type { EmissionInterruption } from '../modules/billing/emission-interruption';
import { noticePanel, writeTerminalError } from '../ui';

import { settleOutput } from './closed-output';

/**
 * El unico modulo que escucha las señales, y solo mientras se emite (ARQ-11). Fuera de ahi Ctrl+C corta como siempre.
 */
const SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/** Con un listener de otro (signal-exit) la señal reenviada tarda un turno: sin nada pendiente el proceso terminaria antes. */
const RESEND_GRACE_MS = 100;

/** Se dejo de esperar a ARCA: falta escribir lo que se sabe y cortar. Mientras tanto se siguen atajando las señales. */
let cut: { readonly signal: NodeJS.Signals; readonly stopListening: () => void } | undefined;

/** Hay que terminar ya: lo que se sabe se escribe, y nada mas. */
export function isCutting(): boolean {
  return cut !== undefined;
}

/**
 * Deja un solo listener de cada señal y devuelve como volver a los de antes. Los de otros se apartan porque el de
 * `when-exit` (lo trae `conf`) reenvia la señal apenas llega: seria una segunda que nadie mando. Nunca queda la señal
 * sin nadie que la ataje en el medio. Se guardan los originales (`rawListeners`) para no perder los `once`.
 */
function takeOverSignals(listener: NodeJS.SignalsListener): () => void {
  const others = SIGNALS.map((signal) => ({
    listeners: process.rawListeners(signal) as NodeJS.SignalsListener[],
    signal,
  }));

  for (const { listeners, signal } of others) {
    process.on(signal, listener);
    listeners.forEach((other) => process.off(signal, other));
  }

  return () => {
    for (const { listeners, signal } of others) {
      if (process.listeners(signal).includes(listener)) {
        listeners.forEach((other) => process.on(signal, other));
        process.off(signal, listener);
      }
    }
  };
}

export interface GuardedEmissionOptions {
  readonly batch: boolean;
  /** Con `--json` no hay aviso intermedio. */
  readonly json: boolean;
  /** Antes de cortar por la señal: el spinner, para devolver el cursor. */
  readonly onCut: () => void;
}

function waitingNotice(signal: NodeJS.Signals, batch: boolean): string {
  return [
    'Esperamos a que ARCA conteste, para no dejar la emisión sin confirmar.',
    ...(batch ? ['Después se corta el lote.'] : []),
    ...(signal === 'SIGINT' ? ['Con otro Ctrl+C salís sin esperar la respuesta.'] : []),
  ].join(' ');
}

/**
 * Corre `emit` atajando las señales. Sin nada enviado, la primera corta como siempre. Con algo enviado, la primera
 * espera la respuesta en curso y frena lo que sigue; la segunda deja de esperar y, si algo quedo por decir, corta
 * despues de que se escriba (`finishCut`). Nunca llega a la llamada que emite.
 */
export async function guardEmission<R>(
  options: GuardedEmissionOptions,
  emit: (interruption: EmissionInterruption) => Promise<EmissionOutcome<R>>,
): Promise<EmissionOutcome<R>> {
  const received: NodeJS.Signals[] = [];
  let hasSent = false;
  let abandon: (() => void) | undefined;
  const abandoned = new Promise<void>((resolve) => {
    abandon = resolve;
  });

  const stopListening = takeOverSignals(onSignal);

  function onSignal(signal: NodeJS.Signals): void {
    received.push(signal);

    if (!hasSent) {
      options.onCut();
      // Primero los listeners: signal-exit (el cursor, @inquirer) solo corta si el propio no esta.
      stopListening();
      process.kill(process.pid, signal);
    } else if (received.length === 1 && !options.json) {
      try {
        writeTerminalError(() => noticePanel(waitingNotice(signal, options.batch), 'warning'));
      } catch {
        // Un error aca cortaria el proceso con algo enviado: sin aviso, igual se espera.
      }
    } else if (received.length === 2) {
      cut = { signal, stopListening };
      abandon?.();
    }
  }

  let failed = false;

  try {
    const outcome = await emit({
      abandoned,
      onSending: () => {
        hasSent = true;
      },
      shouldStop: () => received.length > 0,
      stopMessage: () => (received[0] === 'SIGINT' ? 'Cortaste el lote con Ctrl+C.' : 'Se cortó el lote.'),
    });

    failed = 'error' in outcome;

    return outcome;
  } finally {
    if (!failed) {
      cut = undefined;
    }

    if (!cut) {
      stopListening();
    }
  }
}

/** Con todo escrito, corta por la segunda señal, como si nunca se hubiera atajado. Sin ella no hace nada. */
export async function finishCut(beforeCut?: () => void): Promise<void> {
  if (!cut) {
    return;
  }

  const { signal, stopListening } = cut;

  await settleOutput('stdout');
  await settleOutput('stderr');
  beforeCut?.();
  await settleOutput('stdout');
  await settleOutput('stderr');

  cut = undefined;
  stopListening();
  process.kill(process.pid, signal);
  await setTimeout(RESEND_GRACE_MS);
}
