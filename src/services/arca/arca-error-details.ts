import { DEPRECATED_DETAILS_ERROR_KEYS, DEPRECATED_DETAILS_ERRORS } from '../../lib/json/deprecations';

interface ArcaError {
  /** `null` si ARCA no lo mando o no se puede leer. */
  readonly code: number | null;
  readonly msg: string;
}

/** Los errores de ARCA en `detalles.errores`: siempre con `codigo` y `mensaje`. */
export function toDetailErrors<T extends ArcaError>(
  errors: readonly T[],
): Array<T & { codigo: T['code']; mensaje: string }> {
  return errors.map((error) => ({ ...error, codigo: error.code, mensaje: error.msg }));
}

/** El aviso de `code` y `msg`, que solo traen los errores de wsfe. */
function oldKeysNotice(errores: readonly object[]): string[] {
  return errores.some((error) => 'code' in error || 'msg' in error) ? [DEPRECATED_DETAILS_ERROR_KEYS] : [];
}

/** `detalles` de un error de wsfe. Cada entrada conserva `code` y `msg`, con su aviso, hasta la 3.0.0. */
export function arcaErrorDetails(errors: readonly ArcaError[]): Record<string, unknown> {
  const errores = toDetailErrors(errors);
  const deprecado = oldKeysNotice(errores);

  return { ...(deprecado.length > 0 && { deprecado }), errores };
}

/** Para los errores que salian en `detalles.errors`: esa clave sigue, con su aviso, hasta la 3.0.0. */
export function withDeprecatedErrors(errors: unknown, errores: readonly object[]): Record<string, unknown> {
  return { deprecado: [DEPRECATED_DETAILS_ERRORS, ...oldKeysNotice(errores)], errores, errors };
}
