import { SoapClient } from '@arcasdk/core';

import { asArray } from '../../../lib/arrays/as-array';
import { AppError } from '../../../lib/errors/app-error';
import type { ArcliEnvironment } from '../../../modules/config/config.schemas';
import type {
  ArcaMessage,
  VoucherCheckAnswer,
  VoucherCheckGateway,
  VoucherCheckRequest,
} from '../../../modules/voucher-check/voucher-check';
import { formatVoucherNumber } from '../../../modules/vouchers/voucher-number';
import { AUTHORIZE_SERVICE_SUGGESTION, isNotAuthorized, notAuthorizedTitle } from '../not-authorized';
import { installSoapDeadlines } from '../soap-deadline';
import { readNumber, readText } from '../soap-values';
import { avoidWeakDhe } from '../tls';

import { WSCDC_WSDL } from './wscdc-wsdl';

/** El nombre del servicio en WSAA (pyafipws `wscdc.py`; el manual de WSCDC no lo dice). */
export const WSCDC_SERVICE = 'wscdc';

/** El `Auth` de WSCDC (`CmpAuthRequest`): el ticket de WSAA y el CUIT de quien consulta, no el del emisor. */
export interface WscdcAuth {
  readonly Cuit: number;
  readonly Sign: string;
  readonly Token: string;
}

export type WscdcAuthenticator = () => Promise<WscdcAuth>;

interface ConstatarClient {
  ComprobanteConstatarAsync(params: object): Promise<readonly [unknown, ...unknown[]]>;
}

const NOT_AUTHORIZED_MESSAGE = notAuthorizedTitle(WSCDC_SERVICE, 'constatación de comprobantes');

/**
 * Los errores de autenticación de WSCDC (v0.4 §2.2.3): 600, el token o la firma no corresponden o el certificado no
 * está autorizado al servicio, y 601, la CUIT representada no está en el token. El 602 (CUIT no activa) no se arregla
 * autorizando: va como error de ARCA.
 */
const NOT_AUTHORIZED_ERRORS: ReadonlySet<number> = new Set([600, 601]);

/**
 * Las observaciones de un `R` que son de un dato de la consulta y no del comprobante (WSCDC v0.4 §2.2.4): 101, una
 * fecha anterior a 2013, y 113 a 118, el receptor que falta o no sirve para el tipo. Salen como
 * `INPUT_VALIDATION_ERROR`, aunque vengan con la 100: la consulta estaba mal armada. Las de "no existe o no coincide"
 * (100 y 102 a 112) son el "no constatado".
 */
const INPUT_OBSERVATIONS: ReadonlySet<number> = new Set([101, 113, 114, 115, 116, 117, 118]);

/**
 * 150 a 153, `Opcionales` mal armado: ARCLI nunca lo manda, así que no es de un dato de la persona. Si llegan, es
 * `ARCA_VOUCHER_CHECK_ERROR`.
 */
const OPTIONALS_OBSERVATIONS: ReadonlySet<number> = new Set([150, 151, 152, 153]);

/**
 * Los errores de formato de `CmpReq` (WSCDC v0.4 §2.2.4, errores 1 a 10): cada uno es de un campo que sale de lo que
 * dio la persona (modo, CUIT, punto de venta, tipo, número, fecha, importe, documento y código), así que son de
 * entrada. ARCLI ya controla el formato antes; llegan si ARCA tiene otra tabla (un tipo o documento que no existe).
 */
const FORMAT_ERRORS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

const INPUT_SUGGESTION =
  'Completá o corregí el dato que pide ARCA y volvé a constatar. Si no está en el QR, constatá con los datos del comprobante.';

/** 502, transacción activa (WSCDC v0.4 §2.2.3): pasajero, como en WSFE. */
const ACTIVE_TRANSACTION_ERROR = 502;

/** Lo que reconoce `summarizeError` como pasajero (`TRANSIENT_ERROR`), aunque ARCA lo escriba de otra forma. */
const ACTIVE_TRANSACTION_TEXT = 'Transacción Activa';

