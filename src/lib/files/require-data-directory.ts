import { resolve } from 'node:path';

/**
 * La carpeta de datos la dice quien los abre: sin ella es un error de programacion y falla, nunca una por defecto. `conf`
 * toma la vacia como "elegi vos" y asi se termina escribiendo en la carpeta real.
 */
export function requireDataDirectory(directory: string): string {
  // Los tipos no llegan a un script ni a un `as`: se controla igual.
  if (typeof directory !== 'string' || directory.trim() === '') {
    throw new Error('Falta la carpeta de datos: quien abre la config o un caché tiene que decir cuál es.');
  }

  return directory;
}

/** La ruta de un JSON de la carpeta de datos (`config`, `monotributo`), sin leerlo. Falla sin carpeta. */
export function dataFilePath(directory: string, name: string): string {
  return resolve(requireDataDirectory(directory), `${name}.json`);
}
