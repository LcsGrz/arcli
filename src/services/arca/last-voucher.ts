import type { Arca } from '@arcasdk/core';

import { AppError } from '../../lib/errors/app-error';
import type { ErrorCode } from '../../lib/errors/error-codes';
import {
  lastNumberErrorSuggestion,
  type LastNumberPurpose,
  missingLastNumberSuggestion,
} from '../../lib/errors/query-error';
import { CERTIFICATE_GUIDE_URL, POINT_OF_SALE_GUIDE_URL } from '../../lib/links';
import { getVoucherKindByArcaType } from '../../modules/billing/voucher-kind-map';
import { formatVoucherLabel } from '../../modules/billing/voucher-names';
import { getExportVoucherKindByArcaType } from '../../modules/export/export.kinds';

import { arcaErrorDetails } from './arca-error-details';
import { isNotAuthorized } from './not-authorized';
import { readLastNumber } from './soap-values';

/**
 * WSFEv1 11002: el punto de venta no esta habilitado para el web service.
 * 10005 es el mismo problema cuando ARCA lo informa al emitir.
 */
const POINT_OF_SALE_ERROR_CODES = new Set([10005, 11002]);

/**
 * El primer error de quien recien saca el certificado: no lo autorizo a facturar. Sin traducir llegaba como
 * "Error inesperado" con el texto de WSAA. El texto no dice "No se emitió nada": en un lote puede haber emitidos, las
 * consultas no iban a emitir y los avisos lo citan.
 */
export function rethrowIfWsfeNotAuthorized(error: unknown): never {
  if (isNotAuthorized(error)) {
    throw new AppError('El certificado no está autorizado para facturar (servicio wsfe).', {
      code: 'WSFE_SERVICE_NOT_AUTHORIZED',
      suggestion: `Autorizalo en ARCA: en testing desde WSASS ("Crear autorización a servicio"), y en producción desde el Administrador de Relaciones de Clave Fiscal. Guía: ${CERTIFICATE_GUIDE_URL}`,
    });
  }

  throw error;
}

/**
 * Pide el ultimo numero autorizado y corta si ARCA devolvio errores.
 * Al consultar, la sugerencia no habla de emitir: con eso se puede estar verificando una emision.
 * El SDK los deja en `errors` y no lanza: sin este chequeo, un punto de venta invalido parece no tener comprobantes.
 */
export async function getLastAuthorizedNumber(
  arca: Arca,
  pointOfSale: number,
  voucherType: number,
  purpose: LastNumberPurpose,
): Promise<number> {
  const result = await arca.electronicBillingService
    .getLastVoucher(pointOfSale, voucherType)
    .catch(rethrowIfWsfeNotAuthorized);
  const errors = result.errors?.err ?? [];

  if (errors.length > 0) {
    const pointOfSaleProblem = errors.some((error) => POINT_OF_SALE_ERROR_CODES.has(error.code));

    throw new AppError(
      `ARCA devolvió un error al pedir el último comprobante del punto de venta ${pointOfSale}: ${errors.map((error) => `${error.code} ${error.msg}`).join('; ')}`,
      {
        code: 'ARCA_LAST_VOUCHER_ERROR',
        details: arcaErrorDetails(errors),
        suggestion: pointOfSaleProblem
          ? `El punto de venta no está habilitado para web service (los de "Factura en línea" no sirven). Revisá los habilitados con \`arcli parametros puntos-venta\` o creá uno para web service: ${POINT_OF_SALE_GUIDE_URL}`
          : lastNumberErrorSuggestion(purpose),
      },
    );
  }

  const last = readLastNumber(result.cbteNro);

  if (last === undefined) {
    throw missingLastNumberError({ arcaType: voucherType, code: 'ARCA_LAST_VOUCHER_ERROR', pointOfSale, purpose });
  }

  return last;
}

/** Como en una frase: `factura C`, `recibo C`, `factura de exportación E`; `comprobante tipo 99` si no lo conoce. */
function voucherNameOf(arcaType: number): string {
  const kind = getVoucherKindByArcaType(arcaType) ?? getExportVoucherKindByArcaType(arcaType);

  return kind ? formatVoucherLabel(kind) : `comprobante tipo ${arcaType}`;
}

/**
 * ARCA contesto sin errores pero sin un ultimo numero que se pueda leer (ARQ-24). No se toma como 0: al emitir se
 * pediria el 1, y al consultar diria "No hay", lo que empuja a reemitir. El mismo error en wsfe y en wsfex.
 */
export function missingLastNumberError(options: {
  readonly arcaType: number;
  readonly code: Extract<ErrorCode, 'ARCA_EXPORT_ERROR' | 'ARCA_LAST_VOUCHER_ERROR'>;
  readonly pointOfSale: number;
  readonly purpose: LastNumberPurpose;
}): AppError {
  return new AppError(
    `ARCA contestó sin el último número de ${voucherNameOf(options.arcaType)} del punto de venta ${options.pointOfSale} (sin errores).`,
    {
      code: options.code,
      details: { errores: [] },
      suggestion: missingLastNumberSuggestion(options.purpose, 'el último número'),
    },
  );
}

/** Lo mismo con el ID de `FEXGetLast_ID`, que solo se pide al emitir una `E`. */
export function missingLastRequestIdError(): AppError {
  return new AppError('ARCA contestó sin el último ID de solicitud de WSFEX (sin errores).', {
    code: 'ARCA_EXPORT_ERROR',
    details: { errores: [] },
    suggestion: missingLastNumberSuggestion('emitir', 'el último ID de solicitud'),
  });
}
