import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

import { type ArcaServer, startArcaServer, trackDeadlines, type TrackedDeadline } from './arca-server';

/** Como termino una llamada. `sigue colgada`: ARCA no contesta y no hay ningun plazo corriendo que la vaya a cortar. */
type Settled =
  | { readonly end: 'contestó'; readonly value: unknown }
  | { readonly end: 'se cortó'; readonly error: unknown }
  | { readonly end: 'sigue colgada' };

const CHECK_MS = 50;
/** Cuanto tiene que estar colgada, sin un plazo corriendo, para darla por colgada. */
const HANG_MS = 3_000;
/** Con un plazo corriendo o sin nada colgado, el tope: menos que el de los tests. */
const MAX_MS = 25_000;

export interface ArcaDeadlines {
  readonly certPath: string;
  /** Ningun plazo vence hasta soltarlos: para lo que tiene que pasar antes. */
  holdDeadlines(): void;
  readonly keyPath: string;
  releaseDeadlines(): void;
  /** Los plazos que se pusieron en el test en curso. */
  readonly deadlines: readonly TrackedDeadline[];
  readonly server: ArcaServer;
  /** Espera una llamada sin que una colgada cuelgue el test. */
  settle(call: Promise<unknown>): Promise<Settled>;
}

/** Registra los hooks de un archivo: un ARCA local por test, los plazos acortados y nada de red. */
export function useArcaDeadlines(): ArcaDeadlines {
  let directory = '';
  let server: ArcaServer;
  let held = false;
  let tracked: ReturnType<typeof trackDeadlines>;
  const calls: Array<Promise<unknown>> = [];
  const { setTimeout: startTimer, clearTimeout: stopTimer } = globalThis;

  /** Solo vencen los pedidos que ARCA no va a contestar: mientras haya otros en curso, se los espera. */
  function canExpire(deadlines: readonly TrackedDeadline[]): boolean {
    const hung = server.requests.filter(({ hangs }) => hangs);
    const expired = deadlines.filter(({ state }) => state === 'vencido').length;
    const pending = deadlines.filter(({ state }) => state === 'pendiente').length;
    // El que vencio sigue abierto un momento del lado del servidor: no cuenta por otro.
    const waiting = Math.min(hung.length - expired, hung.filter(({ dropped }) => !dropped).length);

    return !held && pending <= waiting;
  }

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'arcli-plazos-'));
  });

  afterAll(() => {
    rmSync(directory, { force: true, recursive: true });
  });

  beforeEach(async () => {
    server = await startArcaServer({ redirect: true });
    held = false;
    tracked = trackDeadlines(canExpire);
    writeFileSync(join(directory, 'cert.pem'), server.cert);
    writeFileSync(join(directory, 'key.pem'), server.key);
  });

  afterEach(async () => {
    // Lo que quedo colgado termina aca: no puede seguir corriendo en el test siguiente.
    server.respond(() => undefined);
    server.drop();
    await Promise.allSettled(calls.splice(0));
    tracked.restore();
    await server.stop();
    expect(server.blocked, 'algo intentó salir a la red').toEqual([]);
  });

  return {
    get certPath() {
      return join(directory, 'cert.pem');
    },
    get deadlines() {
      return tracked.deadlines;
    },
    holdDeadlines: () => {
      held = true;
    },
    get keyPath() {
      return join(directory, 'key.pem');
    },
    releaseDeadlines: () => {
      held = false;
    },
    get server() {
      return server;
    },
    settle: async (call) => {
      let timer: NodeJS.Timeout | undefined;

      calls.push(call);

      const hung = new Promise<Settled>((resolve) => {
        const start = performance.now();
        let since: number | undefined;

        const check = (): void => {
          const now = performance.now();
          const doomed =
            server.requests.some(({ dropped, hangs }) => hangs && !dropped) &&
            !tracked.deadlines.some(({ state }) => state === 'pendiente');

          since = doomed ? (since ?? now) : undefined;

          if (now - start > MAX_MS || (since !== undefined && now - since > HANG_MS)) {
            resolve({ end: 'sigue colgada' });
          } else {
            timer = startTimer(check, CHECK_MS);
          }
        };

        check();
      });
      const settled = call.then(
        (value): Settled => ({ end: 'contestó', value }),
        (error: unknown): Settled => ({ end: 'se cortó', error }),
      );

      try {
        return await Promise.race([settled, hung]);
      } finally {
        stopTimer(timer);
      }
    },
  };
}
