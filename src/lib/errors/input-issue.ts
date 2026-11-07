/** Un problema de la entrada, listo para mostrar: etiqueta en castellano, mensaje y ruta con la clave del JSON. */
export interface InputIssue {
  readonly label: string;
  readonly mensaje: string;
  readonly ruta: readonly string[];
}
