import Conf from 'conf';
import { dirname } from 'node:path';

import { dataFilePath } from '../../lib/files/require-data-directory';
import { CONFIG_FILE_NAME, type ConfigStore, type StoredConfig } from '../../modules/config/config-store';

export interface ConfConfigStoreOptions {
  /** El nombre del archivo, sin `.json`. */
  readonly configName: string;
  /** La carpeta de datos: la dice quien abre el archivo. */
  readonly cwd: string;
  /** Con JSON inválido: `throw` lanza `SyntaxError` y no toca el archivo; `empty` lo toma como vacío (un caché). */
  readonly invalid: 'empty' | 'throw';
}

/**
 * Un archivo JSON de la carpeta de datos detrás del puerto `ConfigStore`, sobre `conf`: escritura atómica, sin BOM,
 * con tabs y solo para el usuario. `conf` se abre en la primera lectura, para que sus errores (JSON inválido, sin
 * permiso) salgan de `read` o `update` y no al armar el store. Sin bloqueo entre procesos (ARQ-26): `update` relee y
 * escribe enseguida, sin nada en el medio.
 */
export function openConfConfigStore({ configName, cwd, invalid }: ConfConfigStoreOptions): ConfigStore {
  const path = dataFilePath(cwd, configName);
  const directory = dirname(path);
  let conf: Conf<StoredConfig> | undefined;
  const open = (): Conf<StoredConfig> =>
    (conf ??= new Conf<StoredConfig>({ clearInvalidConfig: invalid === 'empty', configName, cwd: directory }));

  return {
    path,
    read: () => open().store,
    update(change) {
      const store = open();
      const next = change(store.store);

      if (next !== undefined) {
        store.store = next;
      }
    },
  };
}

/** El config.json de la carpeta de datos. Con JSON inválido no se pisa: `read` lanza `SyntaxError`. */
export function openConfigFileStore(cwd: string): ConfigStore {
  return openConfConfigStore({ configName: CONFIG_FILE_NAME, cwd, invalid: 'throw' });
}
