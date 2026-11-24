import Big from 'big.js';

import type { DateInputRole } from '../../lib/dates/date-input-text';
import { resolveRelativeDateInput } from '../../lib/dates/relative-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { mergeAssociatedVoucher } from '../vouchers/associated-voucher.merge';

import { resolveConfigExchangeRate } from './billing.currency';
import { type BillingDefaults, isSameCbu, savedCbuAlias } from './billing.defaults';
import { missingIvaReceiverMessage } from './billing.iva-receptor';
import type { BillingJsonInput } from './billing.json-input';
import type { BillingCommandInput } from './billing.schemas';
import type { VoucherShortcut } from './billing.types';
import { discriminatesIva, getVoucherKindByShortcut, isFceInvoice } from './voucher-kind-map';

/**
 * Los niveles de los que sale un comprobante: los flags ganan al archivo de `--cargar` y el archivo, a la config. Cada
 * función de acá resuelve un grupo de datos relacionados; los valores los valida después `billingCommandSchema`.
 */
export interface BillingInputLayers {
  readonly defaults: BillingDefaults;
  readonly file: BillingJsonInput;
  readonly flags: BillingJsonInput;
  /** La referencia de las fechas relativas. */
  readonly now: Date;
  readonly shortcut: VoucherShortcut;
}

/** El valor de una clave que no se relaciona con otras: el del flag o, si no, el del archivo. */
export function written<K extends keyof BillingJsonInput>(
  { file, flags }: BillingInputLayers,
  key: K,
): BillingJsonInput[K] {
  return flags[key] ?? file[key];
}

/**
 * Las fechas relativas (`hoy`, `+10`, `mes-pasado`...) se resuelven una vez, para flags y `--cargar`: cada campo dice si
 * es un dia o una punta de un rango. Lo que sigue (validaciones, vista previa, `--json`) ve la fecha resuelta.
 */
export function writtenDate(
  layers: BillingInputLayers,
  key: 'fechaComprobante' | 'servicioDesde' | 'servicioHasta' | 'vencimientoPago',
  role: DateInputRole,
): string | undefined {
  return resolveRelativeDateInput(written(layers, key), role, layers.now);
}

export function resolveConcept(layers: BillingInputLayers): string {
  const concept = written(layers, 'concepto') ?? layers.defaults.defaultConcept;

  if (!concept) {
    throw new InputValidationError(
      'Falta el concepto. Usá `--concepto <tipo>`, o bien `--cs`/`--cp`/`--csp`, o configurá uno por defecto con `arcli config establecer concepto servicios`.',
    );
  }

  return concept;
}

/**
 * Sin definir es explicito: asi la entrada que arma el CLI es igual a la del modo interactivo. Con
 * consultarPadron=false el IVA de la config tambien es definitivo: 'default' haria consultar el padron igual.
 */
function ivaConditionSource(
  explicit: string | undefined,
  resolved: string | undefined,
  defaults: BillingDefaults,
): BillingCommandInput['ivaConditionSource'] {
  if (explicit) {
    return undefined;
  }

  if (!resolved) {
    return 'missing';
  }

  return defaults.lookupIvaConditionInPadron === true ? 'default' : undefined;
}

export function resolveReceiver(layers: BillingInputLayers) {
  const { defaults } = layers;
  const documentType = written(layers, 'tipoDocumento');
  // Sin documento el receptor solo puede ser consumidor final: --cfinal le gana al IVA de la config, no a un --ir.
  const explicit =
    written(layers, 'ivaReceptor') ?? (documentType === 'consumidor-final' ? 'consumidor-final' : undefined);
  const willLookupPadron = !explicit && defaults.lookupIvaConditionInPadron === true && documentType === 'cuit';
  const ivaCondition = explicit ?? defaults.defaultIvaCondition;

  if (!ivaCondition && !willLookupPadron) {
    throw new InputValidationError(missingIvaReceiverMessage());
  }

  return {
    documentNumber: written(layers, 'numeroDocumento'),
    documentType,
    // Sin valor todavia: lo completa el padron antes de emitir (ver `ivaConditionSource`).
    ivaCondition: ivaCondition ?? 'consumidor-final',
    ivaConditionSource: ivaConditionSource(explicit, ivaCondition, defaults),
    receiverAddress: written(layers, 'receptorDomicilio'),
    receiverName: written(layers, 'receptorNombre'),
  };
}

