import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryDirectories: string[] = [];
/** Uno por cantidad de dias: en Windows openssl puede tardar mas de 10 s la primera vez. */
const certificatesByDays = new Map<number, SelfSignedCertificate>();

export interface SelfSignedCertificate {
  readonly certPath: string;
  readonly keyPath: string;
  readonly pem: string;
}

/**
 * Certificado de prueba con openssl que vence en `days` dias desde ahora. Nunca usa certificados reales. Se reusa
 * hasta `removeSelfSignedCertificates`: los tests solo lo leen.
 */
export function createSelfSignedCertificate(days: number): SelfSignedCertificate {
  const cached = certificatesByDays.get(days);

  if (cached) {
    return cached;
  }

  const directory = mkdtempSync(join(tmpdir(), 'arcli-certificate-test-'));

  temporaryDirectories.push(directory);

  const keyPath = join(directory, 'key.pem');
  const certPath = join(directory, 'cert.pem');

  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      String(days),
      '-nodes',
      '-subj',
      '/CN=arcli-test',
    ],
    { stdio: 'ignore' },
  );

  const certificate = { certPath, keyPath, pem: readFileSync(certPath, 'utf8') };

  certificatesByDays.set(days, certificate);

  return certificate;
}

/** Para un `beforeAll` con timeout largo: asi los tests no pagan el primer openssl. */
export const OPENSSL_WARM_UP_TIMEOUT_MS = 60_000;

export function removeSelfSignedCertificates(): void {
  certificatesByDays.clear();

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
}
