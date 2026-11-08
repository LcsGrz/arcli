import type { Arca } from '@arcasdk/core';

import { AppError } from '../../lib/errors/app-error';
import { CERTIFICATE_GUIDE_URL, POINT_OF_SALE_GUIDE_URL } from '../../lib/links';

import { toDetailErrors } from './arca-error-details';

/**
 * WSFEv1 11002: el punto de venta no esta habilitado para el web service.
 * 10005 es el mismo problema cuando ARCA lo informa al emitir.
 */
const POINT_OF_SALE_ERROR_CODES = new Set([10005, 11002]);

/**
 * El primer error de quien recien saca el certificado: no lo autorizo a facturar. Sin traducir llegaba como
 * "Error inesperado" con el texto de WSAA. Si pasa, no se envio nada a ARCA.
 */
export function rethrowIfWsfeNotAuthorized(error: unknown): never {
  if (error instanceof Error && error.message.includes('notAuthorized')) {
    throw new AppError('El certificado no está autorizado para facturar (servicio wsfe). No se emitió nada.', {
      code: 'WSFE_SERVICE_NOT_AUTHORIZED',
      suggestion: `Autorizalo en ARCA: en testing desde WSASS ("Crear autorización a servicio"), y en producción desde el Administrador de Relaciones de Clave Fiscal. Guía: ${CERTIFICATE_GUIDE_URL}`,
    });
  }

  throw error;
}

/**
 * Pide el ultimo numero autorizado y corta si ARCA devolvio errores.
 * El SDK los deja en `errors` y no lanza: sin este chequeo, un punto de venta invalido parece no tener comprobantes.
 */
export async function getLastAuthorizedNumber(arca: Arca, pointOfSale: number, voucherType: number): Promise<number> {
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
          : 'No se emitió nada. Revisá el mensaje de ARCA y reintentá.',
      },
    );
  }

  return result.cbteNro ?? 0;
}