export function resolveCurrency(layers: BillingInputLayers) {
  const { defaults, file, flags } = layers;
  const currencyCode = written(layers, 'codigoMoneda') ?? defaults.defaultCurrencyCode;
  // Un flag pisa lo del archivo: --cm descarta "mismaMoneda" del JSON y --misma-moneda, su "cotizacionMoneda".
  const sameCurrency = flags.mismaMoneda ?? (flags.cotizacionMoneda === undefined && file.mismaMoneda === true);
  const explicitRate = flags.cotizacionMoneda ?? (flags.mismaMoneda === true ? undefined : file.cotizacionMoneda);

  // Quien arma los flags no deja pasar los dos juntos, asi que las dos claves vienen del JSON.
  if (sameCurrency && explicitRate !== undefined) {
    throw new InputValidationError(
      'Con `"mismaMoneda": true` la cotización se toma de ARCA. Sacá `"cotizacionMoneda"` del JSON de `--cargar`.',
    );
  }

  if (explicitRate !== undefined) {
    return { currencyCode, exchangeRate: explicitRate, exchangeRateSource: undefined, sameCurrency };
  }

  // La cotizacion por defecto de la config (deprecada), si aplica a esta moneda: la misma regla que el asistente.
  const exchangeRate = resolveConfigExchangeRate({
    configCurrencyCode: defaults.defaultCurrencyCode,
    configExchangeRate: defaults.defaultExchangeRate,
    currencyCode,
    sameCurrency,
  });

  return {
    currencyCode,
    exchangeRate,
    exchangeRateSource: exchangeRate === undefined ? undefined : 'config',
    sameCurrency,
  };
}

export function resolveAssociatedPeriod({ file, flags, now }: BillingInputLayers) {
  const fromFlags = flags.periodoAsociado;
  const fromFile = file.periodoAsociado;

  if (!fromFlags && !fromFile) {
    return undefined;
  }

  // Campo por campo, como el comprobante asociado; una punta vacia no pisa la del archivo.
  return {
    desde: resolveRelativeDateInput(fromFlags?.desde || fromFile?.desde, 'from', now),
    hasta: resolveRelativeDateInput(fromFlags?.hasta || fromFile?.hasta, 'to', now),
  };
}

export function resolveAssociatedVoucher({ file, flags, now }: BillingInputLayers) {
  const voucher = mergeAssociatedVoucher(
    flags.comprobanteAsociado,
    file.comprobanteAsociado,
    (shortcut) => getVoucherKindByShortcut(shortcut.trim().toLowerCase())?.arcaType,
  );

  return (
    voucher && {
      cuit: voucher.cuit,
      fecha: resolveRelativeDateInput(voucher.fecha, 'day', now),
      numero: voucher.numero,
      puntoVenta: voucher.puntoVenta,
      shortcut: voucher.atajo,
      tipo: voucher.tipo,
    }
  );
}

/** Total de un comprobante con varias alicuotas, sumado con Big: 100.1 + 200.2 da 300.3, no 300.29999999999995. */
function sumRateAmounts(
  rateAmounts: NonNullable<BillingJsonInput['alicuotas']>,
  exemptAmount: number | undefined,
  untaxedAmount: number | undefined,
): number {
  return rateAmounts
    .reduce((sum, item) => sum.plus(item.monto), new Big(0))
    .plus(exemptAmount ?? 0)
    .plus(untaxedAmount ?? 0)
    .toNumber();
}

