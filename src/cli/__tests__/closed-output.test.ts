import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import { ignoreClosedOutput } from '../closed-output';

function streamError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`write ${code}`), { code });
}

/** Que el proceso real lo registre en stdout y stderr lo prueba `e2e/closed-output.e2e.ts`. */
describe('ignoreClosedOutput', () => {
  it('EPIPE no corta, las veces que se repita y en cada salida', () => {
    const streams = [new EventEmitter(), new EventEmitter()];

    ignoreClosedOutput(streams);

    for (const stream of [...streams, ...streams]) {
      expect(() => stream.emit('error', streamError('EPIPE'))).not.toThrow();
    }
  });

  it.each(['ENOSPC', 'EIO', 'ECONNRESET', 'EOF'])('%s no se oculta: sale el mismo error', (code) => {
    const stream = new EventEmitter();
    const error = streamError(code);

    ignoreClosedOutput([stream]);

    expect(() => stream.emit('error', error)).toThrow(error);
  });

  it('un error sin código no se oculta', () => {
    const stream = new EventEmitter();

    ignoreClosedOutput([stream]);

    expect(() => stream.emit('error', new Error('otro'))).toThrow('otro');
  });
});
