import { join } from 'node:path';

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

/**
 * Los archivos de los certificados, para `CertificateService`. Lo implementa `src/services/files` sobre el disco: los
 * permisos (carpeta `0700`, clave `0600`, fuera de Windows) son del adaptador. Las lecturas tiran el error del sistema
 * con la ruta del archivo.
 */
export interface CertificateStore {
  /** Crea la carpeta del CUIT solo para el dueño, también si ya existía abierta. */
  ensureFolder(files: Pick<CertificateFiles, 'folder'>): void;
  /** El CSR y el certificado: no son secretos. */
  write(path: string, content: string): void;
  /** La clave privada: solo para el dueño desde que nace. */
  writePrivate(path: string, content: string): void;
  read(path: string): string;
  readIfExists(path: string): string | undefined;
  /** Como `readIfExists`, pero sin permiso (en el archivo o su carpeta) falla: no es lo mismo que si no existiera. */
  readUnlessMissing(path: string): string | undefined;
  /** Mueve `from` a `to` pisando `to`; si `from` no existe, no hace nada. */
  moveIfExists(from: string, to: string): void;
}
