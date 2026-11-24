import type { Arca } from '@arcasdk/core';

import { AppError } from '../../lib/errors/app-error';
import { ARCA_QUERY_ERROR_SUGGESTION } from '../../lib/errors/query-error';
import { CERTIFICATE_GUIDE_URL, POINT_OF_SALE_GUIDE_URL } from '../../lib/links';

import { toDetailErrors } from './arca-error-details';
import { isNotAuthorized } from './not-authorized';

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
  purpose: 'consultar' | 'emitir',
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
        details: { errores: toDetailErrors(errors) },
        suggestion: pointOfSaleProblem
          ? `El punto de venta no está habilitado para web service (los de "Factura en línea" no sirven). Revisá los habilitados con \`arcli parametros puntos-venta\` o creá uno para web service: ${POINT_OF_SALE_GUIDE_URL}`
          : purpose === 'consultar'
            ? ARCA_QUERY_ERROR_SUGGESTION
            : 'No se emitió nada. Revisá el mensaje de ARCA y reintentá.',
      },
    );
  }

  return result.cbteNro ?? 0;
}
