/**
 * Por qué no se pudo usar una base de datos local (ARQ-12). No es `AppError` ni lleva `ErrorCode`: qué ve quien usa
 * el CLI lo decide quien la usa (LIBRO-1).
 *
 * - `damaged`: la base está dañada (o no es una base de SQLite).
 * - `newer-version`: la escribió un ARCLI más nuevo (mayor desconocida); no se toca.
 * - `mismatch`: es de otro CUIT, otro entorno u otro programa (`application_id` o `metadatos`); no se toca.
 * - `locked`: otro proceso la tiene tomada más que la espera.
 * - `read-only`: no se puede escribir el archivo o su carpeta.
 * - `disk-full`: no hay lugar en el disco.
 * - `unavailable`: no se pudo abrir (carpeta o archivo inexistente, sin acceso).
 * - `path-too-long`: en Windows, la ruta pasa el largo que SQLite puede abrir.
 */
export type LocalDataErrorReason =
  'damaged' | 'disk-full' | 'locked' | 'mismatch' | 'newer-version' | 'path-too-long' | 'read-only' | 'unavailable';

/** @internal Lo conecta LIBRO-1. */
export class LocalDataError extends Error {
  override readonly name = 'LocalDataError';

  constructor(
    readonly reason: LocalDataErrorReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
