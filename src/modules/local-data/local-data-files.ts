import type { ArcliEnvironment } from '../config/config.schemas';

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

/**
 * Las rutas, sin tocar el disco. Valida el CUIT y el entorno antes de armar una ruta: uno inválido (`../x`, 10
 * dígitos) lanza.
 *
 * @internal Stub de Tests primero (ARQ-12 PR 4a): lo implementa nucleo.
 */
export function resolveLocalDataFiles(
  _dataDirectory: string,
  _cuit: string,
  _environment: ArcliEnvironment,
): LocalDataFiles {
  throw new Error('no implementado: stub de Tests primero (ARQ-12 PR 4a), lo implementa nucleo');
}
