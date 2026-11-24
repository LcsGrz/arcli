import { addDaysToArcaDate } from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { formatExchangeRate } from '../../lib/numbers/argentine-amount';

import { DEFAULT_EXCHANGE_RATE } from './billing.constants';
import type { BillingCommandInput } from './billing.schemas';
import { ARCA_CURRENCIES, ARCA_LOCAL_CURRENCY_CODE, resolveBillingCurrencyCode } from './currency-codes';

export interface BillingCurrencyFields {
  readonly CanMisMonExt?: 'N' | 'S';
  readonly MonCotiz: number;
  readonly MonId: string;
}

type CurrencyInput = Pick<BillingCommandInput, 'currencyCode' | 'exchangeRate' | 'sameCurrency'>;

export function isForeignCurrency(input: { readonly currencyCode?: string }): boolean {
  return resolveBillingCurrencyCode(input.currencyCode) !== ARCA_LOCAL_CURRENCY_CODE;
}

/**
 * La cotizacion de la config (`cotizacion`, deprecada) que toma un comprobante en `currencyCode` sin `--cm`: solo en
 * moneda extranjera y sin `--misma-moneda`. Si la config tiene otra moneda extranjera, la cotizacion es de esa: la de
 * USD no vale para EUR. Sin `config.moneda` (o en pesos) vale para cualquier extranjera. 1 es lo mismo que no tenerla.
 * Si devuelve `undefined`, BillingService.resolveExchangeRate consulta la oficial. La usan el CLI y el asistente.
 */
export function resolveConfigExchangeRate(options: {
  readonly configCurrencyCode?: string;
  readonly configExchangeRate?: number;
  readonly currencyCode?: string;
  readonly sameCurrency: boolean;
}): number | undefined {
  const { configCurrencyCode, configExchangeRate, currencyCode } = options;
  // Sin `config.moneda`, `isForeignCurrency` la toma como pesos.
  const isOtherConfigCurrency =
    isForeignCurrency({ currencyCode: configCurrencyCode }) &&
    resolveBillingCurrencyCode(currencyCode) !== resolveBillingCurrencyCode(configCurrencyCode);

  return options.sameCurrency ||
    !isForeignCurrency({ currencyCode }) ||
    isOtherConfigCurrency ||
    configExchangeRate === DEFAULT_EXCHANGE_RATE
    ? undefined
    : configExchangeRate;
}

/**
 * Con CanMisMonExt = S, ARCA exige la cotizacion oficial exacta (error 10038, WSFEv1 v4.7), asi que el CLI la consulta en lugar de
 * pedirsela al usuario. Sin --misma-moneda y sin --cm tambien se usa la oficial: es el default (REV-35).
 */
export function needsOfficialExchangeRate(input: CurrencyInput): boolean {
  return isForeignCurrency(input) && typeof input.exchangeRate !== 'number';
}

/**
 * El aviso de que la cotizacion oficial se tomo por defecto, igual en A, B y C y en la E, que en `detail` agrega que es
 * la de aduana y, si es de otro dia, de cual.
 */
export function officialExchangeRateWarning(options: {
  readonly code: string;
  readonly detail?: string;
  readonly rate: number;
}): string {
  return `Sin \`--cm\` se usa la cotización oficial de ARCA para ${options.code} (${formatExchangeRate(options.rate)})${options.detail ?? ''}. Para usar otra, \`--cotizacion-moneda\`.`;
}

/** Los avisos de de donde salio la cotizacion cuando no la indico el usuario. */
export function exchangeRateWarnings(
  input: Pick<BillingCommandInput, 'currencyCode' | 'exchangeRate' | 'exchangeRateSource'>,
): string[] {
  const code = input.currencyCode.trim().toUpperCase();
  const rate = typeof input.exchangeRate === 'number' ? formatExchangeRate(input.exchangeRate) : undefined;

  if (input.exchangeRateSource === 'config') {
    return [
      `La cotización de ${code} (${rate}) sale de la clave "cotizacion" de la config, que está deprecada y se va a sacar en la 3.0.0: una cotización guardada queda vieja. Pasá \`--cm\`, o borrala con \`arcli config eliminar cotizacion\` para usar la oficial de ARCA.`,
    ];
  }

  if (input.exchangeRateSource === 'arca') {
    return typeof input.exchangeRate === 'number'
      ? [officialExchangeRateWarning({ code, rate: input.exchangeRate })]
      : [];
  }

  return [];
}

