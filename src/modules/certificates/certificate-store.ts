import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { restrictFolderToOwner } from '../../lib/files/restrict-to-owner';
import type { ArcliEnvironment } from '../config/config.schemas';

/**
 * Archivos de un entorno en `<config>/certificados/<CUIT>/`. El pedido nuevo queda como `.nueva` hasta que se
 * importa su certificado: la clave activa no se toca y se sigue facturando con el par anterior.
 */
export interface CertificateFiles {
  readonly certificate: string;
  readonly folder: string;
  readonly key: string;
  readonly pendingKey: string;
  readonly pendingRequest: string;
  readonly previousCertificate: string;
  readonly previousKey: string;
  /** El CSR del certificado activo, por si hay que volver a crearlo en ARCA. */
  readonly request: string;
}

export function resolveCertificatesRoot(configPath: string): string {
  return join(configPath, '..', 'certificados');
}

export function resolveCertificateFiles(
  certificatesRoot: string,
  cuit: string,
  environment: ArcliEnvironment,
): CertificateFiles {
  const folder = join(certificatesRoot, cuit);

  return {
    certificate: join(folder, `${environment}.crt`),
    folder,
    key: join(folder, `${environment}.key`),
    pendingKey: join(folder, `${environment}.nueva.key`),
    pendingRequest: join(folder, `${environment}.nueva.csr`),
    previousCertificate: join(folder, `${environment}.anterior.crt`),
    previousKey: join(folder, `${environment}.anterior.key`),
    request: join(folder, `${environment}.csr`),
  };
}

export function ensureCertificateFolder(files: CertificateFiles): void {
  mkdirSync(files.folder, { mode: 0o700, recursive: true });
  restrictFolderToOwner(files.folder);
}

/** `0600` en macOS y Linux. En Windows no aplica: la carpeta del usuario ya es solo suya. */
export function writePrivateFile(path: string, content: string): void {
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 });

  if (process.platform !== 'win32') {
    chmodSync(path, 0o600);
  }
}

export function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

/** Mueve `from` a `to` pisando `to`; si `from` no existe, no hace nada. */
export function moveIfExists(from: string, to: string): void {
  if (existsSync(from)) {
    renameSync(from, to);
  }
}
