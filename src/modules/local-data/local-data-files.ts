import { join } from 'node:path';

import { ConfigurationError } from '../../lib/errors/app-error';
import { parseCuit } from '../../lib/identity/cuit';
import { type ArcliEnvironment, arcliEnvironmentSchema } from '../config/config.schemas';

/**
 * Las bases locales de un CUIT en la carpeta de datos (ARQ-12): los comprobantes por entorno y los clientes por CUIT.
 *
 * - `folder`: `datos/<CUIT>/<entorno>/`.
 * - `vouchers`: `datos/<CUIT>/<entorno>/comprobantes.db`.
 * - `backups`: `datos/<CUIT>/<entorno>/copias/`.
 * - `clients`: `datos/<CUIT>/clientes.db`.
 */
export interface LocalDataFiles {
  readonly backups: string;
  readonly clients: string;
  readonly folder: string;
  readonly vouchers: string;
}

/** `datos/<CUIT>/`, con el CUIT validado: uno que no es un CUIT (`../x`) no llega a una ruta. */
function cuitFolder(dataDirectory: string, cuit: string): string {
  const parsed = parseCuit(cuit);

  if (!parsed.ok) {
    throw new ConfigurationError(`El CUIT de los datos locales no es válido: ${parsed.reason}.`, { cuit });
  }

  return join(dataDirectory, 'datos', parsed.value);
}

/** La base de clientes de un CUIT (`datos/<CUIT>/clientes.db`), sin tocar el disco. */
export function resolveClientsDatabaseFile(dataDirectory: string, cuit: string): string {
  return join(cuitFolder(dataDirectory, cuit), 'clientes.db');
}

/**
 * Las rutas, sin tocar el disco. Valida el CUIT y el entorno antes de armar una ruta: uno inválido (`../x`, 10
 * dígitos) lanza. El CUIT puede venir con guiones: en la ruta va con los 11 dígitos.
 */
export function resolveLocalDataFiles(
  dataDirectory: string,
  cuit: string,
  environment: ArcliEnvironment,
): LocalDataFiles {
  const root = cuitFolder(dataDirectory, cuit);
  const parsedEnvironment = arcliEnvironmentSchema.safeParse(environment);

  if (!parsedEnvironment.success) {
    throw new ConfigurationError(`El entorno de los datos locales no es válido: ${JSON.stringify(environment)}.`, {
      entorno: environment,
    });
  }

  const folder = join(root, parsedEnvironment.data);

  return {
    backups: join(folder, 'copias'),
    clients: join(root, 'clientes.db'),
    folder,
    vouchers: join(folder, 'comprobantes.db'),
  };
}
