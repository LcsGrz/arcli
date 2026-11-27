import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  copyFileSync,
  fchmodSync,
  linkSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Los temporales donde se arma una base nueva antes de ponerla en su lugar (ARQ-12): `.nueva-<hex>` en la carpeta de
 * la base, con el nombre del mismo largo que el de la base (`comprobantes.db`, `clientes.db`). Así el límite de
 * Windows que vale para la base (con su `-journal`) vale también para el temporal. La carpeta los ata a su base:
 * `datos/<CUIT>/<entorno>/` es solo de comprobantes.db y `datos/<CUIT>/`, de clientes.db.
 */
const TEMPORARY_PREFIX = '.nueva-';
const TEMPORARY_NAME = /^\.nueva-[0-9a-f]+$/;

/**
 * Un temporal con más de esto sin tocarse es de un proceso que murió creando la base: se borra. Crear una base tarda
 * milisegundos; el margen es para no borrar nunca uno vivo.
 */
const STALE_TEMPORARY_MS = 10 * 60 * 1000;

/** Borra sin fallar: la limpieza nunca hace fallar un guardado ni tapa el error que importa. */
function removeQuietly(path: string): void {
  try {
    rmSync(path, { force: true, maxRetries: 3 });
  } catch {
    // En Windows un antivirus o un indexador puede tener el archivo abierto un rato: queda para la próxima limpieza.
  }
}

/** Borra el temporal y su `-journal`. */
export function removeTemporary(path: string): void {
  removeQuietly(path);
  removeQuietly(`${path}-journal`);
}

/** Los temporales de otra creación que quedaron de un proceso muerto (con más de 10 minutos), con su `-journal`. */
export function removeStaleTemporaries(file: string, nowMs: number): void {
  const folder = dirname(file);
  let names: string[];

  try {
    names = readdirSync(folder);
  } catch {
    return;
  }

  for (const name of names.filter((candidate) => TEMPORARY_NAME.test(candidate))) {
    const path = join(folder, name);

    try {
      if (nowMs - statSync(path).mtimeMs > STALE_TEMPORARY_MS) {
        removeTemporary(path);
      }
    } catch {
      // Lo borró otro proceso mientras se miraba.
    }
  }
}

/** Un archivo nuevo solo para el dueño, con un nombre que no pisa a nadie y del mismo largo que el de la base. */
export function createTemporaryFile(file: string): string {
  const hexLength = Math.max(1, basename(file).length - TEMPORARY_PREFIX.length);

  for (;;) {
    const path = join(
      dirname(file),
      `${TEMPORARY_PREFIX}${randomBytes(Math.ceil(hexLength / 2))
        .toString('hex')
        .slice(0, hexLength)}`,
    );

    try {
      const descriptor = openSync(path, 'wx', 0o600);

      try {
        if (process.platform !== 'win32') {
          fchmodSync(descriptor, 0o600);
        }
      } finally {
        closeSync(descriptor);
      }

      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }
}

/** Los errores de `linkSync` que dicen que el sistema de archivos no tiene hard links (FAT, exFAT, algunos de red). */
const NO_HARD_LINKS = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK', 'EXDEV']);

/**
 * Pone la base armada en su lugar sin pisar otra: un hard link falla si ya está (otro proceso la creó a la vez, y vale
 * esa). Sin hard links, una copia que también falla si ya está; mientras se copia, otro la vería cortada (`damaged`;
 * ver docs/architecture.md, "Datos locales").
 */
export function publishTemporary(temporary: string, file: string): void {
  try {
    linkSync(temporary, file);
  } catch (error) {
    const { code = '' } = error as NodeJS.ErrnoException;

    if (code === 'EEXIST') {
      return;
    }

    if (!NO_HARD_LINKS.has(code)) {
      throw error;
    }

    try {
      copyFileSync(temporary, file, constants.COPYFILE_EXCL);
    } catch (copyError) {
      if ((copyError as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw copyError;
      }
    }
  }
}
