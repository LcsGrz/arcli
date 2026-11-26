import { ConfigService } from '../modules/config/config.service';
import { nodeLocalFiles } from '../services/files/local-files';

import { dataDirectory } from './data-directory';

/** La config de la carpeta de datos. Quien la abre la cierra; para una sola operacion, `withConfigService`. */
export function openConfigService(): ConfigService {
  return new ConfigService({ cwd: dataDirectory(), files: nodeLocalFiles });
}

/** Lo que no hay que esperar: con una promesa, la config se cerraria antes de que termine. */
export type Synchronous<T> = T extends PromiseLike<unknown> ? never : T;

/** Abre la config, hace una operacion sincronica y la cierra. */
export function withConfigService<T>(run: (service: ConfigService) => Synchronous<T>): Synchronous<T> {
  const service = openConfigService();

  try {
    return run(service);
  } finally {
    service.close();
  }
}
