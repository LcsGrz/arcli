import { AppError } from '../../lib/errors/app-error';

/** A, B y C: el numero lo pone ARCA, asi que se verifica con `arcli ultimos`. */
interface WsfeUncertainTarget {
  readonly environment: 'produccion' | 'testing';
  readonly pointOfSale: number;
  readonly shortcut: string;
}

/**
 * Factura E: el numero lo indica el usuario con `--numero` y ARCA no autoriza dos comprobantes con el mismo tipo,
 * punto de venta y numero. Reintentar con los mismos numeros no puede duplicarla (`arcli ultimos` no acepta `fe`).
 */
interface WsfexUncertainTarget {
  readonly environment: 'produccion' | 'testing';
  readonly pointOfSale: number;
  readonly requestId: number;
  readonly voucherNumber: number;
}

/**
 * Fallo la llamada que emite en ARCA (red, timeout, ARCA). No se sabe si el comprobante quedo autorizado:
 * pudo emitirse y perderse la respuesta. Reintentar sin verificar puede duplicarlo.
 */
export class EmissionUncertainError extends AppError {
  /**
   * Con que verificarlo en A, B y C. Lleva el entorno: sin el, `ultimos` consulta el de la config, y si se emitio con
   * `--produccion` y la config dice testing el comprobante "no figura" y se reintenta, duplicandolo.
   */
  public readonly verifyCommand?: string;

  public constructor(options: { readonly cause: unknown } & (WsfeUncertainTarget | WsfexUncertainTarget)) {
    const reason = options.cause instanceof Error ? options.cause.message : String(options.cause);
    const verifyCommand =
      'voucherNumber' in options
        ? undefined
        : `arcli ultimos ${options.shortcut} --pv ${options.pointOfSale} --${options.environment}`;

    super(`No se pudo confirmar la emisión: ${reason}`, {
      code: 'EMISSION_UNCERTAIN',
      details:
        'voucherNumber' in options
          ? { causa: reason, idSolicitud: options.requestId, numero: options.voucherNumber }
          : { causa: reason },
      suggestion:
        'voucherNumber' in options
          ? `Puede haberse emitido igual. Si reintentás, usá el mismo número y la misma solicitud (\`--numero ${options.voucherNumber} --id-solicitud ${options.requestId} --pv ${options.pointOfSale} --${options.environment}\`): si ya se había emitido, ARCA no lo autoriza dos veces.`
          : `Puede haberse emitido igual. Antes de reintentar, verificá con \`${verifyCommand}\`: si figura, ya está emitido y no hay que repetirlo.`,
    });
    this.name = 'EmissionUncertainError';
    this.cause = options.cause;
    this.verifyCommand = verifyCommand;
  }
}
