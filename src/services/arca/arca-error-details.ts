import { DEPRECATED_DETAILS_ERRORS } from '../../lib/json/deprecations';

interface ArcaError {
  readonly code: number;
  readonly msg: string;
}

/** Los errores de ARCA en `detalles.errores`: siempre con `codigo` y `mensaje`. */
export function toDetailErrors<T extends ArcaError>(
  errors: readonly T[],
): Array<T & { codigo: number; mensaje: string }> {
  return errors.map((error) => ({ ...error, codigo: error.code, mensaje: error.msg }));
}

/** Para los errores que salian en `detalles.errors`: esa clave sigue, con su aviso, hasta la 3.0.0. */
export function withDeprecatedErrors(errors: unknown, errores: readonly unknown[]): Record<string, unknown> {
  return { deprecado: [DEPRECATED_DETAILS_ERRORS], errores, errors };
}
