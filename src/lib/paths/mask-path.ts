import { basename, dirname } from 'node:path';

/**
 * La ruta sin la carpeta del usuario, para que no quede en capturas ni logs: `.../<carpeta>/<archivo>`. Con `depth`
 * se muestran mas tramos, por ejemplo `.../arcli/certificados/<CUIT>` con 3.
 */
export function maskPath(filePath: string, depth = 2): string {
  const normalizedPath = filePath.trim();

  if (!normalizedPath) {
    return filePath;
  }

  const segments: string[] = [];
  let current = normalizedPath;

  while (segments.length < depth) {
    const segment = basename(current);
    const parent = dirname(current);

    if (!segment || segment === '.' || parent === current) {
      break;
    }

    segments.unshift(segment);
    current = parent;
  }

  return segments.length === 0 ? normalizedPath : `.../${segments.join('/')}`;
}