/**
 * `CmpReq` en el orden del WSDL (`CmpDatos` es una `sequence` y node-soap escribe los campos en el orden del objeto).
 * Sin receptor no van ni el tipo ni el número: si va uno, van los dos (WSCDC v0.4 §2.2.4, observación 117).
 *
 * @internal Exportada para los tests.
 */
export function toCmpReq(request: VoucherCheckRequest): Record<string, number | string> {
  return {
    CbteModo: request.mode,
    CuitEmisor: Number(request.issuerCuit),
    PtoVta: request.pointOfSale,
    CbteTipo: request.voucherType,
    CbteNro: request.number,
    CbteFch: request.date,
    ImpTotal: request.total,
    CodAutorizacion: request.authorizationCode,
    ...(request.receiver && {
      DocTipoReceptor: String(request.receiver.documentType),
      DocNroReceptor: request.receiver.documentNumber,
    }),
  };
}

/**
 * Los mensajes de una lista de WSCDC. El código 0 sin texto no dice nada y se descarta: en homologación ARCA lo manda
 * siempre en `Events`.
 */
function readMessages(container: unknown, item: string): ArcaMessage[] {
  const list = (container as Record<string, unknown> | null | undefined)?.[item];

  return asArray(list as unknown).flatMap((entry) => {
    const { Code, Msg } = (entry ?? {}) as Record<string, unknown>;
    const code = readNumber(Code);
    const message = readText(Msg);

    return code === undefined || (code === 0 && !message) ? [] : [{ code, message }];
  });
}

function describeMessages(messages: readonly ArcaMessage[]): string {
  return messages.map(({ code, message }) => `${code} ${message}`.trim()).join('; ');
}

function detailErrors(messages: readonly ArcaMessage[]): Record<string, unknown> {
  return { errores: messages.map(({ code, message }) => ({ codigo: code, mensaje: message })) };
}

/**
 * Lo que contestó WSCDC: constatado (`A`) o no (`R`, con el motivo en `Observaciones`, v0.4 §2.2.3 y §2.2.5). Lo que
 * viene en `Errors` sin un `A` no dice nada del comprobante (formato, autenticación o ARCA) y es un error, igual que
 * una respuesta sin `Resultado`: nunca un "no constatado".
 *
 * @internal Exportada para los tests.
 */
