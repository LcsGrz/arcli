import { isSameCurrency } from '../billing/currency-codes';

import type { ExportJsonInput } from './export.json-input';
import { isSameExportClient, isSameExportCountry, isSameExportIncoterm } from './export.same';
import { DEFAULT_EXPORT_CURRENCY_CODE, type ExportVoucherKind, isExportNote } from './export.types';

interface Levels {
  readonly file: ExportJsonInput;
  readonly flags: ExportJsonInput;
  readonly voucherKind: ExportVoucherKind;
}

type FileKey = keyof ExportJsonInput;

/** El flag dice otra cosa que el archivo; lo que el archivo no trae no contradice nada. */
function changes(
  { file, flags }: Levels,
  key: 'cliente' | 'incoterm' | 'paisDestino',
  isSame: (flag: string, file: string) => boolean,
): boolean {
  const [flag, value] = [flags[key], file[key]];

  return flag !== undefined && value !== undefined && !isSame(String(flag), String(value));
}

/**
 * La cotizacion del archivo es de su moneda. Si no la dice, en la factura es la de la E por defecto; en una nota sale
 * del asociado, asi que no se sabe y no va.
 */
function changesRateCurrency({ file, flags, voucherKind }: Levels): boolean {
  if (flags.codigoMoneda === undefined) {
    return false;
  }

  const fileCurrency = file.codigoMoneda || (isExportNote(voucherKind) ? undefined : DEFAULT_EXPORT_CURRENCY_CODE);

  return fileCurrency === undefined || !isSameCurrency(flags.codigoMoneda, fileCurrency);
}

/** Que flag hace que cada dato del archivo no vaya. */
const DISCARDS: ReadonlyArray<readonly [when: (levels: Levels) => boolean, keys: readonly FileKey[]]> = [
  [changesRateCurrency, ['cotizacionMoneda']],
  [({ flags }) => flags.mismaMoneda === true, ['cotizacionMoneda']],
  [({ flags }) => flags.cotizacionMoneda !== undefined, ['mismaMoneda']],
  [(levels) => changes(levels, 'paisDestino', isSameExportCountry), ['cuitPais']],
  [(levels) => changes(levels, 'cliente', isSameExportClient), ['domicilioCliente', 'idImpositivo']],
  [(levels) => changes(levels, 'incoterm', isSameExportIncoterm), ['descripcionIncoterm']],
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
