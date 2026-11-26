import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';

import type { CertificateFiles, CertificateStore } from '../../modules/certificates/certificate-store';

import { readTextFile } from './local-files';
import { restrictFolderToOwner } from './restrict-to-owner';

function ensureCertificateFolder(files: Pick<CertificateFiles, 'folder'>): void {
  mkdirSync(files.folder, { mode: 0o700, recursive: true });
  restrictFolderToOwner(files.folder);
}

/** `0600` en macOS y Linux. En Windows no aplica: la carpeta del usuario ya es solo suya. */
function writePrivateFile(path: string, content: string): void {
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 });

  if (process.platform !== 'win32') {
    chmodSync(path, 0o600);
  }
}

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readTextFile(path) : undefined;
}

/** Como `readIfExists`, pero sin permiso (en el archivo o su carpeta) falla: no es lo mismo que si no existiera. */
function readUnlessMissing(path: string): string | undefined {
  try {
    return readTextFile(path);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;

    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return undefined;
    }

    throw error;
  }
}

/** Mueve `from` a `to` pisando `to`; si `from` no existe, no hace nada. */
function moveIfExists(from: string, to: string): void {
  if (existsSync(from)) {
    renameSync(from, to);
  }
}

/** Los certificados en el disco, con los permisos de arriba. */
export const nodeCertificateStore: CertificateStore = {
  ensureFolder: ensureCertificateFolder,
  moveIfExists,
  read: readTextFile,
  readIfExists,
  readUnlessMissing,
  write: (path, content) => writeFileSync(path, content, 'utf8'),
  writePrivate: writePrivateFile,
};
