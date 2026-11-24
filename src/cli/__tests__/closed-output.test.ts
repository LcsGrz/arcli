import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import { describeOutputFailure, isOutputLost, settleOutput, watchOutputs } from '../closed-output';

function streamError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`write ${code}`), { code });
}

function watch() {
  const streams = { stderr: new EventEmitter(), stdout: new EventEmitter() };

  const state = { closed: new Map(), failures: new Map() };

  return { failures: watchOutputs(streams, state), state, ...streams };
}

/** Que el proceso real lo registre en stdout y stderr lo prueba `e2e/closed-output.e2e.ts`. */
describe('watchOutputs', () => {
  it('EPIPE no corta ni queda anotado, las veces que se repita y en cada salida', () => {
    const { failures, stderr, stdout } = watch();

    for (const stream of [stdout, stderr, stdout, stderr]) {
      expect(() => stream.emit('error', streamError('EPIPE'))).not.toThrow();
    }

    expect(failures.size).toBe(0);
  });

  it.each(['ENOSPC', 'EIO', 'ECONNRESET', 'EOF'])('%s no corta y queda anotado', (code) => {
    const { failures, stdout } = watch();
    const error = streamError(code);

    expect(() => stdout.emit('error', error)).not.toThrow();
    expect([...failures]).toEqual([['stdout', error]]);
  });

  it('un error sin código queda anotado', () => {
    const { failures, stderr } = watch();

    stderr.emit('error', new Error('otro'));

    expect([...failures.keys()]).toEqual(['stderr']);
  });

  it('se anota el primero de cada salida: los repetidos no acumulan', () => {
    const { failures, stderr, stdout } = watch();
    const first = streamError('ENOSPC');

    stdout.emit('error', first);
    stdout.emit('error', streamError('EIO'));
    stderr.emit('error', streamError('EIO'));

    expect(failures.size).toBe(2);
    expect(failures.get('stdout')).toBe(first);
  });

  it('un EPIPE después de otro error no lo borra', () => {
    const { failures, stdout } = watch();
    const first = streamError('ENOSPC');

    stdout.emit('error', first);
    stdout.emit('error', streamError('EPIPE'));

    expect(failures.get('stdout')).toBe(first);
  });
});

describe('describeOutputFailure', () => {
  it.each([
    ['stdout', streamError('ENOSPC'), 'No se pudo escribir toda la salida: no queda espacio en el disco.'],
    ['stdout', streamError('EIO'), 'No se pudo escribir toda la salida: EIO.'],
    ['stderr', streamError('EIO'), 'No se pudieron escribir todos los avisos y errores: EIO.'],
    ['stdout', new Error('otro'), 'No se pudo escribir toda la salida: otro.'],
  ] as const)('%s, %o', (output, error, expected) => {
    expect(describeOutputFailure(output, error)).toBe(expected);
  });
});

describe('isOutputLost', () => {
  it.each([
    ['EPIPE', true],
    ['ENOSPC', true],
  ])('%s, solo la que falló', (code, lost) => {
    const { state, stdout } = watch();

    stdout.emit('error', streamError(code));

    expect(isOutputLost('stdout', state)).toBe(lost);
    expect(isOutputLost('stderr', state)).toBe(false);
  });
});

describe('settleOutput', () => {
  const state = () => ({ closed: new Map(), failures: new Map() });

  it('espera a que no quede nada pendiente', async () => {
    const stream = { writableLength: 5 };
    let settled = false;
    const waiting = settleOutput('stdout', stream, state()).then(() => (settled = true));

    await new Promise((done) => setTimeout(done, 60));
    expect(settled).toBe(false);

    stream.writableLength = 0;
    await waiting;
    expect(settled).toBe(true);
  });

  it('no espera más si ya falló', async () => {
    const failed = state();

    failed.failures.set('stdout', streamError('ENOSPC'));

    const fast = settleOutput('stdout', { writableLength: 5 }, failed).then(() => 'listo');

    expect(await Promise.race([fast, new Promise((done) => setTimeout(done, 300))])).toBe('listo');
  });

  it('con una escritura que no termina, para en el tope (cerca de un segundo)', async () => {
    const start = process.hrtime.bigint();

    await settleOutput('stdout', { writableLength: 5 }, state());

    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

    expect(elapsed).toBeGreaterThan(500);
    expect(elapsed).toBeLessThan(4000);
  }, 15_000);
});
