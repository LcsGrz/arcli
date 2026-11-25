import { InputValidationError } from '../../lib/errors/app-error';
import { INVALID_POINT_OF_SALE_MESSAGE } from '../billing/billing.schemas';
import { type ArcliConfig, MISSING_POINT_OF_SALE_MESSAGE } from '../config/config.schemas';

import { MAX_EXPORT_POINT_OF_SALE } from './export.types';

type ExportConfig = Pick<ArcliConfig, 'puntoVentaPorDefecto'>;

/** 1510 (WSFEX v3.1.0): el punto de venta de la E va de 1 a 99.998. */
export function assertExportPointOfSaleRange(pointOfSale: number, label: string): void {
  if (pointOfSale > MAX_EXPORT_POINT_OF_SALE) {
    throw new InputValidationError(
      `${label} de la E va de 1 a ${MAX_EXPORT_POINT_OF_SALE}: ARCA rechaza ${pointOfSale} (error 1510).`,
    );
  }
}

export function resolveExportPointOfSale(value: number | undefined, config: ExportConfig): number {
  const pointOfSale = value ?? config.puntoVentaPorDefecto;

  if (pointOfSale === undefined) {
    throw new InputValidationError(MISSING_POINT_OF_SALE_MESSAGE);
  }

  if (!Number.isInteger(pointOfSale) || pointOfSale < 1) {
    throw new InputValidationError(INVALID_POINT_OF_SALE_MESSAGE);
  }

  assertExportPointOfSaleRange(pointOfSale, 'El punto de venta');

  return pointOfSale;
}

/**
 * Numero del comprobante o de la solicitud: el indicado por el usuario o el que sigue al ultimo de ARCA, hasta `max`
 * (el comprobante, 99.999.999 por la 1520; la solicitud, 15 digitos).
 */
export function resolveExportNumber(options: {
  /** El control de ARCA que fija el tope, si el manual lo da. */
  readonly code?: number;
  readonly label: string;
  readonly last: number;
  readonly max: number;
  readonly provided?: number;
}): number {
  const value = options.provided ?? (Number.isFinite(options.last) ? options.last : 0) + 1;

  if (options.provided !== undefined && (!Number.isInteger(options.provided) || options.provided < 1)) {
    throw new InputValidationError(`${options.label} tiene que ser un número entero positivo.`);
  }

  if (value > options.max) {
    throw new InputValidationError(
      `${options.label} supera el máximo de ARCA (${options.max})${options.code === undefined ? '' : ` y ARCA lo rechaza (error ${options.code})`}.`,
    );
  }

  return value;
}
