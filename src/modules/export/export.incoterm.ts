import { InputValidationError } from '../../lib/errors/app-error';

import { BILLS_EXPORT_TYPE, type ExportIncoterm, type ExportType } from './export.types';

/**
 * El incoterm de la E (WSFEX v3.1.0): obligatorio en la factura de bienes (1640) y la descripcion solo con incoterm
 * (1641). En las notas el incoterm puede venir del asociado.
 */
export function assertExportIncoterm(options: {
  readonly exportType: ExportType;
  readonly incoterm?: string;
  readonly incotermDescription?: string;
  readonly isNote: boolean;
}): void {
  const hasIncoterm = Boolean(options.incoterm?.trim());

  if (!options.isNote && options.exportType === BILLS_EXPORT_TYPE && !hasIncoterm) {
    throw new InputValidationError(
      'La factura E de bienes (`--tipo-expo 1`) lleva incoterm: ARCA lo exige (error 1640). Usá `--incoterm`, por ejemplo `FOB`.',
    );
  }

  if (options.incotermDescription?.trim() && !hasIncoterm) {
    throw new InputValidationError(
      '`--incoterms-desc` va con un incoterm: ARCA rechaza la descripción sola (error 1641). Sumá `--incoterm` o sacá `--incoterms-desc`.',
    );
  }
}

/**
 * `--incoterm` se compara contra la tabla de ARCA, sin importar mayusculas. Si ARCA la devuelve vacia no se valida
 * (como la actividad): va el codigo escrito, que tambien es la descripcion por defecto, y el servicio avisa.
 */
export function resolveExportIncoterm(
  value: string | undefined,
  incoterms: readonly ExportIncoterm[],
): ExportIncoterm | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (incoterms.length === 0) {
    return { code: trimmed.toUpperCase(), name: trimmed.toUpperCase() };
  }

  const incoterm = incoterms.find((entry) => entry.code.trim().toUpperCase() === trimmed.toUpperCase());

  if (!incoterm) {
    throw new InputValidationError(
      `El incoterm "${trimmed}" no existe en la tabla de ARCA.`,
      undefined,
      `Los válidos: ${incoterms.map((entry) => `\`${entry.code.trim()}\``).join(', ')}.`,
    );
  }

  return incoterm;
}