/** La C no discrimina IVA: la alicuota de la config solo aplica a A y B. */
function defaultIvaRateFor({ defaults, shortcut }: BillingInputLayers): BillingDefaults['defaultIvaRate'] {
  const voucherKind = getVoucherKindByShortcut(shortcut);

  return !voucherKind || discriminatesIva(voucherKind.letter) ? defaults.defaultIvaRate : undefined;
}

export function resolveAmounts(layers: BillingInputLayers) {
  const { file, flags } = layers;
  // --alicuota TASA tambien pisa las "alicuotas" del archivo.
  const rateAmounts = flags.alicuotas ?? (flags.alicuotaIva ? undefined : file.alicuotas);
  // En el archivo, un 0 es "no hay" (un JSON generado suele traer los ceros); con el flag sigue siendo error.
  const exemptAmount = flags.importeExento ?? (file.importeExento || undefined);
  const untaxedAmount = flags.importeNoGravado ?? (file.importeNoGravado || undefined);
  // Sin redondear: un monto con mas de 2 decimales es un error del schema, no se ajusta en silencio.
  const totalAmount = written(layers, 'montoTotal');

  if (!rateAmounts) {
    const ivaRate = written(layers, 'alicuotaIva') ?? defaultIvaRateFor(layers);

    return { exemptAmount, ivaRate, totalAmount, untaxedAmount };
  }

  return {
    exemptAmount,
    ivaRateAmounts: rateAmounts.map(({ monto, tasa }) => ({ amount: monto, rate: tasa })),
    // Con varias alicuotas el monto total se puede omitir: es la suma de cada una mas exento y no gravado.
    totalAmount: totalAmount ?? sumRateAmounts(rateAmounts, exemptAmount, untaxedAmount),
    untaxedAmount,
  };
}

export function resolveFceFields(layers: BillingInputLayers) {
  const { defaults, file, flags, shortcut } = layers;
  // El CBU de la config solo aplica a facturas FCE: ARCA rechaza esos opcionales en otros comprobantes (10169).
  const fceDefaults = isFceInvoice(getVoucherKindByShortcut(shortcut)) ? defaults : undefined;
  const cbu = written(layers, 'cbu') ?? fceDefaults?.defaultCbu;
  // El alias del archivo es del CBU que trae, si trae uno.
  const fileAlias = file.cbu === undefined || isSameCbu(file.cbu, cbu) ? file.aliasCbu : undefined;

  return {
    cancellation: written(layers, 'anulacion') === true,
    cbu,
    cbuAlias: flags.aliasCbu ?? fileAlias ?? (fceDefaults && savedCbuAlias(fceDefaults, cbu)),
    transferMode: written(layers, 'transferencia'),
  };
}

type FileField = NonNullable<BillingCommandInput['fromFile']>[number];

const FILE_FIELD_KEYS: Readonly<Record<FileField, keyof BillingJsonInput>> = {
  dueDay: 'dia',
  exchangeRate: 'cotizacionMoneda',
  pdfDescription: 'descripcion',
  receiverAddress: 'receptorDomicilio',
  receiverName: 'receptorNombre',
  saleCondition: 'condicionVenta',
};

/** Los datos que avisan algo y salieron del archivo: estan en el JSON y no hay flag que los pise. */
export function resolveFileFields({ file, flags }: BillingInputLayers): FileField[] | undefined {
  // --misma-moneda tambien descarta la cotizacion del archivo.
  const isOverridden = (key: keyof BillingJsonInput) =>
    flags[key] !== undefined || (key === 'cotizacionMoneda' && flags.mismaMoneda === true);

  const fields = (Object.keys(FILE_FIELD_KEYS) as FileField[]).filter((field) => {
    const key = FILE_FIELD_KEYS[field];

    return !isOverridden(key) && file[key] !== undefined && file[key] !== null;
  });

  return fields.length > 0 ? fields : undefined;
}
