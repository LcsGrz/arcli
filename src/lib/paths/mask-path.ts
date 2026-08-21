import { basename, dirname } from 'node:path';

export function maskPath(filePath: string): string {
  const normalizedPath = filePath.trim();

  if (!normalizedPath) {
    return filePath;
  }

  const fileName = basename(normalizedPath);
  const parentDirectory = basename(dirname(normalizedPath));

  if (!fileName) {
    return normalizedPath;
  }

  if (!parentDirectory || parentDirectory === '.' || parentDirectory === fileName) {
    return `.../${fileName}`;
  }

  return `.../${parentDirectory}/${fileName}`;
}
