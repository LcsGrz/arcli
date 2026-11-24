import { AppError } from '../../lib/errors/app-error';

/**
 * Lee la respuesta de la llamada que emite, A, B, C o E. Si no se puede, ARCA pudo haber autorizado el comprobante: va
 * adentro del mismo `try` que la llamada, asi sale como `EmissionUncertainError` y no como un error inesperado que invita
 * a reintentar (ERR-16). El error original queda en `cause`.
 */
export function readEmissionResponse<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new Error('ARCA contestó algo que ARCLI no pudo leer', { cause: error });
  }
}

/** A, B y C: el numero lo pone ARCA, asi que se verifica con `arcli ultimos`. */
interface WsfeUncertainTarget {
  readonly environment: 'produccion' | 'testing';
  readonly pointOfSale: number;
  readonly shortcut: string;
}

/**
 * La E: el numero ya esta fijado en la solicitud y ARCA no autoriza dos comprobantes con el mismo tipo, punto de venta
 * y numero, asi que reintentar con los mismos numeros no puede duplicarla. Tambien se verifica con `arcli consultar`.
 */
interface WsfexUncertainTarget {
  readonly environment: 'produccion' | 'testing';
  readonly pointOfSale: number;
  readonly requestId: number;
  /** `fe`, `nde` o `nce`. */
  readonly shortcut: string;
  readonly voucherNumber: number;
}

/**
 * Fallo la llamada que emite en ARCA (red, timeout, ARCA) o no se pudo leer su respuesta. No se sabe si el comprobante
 * quedo autorizado: pudo emitirse y perderse la respuesta. Reintentar sin verificar puede duplicarlo.
 */
export class EmissionUncertainError extends AppError {
  /**
   * Con que verificarlo: `ultimos` en A, B y C, `consultar` en la E. Lleva el entorno: sin el, `ultimos` consulta el de la config, y si se emitio con
   * `--produccion` y la config dice testing el comprobante "no figura" y se reintenta, duplicandolo.
   */
  public readonly verifyCommand?: string;

  public constructor(options: { readonly cause: unknown } & (WsfeUncertainTarget | WsfexUncertainTarget)) {
    const reason = options.cause instanceof Error ? options.cause.message : String(options.cause);
    const verifyCommand =
      'voucherNumber' in options
        ? `arcli consultar ${options.shortcut} ${options.voucherNumber} --pv ${options.pointOfSale} --${options.environment}`
        : `arcli ultimos ${options.shortcut} --pv ${options.pointOfSale} --${options.environment}`;

    super(`No se pudo confirmar la emisión: ${reason}`, {
      code: 'EMISSION_UNCERTAIN',
      details:
        'voucherNumber' in options
          ? { causa: reason, idSolicitud: options.requestId, numero: options.voucherNumber }
          : { causa: reason },
      suggestion:
        'voucherNumber' in options
          ? `Puede haberse emitido igual. Verificalo con \`${verifyCommand}\`: si figura, ya está emitido. Si reintentás, usá el mismo número y la misma solicitud (\`--numero ${options.voucherNumber} --id-solicitud ${options.requestId} --pv ${options.pointOfSale} --${options.environment}\`): si ya se había emitido, ARCA no lo autoriza dos veces.`
          : `Puede haberse emitido igual. Antes de reintentar, verificá con \`${verifyCommand}\`: si figura, ya está emitido y no hay que repetirlo.`,
    });
    this.name = 'EmissionUncertainError';
    this.cause = options.cause;
    this.verifyCommand = verifyCommand;
  }
}
