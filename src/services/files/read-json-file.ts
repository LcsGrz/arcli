import { existsSync } from 'node:fs';

import { InputValidationError } from '../../lib/errors/app-error';
import { describeJsonError } from '../../lib/files/json-error';
import { shortenPath } from '../../lib/paths/mask-path';

import { readTextFile } from './local-files';

export function readJsonFile<T>(filePath: string): T {
  if (!existsSync(filePath)) {
    throw new InputValidationError(`La ruta del archivo JSON no existe: ${filePath}`, {
      path: filePath,
    });
  }

  const rawContent = readTextFile(filePath);

  try {
    return JSON.parse(rawContent) as T;
  } catch (error) {
    const cause = describeJsonError(error, rawContent);

    throw new InputValidationError(`No se pudo leer el archivo JSON ${shortenPath(filePath)}: ${cause}.`, {
      cause,
      path: filePath,
    });
  }
}