export function readConstatarAnswer(result: unknown, request: VoucherCheckRequest): VoucherCheckAnswer {
  const response = (typeof result === 'object' && result !== null ? result : {}) as Record<string, unknown>;
  const errors = readMessages(response.Errors, 'Err');
  const voucher = `el comprobante ${formatVoucherNumber(request.pointOfSale, request.number)}`;

  if (errors.some(({ code }) => NOT_AUTHORIZED_ERRORS.has(code))) {
    throw new AppError(`${NOT_AUTHORIZED_MESSAGE} ARCA dice: ${describeMessages(errors)}`, {
      code: 'WSCDC_SERVICE_NOT_AUTHORIZED',
      details: detailErrors(errors),
      suggestion: AUTHORIZE_SERVICE_SUGGESTION,
    });
  }

  if (errors.some(({ code }) => code === ACTIVE_TRANSACTION_ERROR)) {
    const reasons = describeMessages(errors);

    // Sin `AppError`: `summarizeError` lo reconoce por el texto y lo da como `TRANSIENT_ERROR`, con su sugerencia.
    throw new Error(reasons.includes(ACTIVE_TRANSACTION_TEXT) ? reasons : `${reasons} (${ACTIVE_TRANSACTION_TEXT})`);
  }

  const resultCode = readText(response.Resultado);

  if (resultCode !== 'A' && errors.length > 0 && errors.every(({ code }) => FORMAT_ERRORS.has(code))) {
    throw new AppError(`ARCA no pudo constatar ${voucher} por un dato de la consulta: ${describeMessages(errors)}`, {
      code: 'INPUT_VALIDATION_ERROR',
      suggestion: INPUT_SUGGESTION,
    });
  }

  const observations = readMessages(response.Observaciones, 'Obs');
  const inputObservations = observations.filter(({ code }) => INPUT_OBSERVATIONS.has(code));
  const optionalsObservations = observations.filter(({ code }) => OPTIONALS_OBSERVATIONS.has(code));

  if (resultCode === 'R' && errors.length === 0 && inputObservations.length > 0) {
    // Faltó o sobró un dato: no dice nada de si el comprobante existe, así que no es un "no constatado".
    throw new AppError(
      `ARCA no pudo constatar ${voucher} por un dato de la consulta: ${describeMessages(inputObservations)}`,
      { code: 'INPUT_VALIDATION_ERROR', suggestion: INPUT_SUGGESTION },
    );
  }

  if (resultCode === 'R' && errors.length === 0 && optionalsObservations.length > 0) {
    throw new AppError(`ARCA no pudo constatar ${voucher}: ${describeMessages(optionalsObservations)}`, {
      code: 'ARCA_VOUCHER_CHECK_ERROR',
      details: detailErrors(optionalsObservations),
      suggestion: 'ARCLI no manda `Opcionales`: avisanos con el mensaje de ARCA.',
    });
  }

  if (resultCode === 'A' || (resultCode === 'R' && errors.length === 0)) {
    return {
      errors,
      events: readMessages(response.Events, 'Evt'),
      observations,
      processedAt: readText(response.FchProceso) || null,
      result: resultCode,
    };
  }

  throw new AppError(
    errors.length > 0
      ? `ARCA no pudo constatar ${voucher}: ${describeMessages(errors)}`
      : `ARCA devolvió una respuesta inesperada al constatar ${voucher}: no dice si está constatado.`,
    {
      code: 'ARCA_VOUCHER_CHECK_ERROR',
      details: detailErrors(errors),
      suggestion:
        errors.length > 0
          ? 'Revisá el mensaje de ARCA: si es pasajero, volvé a constatar en unos minutos; si no, corregí el dato que dice.'
          : 'Volvé a constatar en unos minutos. Si se repite, avisanos.',
    },
  );
}

/**
 * WSCDC, Constatación de Comprobantes: `@arcasdk/core` no lo trae, así que va con su cliente SOAP y el WSDL oficial
 * (`wscdc-wsdl.ts`), como los `Dummy` de `cancellable-dummy.ts`: con los plazos y la cancelación de `soap-deadline`.
 */
export class ArcaVoucherCheckGateway implements VoucherCheckGateway {
  public constructor(
    private readonly options: {
      readonly authenticate: WscdcAuthenticator;
      readonly environment: ArcliEnvironment;
    },
  ) {}

  public async check(request: VoucherCheckRequest): Promise<VoucherCheckAnswer> {
    const { environment } = this.options;
    const auth = await this.authenticate();

    avoidWeakDhe(environment === 'produccion');
    installSoapDeadlines();

    const client = (await new SoapClient().createClient(WSCDC_SERVICE, {
      wsdlContent: WSCDC_WSDL[environment],
    })) as unknown as ConstatarClient;
    const [answer] = await client.ComprobanteConstatarAsync({
      Auth: { Token: auth.Token, Sign: auth.Sign, Cuit: auth.Cuit },
      CmpReq: toCmpReq(request),
    });

    return readConstatarAnswer((answer as Record<string, unknown> | null)?.ComprobanteConstatarResult, request);
  }

  private async authenticate(): Promise<WscdcAuth> {
    try {
      return await this.options.authenticate();
    } catch (error) {
      if (isNotAuthorized(error)) {
        throw new AppError(NOT_AUTHORIZED_MESSAGE, {
          code: 'WSCDC_SERVICE_NOT_AUTHORIZED',
          suggestion: AUTHORIZE_SERVICE_SUGGESTION,
        });
      }

      throw error;
    }
  }
}
