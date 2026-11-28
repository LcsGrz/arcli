import { chmodSync, existsSync, statSync } from 'node:fs';

/** Permisos solo para el dueno en archivos y carpetas nuevos: tickets de ARCA, config y PDFs. */
export const OWNER_ONLY_UMASK = 0o077;

/** Los permisos del dueno (lectura, escritura y entrada); los de grupo y otros quedan afuera. */
const OWNER_BITS = 0o700;

/**
 * Le saca a una carpeta existente los permisos de grupo y otros y deja los del dueno como estan: 0755 → 0700,
 * 0500 → 0500. Alcanza para proteger lo de adentro (por ejemplo tickets viejos en 0644): sin permiso de la carpeta,
 * nadie mas llega a los archivos. No le devuelve la escritura a una carpeta que la persona dejo de solo lectura: lo
 * que despues se quiera escribir ahi falla con el error de permiso de siempre (ARQ-27). Si no es nuestra o el sistema
 * no lo soporta, sigue.
 */
export function restrictFolderToOwner(path: string): void {
  if (process.platform === 'win32' || !existsSync(path)) {
    return;
  }

  try {
    const mode = statSync(path).mode & 0o777;
    const ownerOnly = mode & OWNER_BITS;

    if (mode !== ownerOnly) {
      chmodSync(path, ownerOnly);
    }
  } catch {
    // Carpeta de otro usuario o sistema de archivos sin permisos POSIX: no es motivo para frenar el comando.
  }
}
