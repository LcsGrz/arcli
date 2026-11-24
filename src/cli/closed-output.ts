import type { EventEmitter } from 'node:events';

export type OutputName = 'stderr' | 'stdout';

/** El primer error de cada salida que no se pudo escribir. */
export type OutputFailures = ReadonlyMap<OutputName, NodeJS.ErrnoException>;

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
): OutputFailures {
  const failures = new Map<OutputName, NodeJS.ErrnoException>();

  for (const output of ['stderr', 'stdout'] as const) {
    streams[output].on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE' && !failures.has(output)) {
        failures.set(output, error);
      }
    });
  }

  return failures;
}

/** Que no se pudo escribir y por que, para quien usa el CLI. */
export function describeOutputFailure(output: OutputName, error: NodeJS.ErrnoException): string {
  const reason = error.code === 'ENOSPC' ? 'no queda espacio en el disco' : (error.code ?? error.message);

  return output === 'stdout'
    ? `No se pudo escribir toda la salida: ${reason}.`
    : `No se pudieron escribir todos los avisos y errores: ${reason}.`;
}
