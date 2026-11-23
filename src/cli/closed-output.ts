import type { EventEmitter } from 'node:events';

/**
 * Quien lee la salida puede cortarla (`arcli ayuda | head`): escribir despues da `EPIPE` y, sin nadie que escuche
 * `error`, Node corta el proceso con su stack. El comando sigue como si la salida estuviera abierta, sin
 * `process.exit`: cortar podria dejar un comprobante autorizado sin PDF o un lote a medias. Cualquier otro error (por
 * ejemplo, disco lleno) corta como siempre.
 */
export function ignoreClosedOutput(streams: readonly EventEmitter[] = [process.stdout, process.stderr]): void {
  for (const stream of streams) {
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') {
        throw error;
      }
    });
  }
}
