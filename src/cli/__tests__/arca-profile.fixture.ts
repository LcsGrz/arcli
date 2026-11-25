import { X509Certificate } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

import {
  createSelfSignedCertificate,
  OPENSSL_WARM_UP_TIMEOUT_MS,
  removeSelfSignedCertificates,
  type SelfSignedCertificate,
} from '../../lib/security/__tests__/self-signed-certificate';
import { reportCliError } from '../error-output';
import { createProgram } from '../program';

/**
 * Lo comun de los tests de caracterizacion del perfil de ARCA (REV-48): una carpeta de config propia por test
 * (`ARCLI_CONFIG_DIR`), certificados autofirmados de prueba, stdout y stderr capturados y el reloj real al terminar.
 */

export const PROFILE_CUIT = '20123456786';

const DAY = 24 * 60 * 60 * 1000;

export interface ArcaProfileFixture {
  /** Carpeta de config del test en curso: `dataDirectory()` la lee de `ARCLI_CONFIG_DIR` en cada resolucion. */
  readonly configDirectory: string;
  /** Vence en ~10 dias: da el aviso "por vencer" con el reloj real. */
  readonly expiring: SelfSignedCertificate;
  /** Otro certificado sano, para distinguir uno de otro (exportacion, produccion). */
  readonly other: SelfSignedCertificate;
  /** Vence en ~1 año: sin aviso. */
  readonly healthy: SelfSignedCertificate;
  readonly stderr: string;
  readonly stdout: string;
  /** Config completa para los dos entornos, con el certificado indicado; `extra` pisa lo que haga falta. */
  configWith(certificate: SelfSignedCertificate, extra?: Record<string, unknown>): Record<string, unknown>;
  /** Mueve el reloj a `days` dias despues del vencimiento del certificado. */
  moveClockAfterExpiry(certificate: SelfSignedCertificate, days: number): void;
  /** Corre el CLI con `--json` e imprime el error como `index.ts`: devuelve el JSON de error de stderr. */
  runJsonError(argv: readonly string[]): Promise<Record<string, unknown>>;
  temporaryDirectory(prefix: string): string;
  /** Escribe el config.json tal cual, como si lo hubiera dejado una version anterior o una edicion a mano. */
  writeConfig(content: Record<string, unknown>): void;
}

/** Registra los hooks del archivo de tests y devuelve el estado del test en curso. */
export function useArcaProfileFixture(): ArcaProfileFixture {
  const originalConfigDirectory = process.env.ARCLI_CONFIG_DIR;
  const temporaryDirectories: string[] = [];
  const state = {
    configDirectory: '',
    expiring: undefined as unknown as SelfSignedCertificate,
    healthy: undefined as unknown as SelfSignedCertificate,
    other: undefined as unknown as SelfSignedCertificate,
    stderr: '',
    stdout: '',
  };

  function temporaryDirectory(prefix: string): string {
    const directory = mkdtempSync(join(tmpdir(), prefix));

    temporaryDirectories.push(directory);

    return directory;
  }

  beforeAll(() => {
    state.expiring = createSelfSignedCertificate(10);
    state.healthy = createSelfSignedCertificate(365);
    state.other = createSelfSignedCertificate(366);
  }, OPENSSL_WARM_UP_TIMEOUT_MS);

  afterAll(removeSelfSignedCertificates);

  beforeEach(() => {
    state.configDirectory = temporaryDirectory('arcli-perfil-');
    process.env.ARCLI_CONFIG_DIR = state.configDirectory;
    state.stdout = '';
    state.stderr = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      state.stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      state.stderr += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env.ARCLI_CONFIG_DIR = originalConfigDirectory;
    process.exitCode = undefined;
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  return {
    get configDirectory() {
      return state.configDirectory;
    },
    get expiring() {
      return state.expiring;
    },
    get healthy() {
      return state.healthy;
    },
    get other() {
      return state.other;
    },
    get stderr() {
      return state.stderr;
    },
    get stdout() {
      return state.stdout;
    },
    configWith: (certificate, extra = {}) => ({
      cert: { produccion: certificate.certPath, testing: certificate.certPath },
      cuit: PROFILE_CUIT,
      key: { produccion: certificate.keyPath, testing: certificate.keyPath },
      ...extra,
    }),
    moveClockAfterExpiry: (certificate, days) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(new X509Certificate(certificate.pem).validTo).getTime() + days * DAY);
    },
    runJsonError: async (argv) => {
      let thrown: unknown;

      try {
        await createProgram().parseAsync(['node', 'arcli', ...argv, '--json']);
      } catch (error) {
        thrown = error;
      }

      if (thrown === undefined) {
        throw new Error(`se esperaba un error con ${argv.join(' ')}`);
      }

      reportCliError(thrown, true);

      return JSON.parse(state.stderr) as Record<string, unknown>;
    },
    temporaryDirectory,
    writeConfig: (content) => {
      writeFileSync(join(state.configDirectory, 'config.json'), JSON.stringify(content, null, 2), 'utf8');
    },
  };
}
