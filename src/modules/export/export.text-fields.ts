import { InputValidationError } from '../../lib/errors/app-error';

import { exportTextLengthError, MAX_EXPORT_ITEM_DESCRIPTION_LENGTH } from './export.items';
import type { ExportVoucherInput } from './export.types';

export function requireText(value: string | undefined, description: string, flag: string): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new InputValidationError(`Falta ${description}. Usá ${flag}.`);
  }

  return trimmed;
}

/**
 * Los textos de la E con su largo maximo en WSFEX v3.1.0: el codigo de control, si el manual lo da, y el flag.
 *
 * @internal Exportado para los tests.
 */
export const EXPORT_TEXT_LIMITS = {
  clientAddress: { code: 1661, flag: '--domicilio-cliente', label: 'El domicilio del cliente', max: 300 },
  clientName: { code: 1651, flag: '--cliente', label: 'El nombre del cliente', max: 200 },
  // Tabla de campos: `ID_impositivo` String (C50), sin codigo de control.
  clientTaxId: { code: undefined, flag: '--id-impositivo', label: 'El ID impositivo del cliente', max: 50 },
  commercialObservations: {
    code: 1665,
    flag: '--obs-comerciales',
    label: 'Las observaciones comerciales',
    max: 4000,
  },
  // Sin `--item`, la descripcion es el `Pro_ds` del unico renglon.
  description: { code: 1770, flag: '--descripcion', label: 'La descripción', max: MAX_EXPORT_ITEM_DESCRIPTION_LENGTH },
  incotermDescription: { code: 1642, flag: '--incoterms-desc', label: 'La descripción del incoterm', max: 20 },
  observations: { code: 1665, flag: '--observaciones', label: 'Las observaciones', max: 1000 },
  // Tabla de campos: `Forma_pago` String (C50), sin codigo de control.
  paymentTerms: { code: undefined, flag: '--forma-pago', label: 'La forma de pago', max: 50 },
} as const;

export type ExportTextField = keyof typeof EXPORT_TEXT_LIMITS;

/** El error de largo de un texto de la E, para el CLI y el asistente; `undefined` si entra. */
export function exportTextFieldError(field: ExportTextField, value: string | undefined): string | undefined {
  const limit = EXPORT_TEXT_LIMITS[field];

  return exportTextLengthError({ code: limit.code, label: limit.label, max: limit.max, value });
}

/** Los largos maximos de los textos de la E (1642, 1651, 1661, 1665, 1770 y la tabla de campos), antes de ir a ARCA. */
export function assertExportTextLengths(input: ExportVoucherInput): void {
  for (const field of Object.keys(EXPORT_TEXT_LIMITS) as ExportTextField[]) {
    const error = exportTextFieldError(field, input[field]);

    if (error) {
      throw new InputValidationError(`${error} Acortá \`${EXPORT_TEXT_LIMITS[field].flag}\`.`);
    }
  }
}
