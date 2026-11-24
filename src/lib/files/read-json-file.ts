import { existsSync, readFileSync } from 'node:fs';

import { InputValidationError } from '../errors/app-error';
import { shortenPath } from '../paths/mask-path';

import { withFilePath } from './file-error';
import { describeJsonError } from './json-error';

export function readJsonFile<T>(filePath: string): T {
  if (!existsSync(filePath)) {
    throw new InputValidationError(`La ruta del archivo JSON no existe: ${filePath}`, {
      path: filePath,
    });
  }

  const rawContent = withFilePath(filePath, () => readFileSync(filePath, 'utf8'));

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
