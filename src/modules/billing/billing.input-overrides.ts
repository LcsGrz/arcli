import { isForeignCurrency } from './billing.currency';
import type { BillingDefaults } from './billing.defaults';
import type { BillingJsonInput } from './billing.json-input';
import { isSameCurrency } from './currency-codes';

interface Levels {
  readonly defaults: BillingDefaults;
  readonly file: BillingJsonInput;
  readonly flags: BillingJsonInput;
}

type FileKey = keyof BillingJsonInput;

/** Otro documento que el del archivo, que puede traer solo el tipo o solo el numero. */
function changesReceiver({ file, flags }: Levels): boolean {
  const changes = <T>(flag: T | undefined, value: T | undefined) =>
    flag !== undefined && value !== undefined && flag !== value;

  return (
    changes(flags.tipoDocumento, file.tipoDocumento?.trim().toLowerCase()) ||
    changes(flags.numeroDocumento, file.numeroDocumento)
  );
}

/**
 * La cotizacion del archivo es de su moneda: la que dice o, si no, la extranjera de la config. Sin ninguna, nada la
 * contradice. Con `mismaMoneda` no se toca (con cotizacion es un error) y una moneda vacia no elige nada.
 */
function changesRateCurrency({ defaults, file, flags }: Levels): boolean {
  const configCurrency = isForeignCurrency({ currencyCode: defaults.defaultCurrencyCode })
    ? defaults.defaultCurrencyCode
    : undefined;
  const fileCurrency = file.codigoMoneda || configCurrency;

  return (
    file.cotizacionMoneda !== undefined &&
    (flags.mismaMoneda ?? file.mismaMoneda) !== true &&
    Boolean(flags.codigoMoneda?.trim()) &&
    fileCurrency !== undefined &&
    !isSameCurrency(flags.codigoMoneda ?? '', fileCurrency)
  );
}

/** Los flags dicen cual es el comprobante asociado; `--acuit` o `--afecha` solos, no. */
function identifiesAssociated({ comprobanteAsociado: voucher }: BillingJsonInput): boolean {
  return (
    voucher !== undefined &&
    [voucher.atajo, voucher.tipo, voucher.numero, voucher.puntoVenta].some((value) => value !== undefined)
  );
}

/** Que flag hace que cada dato del archivo no vaya. */
const DISCARDS: ReadonlyArray<readonly [when: (levels: Levels) => boolean, keys: readonly FileKey[]]> = [
  [changesReceiver, ['ivaReceptor', 'receptorDomicilio', 'receptorNombre']],
  [changesRateCurrency, ['cotizacionMoneda']],
  // Son opuestos: un flag elige uno y el otro del archivo no va.
  [({ flags }) => identifiesAssociated(flags), ['periodoAsociado']],
  [({ flags }) => flags.periodoAsociado !== undefined, ['comprobanteAsociado']],
  // Vacio no elige nada.
  [({ flags }) => Boolean(flags.vencimientoPago), ['dia']],
  [({ flags }) => flags.dia !== undefined, ['vencimientoPago']],
];

/**
 * Un flag que cambia a quien, que comprobante o que moneda descarta del archivo los datos que dependian del valor
 * anterior: despues se mezcla como si no estuvieran. Descartada la cotizacion del archivo va la oficial de ARCA, y no
 * la de la config (deprecada). El alias del CBU y los datos del asociado se deciden al mezclar.
 */
export function discardOverridden<T extends Levels>(levels: T): T {
  const discarded = new Set(DISCARDS.flatMap(([when, keys]) => (when(levels) ? keys : [])));
  const file = Object.fromEntries(
    Object.entries(levels.file).filter(([key]) => !discarded.has(key as FileKey)),
  ) as BillingJsonInput;
  const defaults = discarded.has('cotizacionMoneda')
    ? { ...levels.defaults, defaultExchangeRate: undefined }
    : levels.defaults;

  return { ...levels, defaults, file };
}
