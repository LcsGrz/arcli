import { existsSync, readFileSync } from 'node:fs';

import { withFilePath } from '../../lib/files/file-error';
import type { LocalFiles } from '../../lib/files/local-files';

/** Lee en UTF-8; si falla sin decir con qué archivo (una carpeta, sin disco), el error lleva la ruta. */
export function readTextFile(path: string): string {
  return withFilePath(path, () => readFileSync(path, 'utf8'));
}

/** Los archivos del disco, para el núcleo. */
export const nodeLocalFiles: LocalFiles = { exists: existsSync, readText: readTextFile };
