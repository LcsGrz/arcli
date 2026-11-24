/** Un problema de la entrada, listo para mostrar: etiqueta en castellano, mensaje y ruta con la clave del JSON. */
export interface InputIssue {
  readonly label: string;
  readonly mensaje: string;
  readonly ruta: readonly string[];
}

/** El mensaje de una entrada que no paso el esquema, si el dominio no da el suyo. */
export const INPUT_ISSUES_MESSAGE = 'Hay parámetros inválidos o incompletos en la entrada.';
