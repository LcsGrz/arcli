/** Claves del JSON que se sacan en la 3.0.0. Las frases salen en `deprecado`, solo si la respuesta trae esa clave. */
export const DEPRECATED_CUIT_NUMBER = '`cuit` pasa a ser texto en la 3.0.0: leelo como texto para que no te afecte.';

export const DEPRECATED_POINT_OF_SALE_OBJECT =
  '`puntoVenta` pasa a ser un número en la 3.0.0: para el detalle usá `puntoVentaDetalle`.';

export const DEPRECATED_DETAILS_ERRORS = '`detalles.errors` se saca en la 3.0.0: usá `detalles.errores`.';

export const DEPRECATED_BILLING_RESPONSE_KEYS =
  '`Code` y `Msg` de `errores` y `eventos` se sacan en la 3.0.0: usá `codigo` y `mensaje`.';

export const DEPRECATED_EXPORT_RESPONSE_KEYS =
  '`code` y `message` de `errores` y `eventos` se sacan en la 3.0.0: usá `codigo` y `mensaje`.';
