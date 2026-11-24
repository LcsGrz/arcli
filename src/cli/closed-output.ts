import type { EventEmitter } from 'node:events';
import { setImmediate, setTimeout } from 'node:timers/promises';

export type OutputName = 'stderr' | 'stdout';

/** El primer error de cada salida que no se pudo escribir. */
export type OutputFailures = ReadonlyMap<OutputName, NodeJS.ErrnoException>;

export interface OutputState {
  /** Las que cerro quien las leia (`EPIPE`). */
  readonly closed: Map<OutputName, NodeJS.ErrnoException>;
  readonly failures: Map<OutputName, NodeJS.ErrnoException>;
}

/** El estado de las salidas del proceso. */
export const outputState: OutputState = { closed: new Map(), failures: new Map() };

/**
 * Un error al escribir una salida, sin nadie que escuche `error`, corta el proceso con el stack de Node. Aca el comando
 * sigue como si la salida estuviera sana, sin `process.exit`: cortar podria dejar un comprobante autorizado sin PDF o
 * un lote a medias.
 *
 * - `EPIPE`: quien lee la corto (`arcli ayuda | head`) y no hay nada que avisar.
 * - Cualquier otro (disco lleno): queda anotado y, al terminar, lo dice `reportOutputFailure`.
 */
export function watchOutputs(
  streams: Readonly<Record<OutputName, EventEmitter>> = { stderr: process.stderr, stdout: process.stdout },
  state: OutputState = outputState,
): OutputFailures {
  for (const output of ['stderr', 'stdout'] as const) {
    streams[output].on('error', (error: NodeJS.ErrnoException) => {
      const errors = error.code === 'EPIPE' ? state.closed : state.failures;

      if (!errors.has(output)) {
        errors.set(output, error);
      }
    });
  }

  return state.failures;
}

/** Cerrada o sin poder escribirse: lo que se escriba ahi no lo ve nadie. */
export function isOutputLost(output: OutputName, state: OutputState = outputState): boolean {
  return state.failures.has(output) || state.closed.has(output);
}

const SETTLE_STEP_MS = 10;
/** Un lector que no lee (`| less`) no puede demorar un error como `EMISSION_UNCERTAIN`. */
const SETTLE_TIMEOUT_MS = 1_000;

/**
 * Espera a que terminen las escrituras pendientes de una salida, para saber si fallaron, hasta un tope. El error de la
 * ultima llega en el turno siguiente.
 */
export async function settleOutput(
  output: OutputName,
  stream: Pick<NodeJS.WriteStream, 'writableLength'> = process[output],
  state: OutputState = outputState,
): Promise<void> {
  const deadline = performance.now() + SETTLE_TIMEOUT_MS;

  while (stream.writableLength > 0 && !isOutputLost(output, state) && performance.now() < deadline) {
    await setTimeout(SETTLE_STEP_MS);
  }

  await setImmediate();
}

/** Que no se pudo escribir y por que, para quien usa el CLI. */
export function describeOutputFailure(output: OutputName, error: NodeJS.ErrnoException): string {
  const reason = error.code === 'ENOSPC' ? 'no queda espacio en el disco' : (error.code ?? error.message);

  return output === 'stdout'
    ? `No se pudo escribir toda la salida: ${reason}.`
    : `No se pudieron escribir todos los avisos y errores: ${reason}.`;
}
