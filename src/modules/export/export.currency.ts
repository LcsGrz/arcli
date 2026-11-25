import { addDaysToArcaDate, formatArcaDateAsArgentineDate, minArcaDate } from '../../lib/dates/arca-date';
import { AppError, InputValidationError } from '../../lib/errors/app-error';
import { assertRules } from '../../lib/rules/rules';
import { ARCA_LOCAL_CURRENCY_CODE, resolveBillingCurrencyCode } from '../billing/currency-codes';

import type { ExportRule } from './export.rule-types';
import {
  DEFAULT_EXPORT_CURRENCY_CODE,
  type ExportCurrencyResolution,
  type ExportQuotation,
  type ExportType,
  type ExportVoucherInput,
  SERVICES_EXPORT_TYPE,
} from './export.types';

/** ARCA no acepta cotizaciones en pesos distintas de 1. */
const LOCAL_EXCHANGE_RATE = 1;

/**
 * La cotizacion escrita (`--cotizacion-moneda`): en pesos, 1; en moneda extranjera, mayor a 0 (errores 1600 y 1602,
 * WSFEX v3.1.0). Hay monedas que valen menos de un peso, como el guarani o el peso colombiano, y una nota sobre una
 * factura en esas monedas hereda su cotizacion. Que en pesos tenga que ser 1 es de ARCA: no acepta otra.
 */
export const EXPORT_EXCHANGE_RATE_RULE: ExportRule = {
  check: (input) => {
    const rate = input.exchangeRate;

    if (typeof rate !== 'number') {
      return undefined;
    }

    const requested = input.currencyCode?.trim() || DEFAULT_EXPORT_CURRENCY_CODE;

    if (resolveBillingCurrencyCode(requested) === ARCA_LOCAL_CURRENCY_CODE) {
      return rate === LOCAL_EXCHANGE_RATE
        ? undefined
        : {
            message: 'En pesos la cotización tiene que ser 1. Sacá `--cotizacion-moneda` o usá `--cm 1`.',
            question: 'En pesos la cotización tiene que ser 1.',
          };
    }

    return rate > 0 ? undefined : `La cotización de ${requested.toUpperCase()} tiene que ser mayor a 0.`;
  },
  fields: ['exchangeRate'],
  id: 'export-exchange-rate',
};

/**
 * Acepta `ARS`, `USD` o los codigos de ARCA (`PES`, `DOL`). Sin `--moneda` la exportacion va en dolares; la moneda
 * de la config es la de los comprobantes locales. Sin `--cotizacion-moneda` se usa la de aduana que publica ARCA
 * (WSFEX no acepta `Moneda_ctz` en 0): la clave `cotizacion` de la config no aplica, porque una cotizacion guardada
 * queda vieja en dias (REV-35).
 */
export function resolveExportCurrency(
  input: Pick<ExportVoucherInput, 'currencyCode' | 'exchangeRate' | 'sameCurrency'>,
): ExportCurrencyResolution {
  const requested = input.currencyCode?.trim() || DEFAULT_EXPORT_CURRENCY_CODE;
  const currencyCode = resolveBillingCurrencyCode(requested);

  if (currencyCode === ARCA_LOCAL_CURRENCY_CODE) {
    if (input.sameCurrency) {
      throw new InputValidationError('`--misma-moneda` solo aplica a comprobantes en moneda extranjera.');
    }

    assertRules([EXPORT_EXCHANGE_RATE_RULE], input, {});

    // Con la E en pesos ARCA pide que `CanMisMonExt` no se informe (error 1605): testing lo acepta, produccion no.
    return {
      fields: { Moneda_ctz: LOCAL_EXCHANGE_RATE, Moneda_Id: currencyCode },
      needsQuotation: false,
    };
  }

  const rate = input.exchangeRate;

  assertRules([EXPORT_EXCHANGE_RATE_RULE], input, {});

  return {
    fields: {
      CanMisMonExt: input.sameCurrency ? 'S' : 'N',
      Moneda_ctz: rate ?? 0,
      Moneda_Id: currencyCode,
    },
    needsQuotation: rate === undefined,
  };
}

/** De que dia se pide la cotizacion de aduana y por que. */
export interface ExportQuotationDate {
  /** Fecha ARCA (yyyymmdd) con la que se consulta `FEXGetPARAM_MON_CON_COTIZACION`. */
  readonly date: string;
  /**
   * `previous-business-day`: ARCA exige la del dia habil anterior (servicios, error 2053, o pago en la misma moneda);
   * `voucher-date`: la de la fecha del comprobante, o la ultima publicada antes.
   */
  readonly rule: 'previous-business-day' | 'voucher-date';
}

/**
 * La fecha de la cotizacion que exige ARCA. En la factura de servicios en moneda extranjera tiene que ser la del dia
 * habil anterior a la fecha de emision, o a la de la solicitud si la factura es posterior (error 2053). Con el pago
 * en la misma moneda (`CanMisMonExt` en `S`), lo mismo, por el historial 3.0.0 del manual. Se consulta el dia
 * anterior y WSFEX devuelve la ultima publicada hasta ese dia, que en un lunes o despues de un feriado es la del
 * ultimo dia habil. Las notas heredan la cotizacion del asociado (2053) y bienes y otros siguen con la del dia.
 * Con fecha futura (1500 la acepta hasta 5 dias) no hay cotizacion de ese dia: se toma la de hoy o, en servicios y con
 * `--misma-moneda`, la del dia habil anterior a hoy, como pide el manual (2053 e historial 3.0.0).
 */
export function resolveExportQuotationDate(options: {
  readonly exportType: ExportType;
  readonly isNote: boolean;
  readonly sameCurrency: boolean;
  readonly today: string;
  readonly voucherDate: string;
}): ExportQuotationDate {
  const { exportType, isNote, sameCurrency, today, voucherDate } = options;
  const reference = minArcaDate(voucherDate, today);

  if (isNote || (exportType !== SERVICES_EXPORT_TYPE && !sameCurrency)) {
    return { date: reference, rule: 'voucher-date' };
  }

  return { date: addDaysToArcaDate(reference, -1), rule: 'previous-business-day' };
}

/**
 * La cotizacion de aduana de la fecha del comprobante. WSFEX devuelve por moneda la ultima publicada, asi que el
 * dia en curso —que todavia no tiene— o un fin de semana traen la anterior. Sin fila para la moneda no hay
 * cotizacion que usar: es error, salvo que el usuario la informe con `--cotizacion-moneda`.
 */
export function resolveExportQuotation(
  currencyCode: string,
  quotations: readonly ExportQuotation[],
  voucherDate: string,
): ExportQuotation {
  const code = currencyCode.trim().toUpperCase();
  const quotation = quotations.find((entry) => entry.code.trim().toUpperCase() === code);

  if (quotation) {
    return quotation;
  }

  const available = quotations.map((entry) => entry.code).join(', ');

  throw new AppError(
    `ARCA no informó la cotización de ${code} para el ${formatArcaDateAsArgentineDate(voucherDate)}.${
      available ? ` Las monedas con cotización son ${available}.` : ''
    } Informá la cotización con \`--cotizacion-moneda\`.`,
    { code: 'ARCA_QUOTATION_ERROR', details: { errores: [] } },
  );
}