/**
 * De que dia es la cotizacion oficial que va con `--misma-moneda`, segun la 10038 (WSFEv1 v4.7, p. 46): la del dia
 * habil anterior a la fecha del comprobante si esa fecha ya paso, y si no (hoy o futura) la del dia habil anterior a
 * hoy, que es la vigente. Devuelve el dia desde el que se busca hacia atras (`yyyymmdd`), o `undefined` para la
 * vigente.
 */
export function resolveSameCurrencyQuotationDate(billingDate: string, today: string): string | undefined {
  return billingDate < today ? addDaysToArcaDate(billingDate, -1) : undefined;
}

/**
 * ARCA 10119 (WSFEv1 v4.7, p. 57): en moneda extranjera la cotizacion no puede ser "inferior al 2% ni superior en un
 * 400%" de la oficial. ARCA testing lo confirma con 500 %: aprueba 4,99 veces la oficial y rechaza 5,01, y aprueba
 * el 2,1 % y rechaza el 1,9 % (18/11/2026).
 */
const EXCHANGE_RATE_LIMITS: ExchangeRateLimits = { maxRatio: 5, minRatio: 0.02 };

/** Entre que proporciones de la oficial acepta ARCA la cotizacion. */
interface ExchangeRateLimits {
  readonly maxRatio: number;
  readonly minRatio: number;
}

export function isExchangeRateInRange(rate: number, official: number, limits: ExchangeRateLimits): boolean {
  return rate >= official * limits.minRatio && rate <= official * limits.maxRatio;
}

/** Que cotizacion esta fuera de rango y cual es el rango. */
export function describeExchangeRateRange(options: {
  readonly code: string;
  readonly limits: ExchangeRateLimits;
  readonly official: number;
  readonly rate: number;
}): string {
  const { code, limits, official, rate } = options;

  return `La cotización de ${code} (${formatExchangeRate(rate)}) está fuera de lo que acepta ARCA: entre el ${limits.minRatio * 100} % y el ${limits.maxRatio * 100} % de la oficial (${formatExchangeRate(official)}), o sea de ${formatExchangeRate(official * limits.minRatio)} a ${formatExchangeRate(official * limits.maxRatio)}.`;
}

/** Que dato poner en la sugerencia cuando la cotizacion esta fuera de rango. */
function describeExchangeRateSource(input: Pick<BillingCommandInput, 'exchangeRateSource' | 'fromFile'>): string {
  if (input.exchangeRateSource === 'config') {
    return 'la clave `cotizacion` de la config (`arcli config eliminar cotizacion`)';
  }

  return input.fromFile?.includes('exchangeRate') ? '`"cotizacionMoneda"` del JSON de `--cargar`' : '`--cm`';
}

/**
 * Frena antes de ARCA una cotizacion fuera del rango de la 10119. `official` es la que devuelve
 * `FEParamGetCotizacion`. La cotizacion 1 en moneda extranjera tiene su propio error, mas claro
 * (`resolveBillingCurrencyFields`).
 */
export function validateExchangeRateRange(
  input: Pick<BillingCommandInput, 'currencyCode' | 'exchangeRate' | 'exchangeRateSource' | 'fromFile'>,
  official: number,
): void {
  const rate = input.exchangeRate;

  if (typeof rate !== 'number' || rate === DEFAULT_EXCHANGE_RATE || official <= 0) {
    return;
  }

  if (isExchangeRateInRange(rate, official, EXCHANGE_RATE_LIMITS)) {
    return;
  }

  const code = input.currencyCode.trim().toUpperCase();

  throw new InputValidationError(
    describeExchangeRateRange({ code, limits: EXCHANGE_RATE_LIMITS, official, rate }),
    undefined,
    `Revisá ${describeExchangeRateSource(input)}, o sacala para usar la oficial de ARCA.`,
  );
}

