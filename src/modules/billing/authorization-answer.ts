/**
 * Lo que contesto ARCA a la llamada que emite, A, B, C y E: cada dato donde lo encontro el gateway, como vino (suelto,
 * en lista, nulo o de otro tipo). Nada se convierte ni se descarta: lo interpretan `billing-response` y
 * `export.response`. Los datos que no siempre hacen falta se leen al pedirlos, asi uno ilegible que no se usa no cuesta
 * el CAE.
 */
export interface AuthorizationAnswer {
  readonly cae: unknown;
  /** En la E se lee al pedirlo. */
  readonly caeExpiration: unknown;
  readonly errors: unknown;
  readonly events: unknown;
  readonly observations: unknown;
  /** La respuesta cruda, el mismo objeto: es lo que sale con `--bruto`. */
  readonly raw: unknown;
  readonly result: unknown;
  /** El numero que informo ARCA, con el tipo que declara el SDK. Se lee al pedirlo. */
  readonly voucherNumber: number | undefined;
}

/** La de A, B y C: ademas del CAE del SDK, lo que dice el detalle del comprobante. */
export interface BillingAuthorizationAnswer extends AuthorizationAnswer {
  /** Se lee al pedirlo: vale si no esta `cae`. */
  readonly detailCae: unknown;
  /** Se lee al pedirlo: vale si no esta `caeExpiration`. */
  readonly detailCaeExpiration: unknown;
  /** El resultado de la cabecera. Se lee al pedirlo: vale si no esta `result`. */
  readonly headerResult: unknown;
}
