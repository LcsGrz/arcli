import { addDaysToArcaDate, formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { formatExchangeRate } from '../../lib/numbers/argentine-amount';
import {
  assertCurrencyInTable,
  describeExchangeRateRange,
  isExchangeRateInRange,
  officialExchangeRateWarning,
} from '../billing/billing.currency';
import { ARCA_LOCAL_CURRENCY_CODE } from '../billing/currency-codes';

import {
  type ExportQuotationDate,
  resolveExportCurrency,
  resolveExportQuotation,
  resolveExportQuotationDate,
} from './export.currency';
import type { ExportPreviewGateway } from './export.gateway';
import { isExportNote } from './export.kinds';
import type { ExportRequest } from './export.resolve.local';
import { describeQueryFailure, type ExportTableReader } from './export.tables';
import { type ExportQuotation, type ExportType, SERVICES_EXPORT_TYPE } from './export.types';

/**
 * En la factura de servicios en moneda extranjera ARCA exige exactamente la cotizacion de aduana del dia habil anterior
 * (2053, WSFEX v3.1.0), y con `--misma-moneda`, la oficial de ese dia (historial 3.0.0 y 1604). Una
 * `--cotizacion-moneda` distinta sale rechazada: se compara con la de ARCA y se frena antes. Si ARCA no informa la
 * moneda, no hay contra que comparar y sigue.
 */
function assertExportExchangeRateMatches(options: {
  readonly exportType: ExportType;
  readonly given: number;
  readonly official: ExportQuotation | undefined;
}): void {
  const { given, official } = options;

  if (!official || official.rate === given) {
    return;
  }

  const subject =
    options.exportType === SERVICES_EXPORT_TYPE
      ? 'En servicios ARCA exige la cotización de aduana'
      : 'Con `--misma-moneda` ARCA exige la cotización oficial';
  const code = options.exportType === SERVICES_EXPORT_TYPE ? 2053 : 1604;
  const day = official.date ? ` del ${formatArcaDateAsArgentineDate(official.date)}` : '';

  throw new InputValidationError(
    `${subject} de ${official.code} del día hábil anterior, ${formatExchangeRate(official.rate)}${day}, y \`--cotizacion-moneda\` es ${formatExchangeRate(given)}: ARCA la rechaza (error ${code}). Sacá \`--cotizacion-moneda\` y ARCLI usa la de ARCA.`,
  );
}

/**
 * De donde salio la cotizacion sin `--cotizacion-moneda`. En servicios y con el pago en la misma moneda es obligatoria
 * la del dia habil anterior, asi que solo se avisa si ese dia no hubo (un fin de semana o un feriado) y va la ultima
 * que publico ARCA. En el resto es un default y se avisa siempre, como en A, B y C: con el dia, si ARCA no publico la
 * del dia que se pidio.
 */
function exportQuotationWarnings(options: {
  readonly currencyCode: string;
  readonly exportType: ExportType;
  readonly quotation: ExportQuotation;
  readonly quotationDate: ExportQuotationDate;
  readonly voucherDate: string;
}): string[] {
  const { currencyCode, exportType, quotation, quotationDate, voucherDate } = options;
  const asked = formatArcaDateAsArgentineDate(quotationDate.date);
  const otherDay =
    quotation.date && quotation.date !== quotationDate.date ? formatArcaDateAsArgentineDate(quotation.date) : undefined;

  if (quotationDate.rule === 'voucher-date') {
    return [
      officialExchangeRateWarning({
        code: currencyCode,
        detail: otherDay ? `, la de aduana del ${otherDay}: ARCA no publicó la del ${asked}` : ', la de aduana',
        rate: quotation.rate,
      }),
    ];
  }

  if (!otherDay) {
    return [];
  }

  const subject = exportType === SERVICES_EXPORT_TYPE ? 'En servicios' : 'Con `--misma-moneda`';
  const used = `la del ${otherDay} (${formatExchangeRate(quotation.rate)})`;

  return [
    `${subject} ARCA exige la cotización de ${quotation.code} del día hábil anterior a ${quotationDate.date < addDaysToArcaDate(voucherDate, -1) ? 'hoy, porque la fecha del comprobante es futura' : 'la fecha del comprobante'} (error 2053): se usa ${used}, la última que publicó hasta el ${asked}.`,
  ];
}

/**
 * 1667 (WSFEX v3.1.0, p. 19), solo en la factura: la cotizacion va "entre el 2% y el 400% de la oficial" (citado en TEST-8), y no hasta
 * "superior en un 400%" como la 10119: por eso no comparte su maximo. Solo avisa: en testing no se puede probar, porque
 * sus cotizaciones son ficticias.
 */
const EXPORT_EXCHANGE_RATE_LIMITS = { maxRatio: 4, minRatio: 0.02 } as const;

/**
 * Lo que tiene la cotizacion escrita contra la oficial. En servicios y con `--misma-moneda` tiene que ser la de ARCA y
 * frena; en bienes y otros avisa si esta fuera de rango. Si ARCA no la informa, decide al emitir.
 */
async function checkWrittenExchangeRate(options: {
  readonly code: string;
  readonly exportType: ExportType;
  readonly gateway: Pick<ExportPreviewGateway, 'getQuotations'>;
  readonly quotationDate: ExportQuotationDate;
  readonly rate: number;
  readonly tables: ExportTableReader;
}): Promise<string[]> {
  const { exportType, gateway, quotationDate, rate, tables } = options;
  const code = options.code.trim().toUpperCase();
  const table = await tables.read(() => gateway.getQuotations(quotationDate.date));
  const official = table.rows.find((entry) => entry.code.trim().toUpperCase() === code);

  if (quotationDate.rule === 'previous-business-day') {
    assertExportExchangeRateMatches({ exportType, given: rate, official });

    return table.ok
      ? []
      : [
          `No se pudo comparar la cotización con la de ARCA (${describeQueryFailure(table.error)}): la rechaza si no es la oficial del día hábil anterior (error ${exportType === SERVICES_EXPORT_TYPE ? 2053 : 1604}).`,
        ];
  }

  return official && !isExchangeRateInRange(rate, official.rate, EXPORT_EXCHANGE_RATE_LIMITS)
    ? [
        `${describeExchangeRateRange({ code, limits: EXPORT_EXCHANGE_RATE_LIMITS, official: official.rate, rate, source: 'lo que dice el manual de ARCA' })} ARCA la puede rechazar (error 1667): revisá \`--cm\`.`,
      ]
    : [];
}

/** La moneda, contra su tabla, y su cotizacion: la de ARCA o la escrita, comparada. */
export async function resolveExportMoney(options: {
  readonly gateway: ExportPreviewGateway;
  readonly request: ExportRequest;
  readonly tables: ExportTableReader;
}) {
  const { gateway, request, tables } = options;
  const { exportType, input, today, voucherDate, voucherKind } = request;
  const currency = resolveExportCurrency(input);
  // Se consulta siempre: la vista previa muestra el nombre de la moneda. Una extranjera que no esta en la tabla es
  // error de entrada (1590), antes de buscar su cotizacion; los pesos no se controlan.
  const currencyTable = await tables.read(() => gateway.getCurrencies());
  const isLocalCurrency = currency.fields.Moneda_Id === ARCA_LOCAL_CURRENCY_CODE;
  const requestedCurrency = input.currencyCode?.trim() || currency.fields.Moneda_Id;

  assertCurrencyInTable({
    arcaCode: currency.fields.Moneda_Id,
    requested: requestedCurrency,
    service: 'wsfex',
    table: isLocalCurrency ? [] : currencyTable.rows.map((entry) => entry.code),
  });
  const quotationDate = resolveExportQuotationDate({
    exportType,
    isNote: isExportNote(voucherKind),
    sameCurrency: currency.fields.CanMisMonExt === 'S',
    today,
    voucherDate,
  });
  const quotation = currency.needsQuotation
    ? resolveExportQuotation(
        currency.fields.Moneda_Id,
        await gateway.getQuotations(quotationDate.date),
        quotationDate.date,
      )
    : undefined;

  // `--cotizacion-moneda`: en servicios o con `--misma-moneda` tiene que ser la de ARCA (2053, 1604), y en bienes y
  // otros se avisa si esta fuera de rango (1667). Solo en la factura: la de una nota, heredada
  // del asociado o escrita con `--cm`, no se compara.
  const exchangeRateWarnings =
    currency.needsQuotation || isLocalCurrency || isExportNote(voucherKind)
      ? []
      : await checkWrittenExchangeRate({
          code: currency.fields.Moneda_Id,
          exportType,
          gateway,
          quotationDate,
          rate: currency.fields.Moneda_ctz,
          tables,
        });
  const exchangeRate = quotation?.rate ?? currency.fields.Moneda_ctz;

  return {
    currency: {
      ...currency.fields,
      Moneda_Id: quotation?.code ?? currency.fields.Moneda_Id,
      Moneda_ctz: exchangeRate,
    },
    currencyTable,
    exchangeRateWarnings,
    isLocalCurrency,
    officialQuotation: quotation !== undefined,
    quotationWarnings: quotation
      ? exportQuotationWarnings({
          // El codigo como se escribio, como en A, B y C.
          currencyCode: requestedCurrency.toUpperCase(),
          exportType,
          quotation,
          quotationDate,
          voucherDate,
        })
      : [],
    requestedCurrency,
  };
}
