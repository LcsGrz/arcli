import { ConfigService } from '../modules/config/config.service';

import { dataDirectory } from './data-directory';

/** La config de la carpeta de datos. Quien la abre la cierra; para una sola operacion, `withConfigService`. */
export function openConfigService(): ConfigService {
  return new ConfigService({ cwd: dataDirectory() });
}

/** Abre la config, hace una operacion sincronica y la cierra. */
export function withConfigService<T>(run: (service: ConfigService) => T): T {
  const service = openConfigService();

  try {
    return run(service);
  } finally {
    service.close();
  }
}
