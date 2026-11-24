import { resolveBillingCurrencyCode } from '../billing/currency-codes';

import type { ExportJsonInput } from './export.json-input';
import { normalizeCountryName } from './export.mappers';
import { DEFAULT_EXPORT_CURRENCY_CODE } from './export.types';

interface Levels {
  readonly file: ExportJsonInput;
  readonly flags: ExportJsonInput;
}

type FileKey = keyof ExportJsonInput;

const trimmed = (value: string): string => value.trim();
const upper = (value: string): string => value.trim().toUpperCase();

/** El flag dice otra cosa que el archivo; lo que el archivo no trae no contradice nada. */
function changes(
  { file, flags }: Levels,
  key: 'cliente' | 'incoterm' | 'paisDestino',
  normalize: (value: string) => string,
): boolean {
  const [flag, value] = [flags[key], file[key]];

  return flag !== undefined && value !== undefined && normalize(String(flag)) !== normalize(String(value));
}

/** La cotizacion del archivo es de su moneda o, si no la dice, de la de la E por defecto. */
function changesRateCurrency({ file, flags }: Levels): boolean {
  return (
    flags.codigoMoneda !== undefined &&
    resolveBillingCurrencyCode(flags.codigoMoneda) !==
      resolveBillingCurrencyCode(file.codigoMoneda || DEFAULT_EXPORT_CURRENCY_CODE)
  );
}

/** Que flag hace que cada dato del archivo no vaya. */
const DISCARDS: ReadonlyArray<readonly [when: (levels: Levels) => boolean, keys: readonly FileKey[]]> = [
  [changesRateCurrency, ['cotizacionMoneda']],
  [({ flags }) => flags.mismaMoneda === true, ['cotizacionMoneda']],
  [({ flags }) => flags.cotizacionMoneda !== undefined, ['mismaMoneda']],
  // Un nombre y un codigo se toman por distintos: compararlos necesita la tabla de ARCA.
  [(levels) => changes(levels, 'paisDestino', normalizeCountryName), ['cuitPais']],
  [(levels) => changes(levels, 'cliente', trimmed), ['domicilioCliente', 'idImpositivo']],
  [(levels) => changes(levels, 'incoterm', upper), ['descripcionIncoterm']],
];

/**
 * Como en A, B y C: un flag que cambia a quien, que comprobante o que moneda descarta del archivo los datos que
 * dependian del valor anterior. Los del comprobante asociado se deciden al mezclarlo.
 */
export function discardExportOverridden<T extends Levels>(levels: T): T {
  const discarded = new Set(DISCARDS.flatMap(([when, keys]) => (when(levels) ? keys : [])));
  const file = Object.fromEntries(
    Object.entries(levels.file).filter(([key]) => !discarded.has(key as FileKey)),
  ) as ExportJsonInput;

  return { ...levels, file };
}
