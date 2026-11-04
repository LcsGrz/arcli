import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Una ruta escrita o arrastrada a la terminal: macOS la pega con espacios escapados (`Mis\ archivos/a.crt `), VS Code
 * y Windows entre comillas (`'Mis archivos/a.crt'`), y a mano se escribe con `~`.
 */
export function normalizeDroppedPath(value: string, platform: NodeJS.Platform = process.platform): string {
  let path = value.trim();

  if (/^(['"]).*\1$/.test(path)) {
    path = path.slice(1, -1);
  } else if (platform !== 'win32') {
    // En Windows la barra invertida es el separador: no es un escape.
    path = path.replace(/\\(.)/g, '$1');
  }

  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;
}
