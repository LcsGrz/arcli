import { InputValidationError } from '../../lib/errors/app-error';
import { formatExchangeRate } from '../../lib/numbers/argentine-amount';

import { DEFAULT_EXCHANGE_RATE } from './billing.constants';
import { resolveBillingCurrencyCode } from './billing.mappers';
import type { BillingCommandInput } from './billing.schemas';

export const ARCA_LOCAL_CURRENCY_CODE = 'PES';

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
 * Con CanMisMonExt = S, ARCA exige la cotizacion oficial exacta (error 10038), asi que el CLI la consulta en lugar de
 * pedirsela al usuario. Sin --misma-moneda y sin --cm tambien se usa la oficial: es el default (REV-35).
 */
export function needsOfficialExchangeRate(input: CurrencyInput): boolean {
  return isForeignCurrency(input) && typeof input.exchangeRate !== 'number';
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
    return [
      `Sin \`--cm\` se usa la cotización oficial de ARCA para ${code} (${rate}). Para usar otra, \`--cotizacion-moneda\`.`,
    ];
  }

  return [];
}

export function resolveBillingCurrencyFields(
  input: CurrencyInput,
  billingDate: string,
  today: string,
): BillingCurrencyFields {
  const currencyCode = resolveBillingCurrencyCode(input.currencyCode);
  const inputCurrencyCode = input.currencyCode.trim().toUpperCase();

  if (currencyCode === ARCA_LOCAL_CURRENCY_CODE) {
    if (input.sameCurrency) {
      throw new InputValidationError('--misma-moneda solo aplica a comprobantes en moneda extranjera.');
    }

    if (typeof input.exchangeRate === 'number' && input.exchangeRate !== DEFAULT_EXCHANGE_RATE) {
      throw new InputValidationError(
        'En pesos la cotización tiene que ser 1. Sacá `--cotizacion-moneda` o usá `--cm 1`.',
      );
    }

    // ARCA rechaza CanMisMonExt cuando MonId = PES (error 10241).
    return {
      MonCotiz: DEFAULT_EXCHANGE_RATE,
      MonId: currencyCode,
    };
  }

  if (input.sameCurrency) {
    // ARCA exige la cotizacion oficial del dia del comprobante (10038): la de un dia pasado no se puede consultar y
    // la de uno futuro todavia no existe.
    if (billingDate !== today) {
      throw new InputValidationError(
        'Con `--misma-moneda` la fecha del comprobante tiene que ser la de hoy: ARCA exige la cotización oficial de ese día y solo se puede consultar la vigente. Sacá `--fecha` para emitir con la de hoy.',
      );
    }

    if (typeof input.exchangeRate !== 'number') {
      throw new InputValidationError(`No se pudo obtener la cotización oficial de ${inputCurrencyCode} desde ARCA.`);
    }

    return {
      CanMisMonExt: 'S',
      MonCotiz: input.exchangeRate,
      MonId: currencyCode,
    };
  }

  if (typeof input.exchangeRate !== 'number' || input.exchangeRate === DEFAULT_EXCHANGE_RATE) {
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