export function resolveBillingCurrencyFields(input: CurrencyInput): BillingCurrencyFields {
  const currencyCode = resolveBillingCurrencyCode(input.currencyCode);
  const inputCurrencyCode = input.currencyCode.trim().toUpperCase();

  if (currencyCode === ARCA_LOCAL_CURRENCY_CODE) {
    if (input.sameCurrency) {
      throw new InputValidationError('`--misma-moneda` solo aplica a comprobantes en moneda extranjera.');
    }

    if (typeof input.exchangeRate === 'number' && input.exchangeRate !== DEFAULT_EXCHANGE_RATE) {
      throw new InputValidationError(
        'En pesos la cotización tiene que ser 1. Sacá `--cotizacion-moneda` o usá `--cm 1`.',
      );
    }

    // ARCA rechaza CanMisMonExt cuando MonId = PES (error 10241, WSFEv1 v4.7); MonCotiz 1 en pesos es la 10039.
    return {
      MonCotiz: DEFAULT_EXCHANGE_RATE,
      MonId: currencyCode,
    };
  }

  if (input.sameCurrency) {
    // La de la fecha que pide la 10038 la completa BillingService.resolveExchangeRate antes de la vista previa.
    if (typeof input.exchangeRate !== 'number') {
      throw new InputValidationError(`No se pudo obtener la cotización oficial de ${inputCurrencyCode} desde ARCA.`);
    }

    return {
      CanMisMonExt: 'S',
      MonCotiz: input.exchangeRate,
      MonId: currencyCode,
    };
  }

  // 1 es la cotizacion del peso: en moneda extranjera es casi seguro un error de tipeo, y ARCA la rechaza.
  if (input.exchangeRate === DEFAULT_EXCHANGE_RATE) {
    throw new InputValidationError(
      `La cotización de ${inputCurrencyCode} no puede ser 1. Pasá la cotización real con \`--cm\`, o sacá \`--cm\` para usar la oficial de ARCA.`,
    );
  }

  if (typeof input.exchangeRate !== 'number') {
    throw new InputValidationError(
      `Falta la cotización de ${inputCurrencyCode}. Usá \`--cotizacion-moneda\` o \`--cm\`, o \`--misma-moneda\` si el pago se hace en ${inputCurrencyCode}.`,
    );
  }

  return {
    CanMisMonExt: 'N',
    MonCotiz: input.exchangeRate,
    MonId: currencyCode,
  };
}

/** Con que codigo rechaza ARCA una moneda que no esta en su tabla: `MonId` en WSFEv1 y `Moneda_Id` en WSFEX. */
export const UNKNOWN_CURRENCY_ERROR = { wsfe: 10_037, wsfex: 1590 } as const;

/** Que va en `--moneda` y donde ver las validas. `parametros monedas` es la tabla de wsfe: en la E, de la de WSFEX. */
function currencyCodeHint(options: { readonly service: 'wsfe' | 'wsfex'; readonly table: readonly string[] }): string {
  if (options.service === 'wsfe') {
    return 'va el código de ARCA, como `DOL` o `060`, o su ISO, como `USD` o `EUR`. Las monedas de ARCA están en `arcli parametros monedas`.';
  }

  const codes = new Set(options.table.map((entry) => entry.trim().toUpperCase()));
  const common = ARCA_CURRENCIES.filter((entry) => entry.iso && codes.has(entry.arca)).slice(0, 6);
  const list = common.map(({ arca, iso }) => `\`${arca}\` (${iso})`).join(', ');

  return `va el código de ARCA o su ISO.${list && ` Las más comunes de la E: ${list}.`}`;
}

/**
 * Una moneda que no esta en la tabla de ARCA es un error de entrada, igual en A, B, C y en la E: WSFEv1 la rechaza
 * al emitir con la 10037 y WSFEX con la 1590 (ARCA testing, 19/11/2026). `table` son los codigos de esa tabla; si
 * ARCA no la informo (vacia), no se controla y decide ARCA.
 */
export function assertCurrencyInTable(options: {
  readonly arcaCode: string;
  readonly requested: string;
  readonly service: keyof typeof UNKNOWN_CURRENCY_ERROR;
  readonly table: readonly string[];
}): void {
  const code = options.arcaCode.trim().toUpperCase();

  if (options.table.length === 0 || options.table.some((entry) => entry.trim().toUpperCase() === code)) {
    return;
  }

  throw new InputValidationError(
    `La moneda ${options.requested.trim().toUpperCase()} no está en la tabla de monedas de ARCA: la rechaza al emitir (error ${UNKNOWN_CURRENCY_ERROR[options.service]}).`,
    undefined,
    `Revisá \`--moneda\` (o \`codigoMoneda\` del JSON de \`--cargar\`): ${currencyCodeHint(options)}`,
  );
}
