/**
 * El puerto del almacenamiento de la config (ARQ-12 PR 3): el núcleo lee y escribe por acá, y `conf` queda en el
 * adaptador. Sin bloqueo entre procesos: lo suma ARQ-26 detrás del mismo puerto.
 */

import { dataFilePath } from '../../lib/files/require-data-directory';

/** El nombre del archivo de la config en la carpeta de datos, sin `.json`. */
export const CONFIG_FILE_NAME = 'config';

/** La ruta del config.json, sin leerlo: la usan el adaptador y el guardarraíl de los tests. */
export function configFilePath(directory: string): string {
  return dataFilePath(directory, CONFIG_FILE_NAME);
}

/** Lo guardado en el archivo, sin validar. */
export type StoredConfig = Record<string, unknown>;

/** Un JSON de la carpeta de datos (config.json, monotributo.json): el adaptador está en src/services/files. */
export interface ConfigStore {
  readonly path: string;
  /** `{}` si no existe o no es un objeto; JSON inválido: SyntaxError, salvo un caché, que lo toma como vacío. */
  read(): StoredConfig;
  /** Relee, aplica y escribe lo que devuelva (`undefined`: no escribe). Si `change` lanza, no escribe. */
  update(change: (saved: StoredConfig) => StoredConfig | undefined): void;
}
