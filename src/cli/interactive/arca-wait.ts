import { asQuery } from '../../lib/errors/query-error';
import type { EmissionOutcome } from '../../modules/billing/billing.batch-run';
import type { EmissionInterruption } from '../../modules/billing/emission-interruption';
import { withCancellableQueries } from '../../services/arca/query-cancellation';
import { writeTerminalError } from '../../ui';
import { formatCliError } from '../error-output';
import {
  type DeliveryInterruption,
  finishCut,
  guardEmission,
  interruptibleWait,
  ResentSignalError,
} from '../interruption';
import { withPendingSpinner } from '../pending-spinner';
import { isPromptCancellation } from '../prompt-cancellation';
import { startSpinner, withSpinner } from '../spinner';

/**
 * Las esperas a ARCA del asistente (ARQ-11). Es el unico archivo del asistente que importa el spinner (lo controla
 * ESLint): asi ninguna espera queda sin Ctrl+C.
 */

export interface ArcaWaitOptions {
  /** El spinner arranca recien si `run` sigue pendiente: lo que puede no consultar nada no parpadea. */
  readonly pending?: boolean;
  /** Si falla, el error queda marcado como de una consulta y no habla de emitir (`asQuery`). */
  readonly query?: boolean;
}

/**
 * Espera a ARCA con un spinner (sin texto, sin spinner). Ctrl+C la corta enseguida: vuelve al menu como un Ctrl+C en una
 * pregunta y corta las consultas que `run` tenga en curso (`withCancellableQueries`). `run` solo trae datos: no escribe
 * nada, porque lo que haga despues de cortada no se ve. `signal` es para lo que no pasa por el SDK, como un `fetch`.
 */
export function waitForArca<T>(
  text: string | null,
  run: (signal: AbortSignal) => Promise<T>,
  { pending = false, query = false }: ArcaWaitOptions = {},
): Promise<T> {
  const spin = pending ? withPendingSpinner : withSpinner;

  return spin(text, () =>
    interruptibleWait((signal) =>
      withCancellableQueries(signal, () => (query ? asQuery(() => run(signal)) : run(signal))),
    ),
  );
}

/**
 * Emite como los comandos (`guardEmission`), con el spinner: con algo enviado, Ctrl+C espera la respuesta y lo avisa;
 * con dos, deja de esperar y el proceso corta recien con el error escrito (que no se sabe si se emitio). Sin nada
 * enviado, corta las consultas y vuelve al menu como un Ctrl+C en una pregunta. `deliver` escribe el resultado y genera
 * el PDF; un error que lance, como el de la emision, sigue de largo hasta el menu.
 */
export async function emitWaitingForArca<R>(
  text: string,
  emit: (interruption: EmissionInterruption) => Promise<EmissionOutcome<R>>,
  deliver: (outcome: EmissionOutcome<R>, delivery: DeliveryInterruption) => Promise<void>,
): Promise<void> {
  const spinner = startSpinner(text);
  const stop = (): void => {
    spinner?.stop();
  };

  let failure: { readonly error: unknown } | undefined;

  try {
    await guardEmission(
      { beforeNotice: stop, cancelBeforeSending: true, json: false, onCut: stop },
      (interruption, queries) => withCancellableQueries(queries, () => emit(interruption)),
      async (outcome, delivery) => {
        stop();
        await deliver(outcome, delivery);
      },
    );
  } catch (error) {
    failure = { error };
  } finally {
    stop();
  }

  // Con todo escrito: con una sola señal se dejan de atajar, con dos se corta el proceso. Antes de cortar se escribe el
  // error, que ya no llega al menu.
  const resent = await finishCut(() => {
    if (failure && !isPromptCancellation(failure.error)) {
      writeTerminalError(() => formatCliError(failure?.error));
    }
  });

  if (resent) {
    throw new ResentSignalError(resent);
  }

  if (failure) {
    throw failure.error;
  }
}
