import { futureDateWarnings } from '../billing/billing.dates';
import { formatNextVouchers } from '../billing/voucher-names';

import { exportEmptyTableWarning } from './export.catalogs';
import { exportTypeTakesPaymentDate } from './export.dates';
import { isExportNote } from './export.kinds';
import { exportAssociatedVoucherWarnings } from './export.notes';
import type { checkExportPermits } from './export.permits';
import { describeAssociated } from './export.resolve.associated';
import type { resolveExportMoney } from './export.resolve.currency';
import type { ExportRequest } from './export.resolve.local';
import type { resolveExportActivityCode, resolveExportCatalogs } from './export.resolve.tables';
import { unreadExportTableWarnings } from './export.tables';
import {
  DEFAULT_EXPORT_UNIT_CODE,
  type ExportCountry,
  type ExportDisplayInfo,
  type ExportVoucherInput,
  type ExportVoucherPayload,
} from './export.types';

/** Lo que dejo cada paso de la resolucion. */
interface ExportResolution {
  readonly activities: Awaited<ReturnType<typeof resolveExportActivityCode>>;
  readonly catalogs: Awaited<ReturnType<typeof resolveExportCatalogs>>;
  readonly destinationCountry: ExportCountry;
  readonly money: Awaited<ReturnType<typeof resolveExportMoney>>;
  readonly payload: ExportVoucherPayload;
  readonly permitChecks: Awaited<ReturnType<typeof checkExportPermits>>;
  readonly request: ExportRequest;
}

/** Las unidades escritas por codigo, que hay que validar (la de por defecto no), para su aviso. */
function describeWrittenUnits(input: ExportVoucherInput): string | undefined {
  const codes = new Set((input.items ?? []).map(({ unit }) => unit ?? DEFAULT_EXPORT_UNIT_CODE));

  codes.delete(DEFAULT_EXPORT_UNIT_CODE);

  return codes.size > 0 ? `${codes.size === 1 ? 'la unidad' : 'las unidades'} ${[...codes].join(', ')}` : undefined;
}

/** Los nombres de las tablas para mostrar. */
export function buildExportDisplay(resolution: ExportResolution): ExportDisplayInfo {
  const { catalogs, destinationCountry, money, payload, permitChecks, request } = resolution;
  const { clientCountryCuit, countryCuitTable, incoterm, languageId, languageTable, unitTable } = catalogs;
  const { associated } = request;
  const { currencyTable } = money;
  const currencyCode = payload.Moneda_Id.trim().toUpperCase();

  return {
    ...(associated ? { associatedVoucher: describeAssociated(associated.voucher) } : {}),
    countryCuitName:
      clientCountryCuit === undefined
        ? undefined
        : countryCuitTable.rows.find((entry) => entry.cuit === clientCountryCuit)?.countryName,
    countryName: destinationCountry.name,
    currencyName: currencyTable.rows.find((entry) => entry.code.trim().toUpperCase() === currencyCode)?.name,
    incotermName: incoterm?.name,
    languageName: languageTable.rows.find((language) => language.id === languageId)?.name,
    ...(permitChecks ? { permitChecks: permitChecks.checks } : {}),
    unitNames: Object.fromEntries(unitTable.rows.map((unit) => [unit.id, unit.name])),
  };
}

/** Los avisos de la resolucion, en su orden. */
export function buildExportWarnings(resolution: ExportResolution): string[] {
  const { activities, catalogs, money, permitChecks, request } = resolution;
  const { activity, activityTable } = activities;
  const { clientCountryCuit, countryCuitTable, incoterm, incotermTable, languageId, languageTable, unitTable } =
    catalogs;
  const {
    currencyTable,
    exchangeRateWarnings,
    isLocalCurrency,
    officialQuotation,
    quotationWarnings,
    requestedCurrency,
  } = money;
  const { associated, exportType, input, pointOfSale, rawInput, today, voucherDate, voucherKind } = request;

  // La cotizacion de aduana del dia se publica mas tarde: se emite con la ultima disponible, avisando de que dia es.
  return [
    // En las notas `--fecha-pago` es un error (ver `assertExportNoteFields`); en la factura de bienes se ignora.
    ...(!isExportNote(voucherKind) && input.paymentDate?.trim() && !exportTypeTakesPaymentDate(exportType, false)
      ? [
          'La factura E de bienes (`--tipo-expo 1`) no lleva fecha de pago: ARCA la rechaza (error 1673). `--fecha-pago` no se usa.',
        ]
      : []),
    ...quotationWarnings,
    ...exchangeRateWarnings,
    ...exportAssociatedVoucherWarnings(rawInput.associatedVoucher),
    ...futureDateWarnings({
      code: 1535,
      next: formatNextVouchers(voucherKind),
      pointOfSale,
      today,
      voucherDate,
    }),
    ...(permitChecks?.warnings ?? []),
    // "Sin validar" es solo lo que se escribio: lo heredado del asociado ya lo autorizo ARCA.
    ...unreadExportTableWarnings(
      countryCuitTable,
      'CUIT de países',
      rawInput.clientCountryCuit === undefined ? undefined : `el CUIT de país ${clientCountryCuit}`,
    ),
    ...unreadExportTableWarnings(unitTable, 'unidades de medida', describeWrittenUnits(input)),
    ...(incoterm && incotermTable
      ? unreadExportTableWarnings(
          incotermTable,
          'incoterms',
          rawInput.incoterm?.trim() ? `el incoterm ${incoterm.code}` : undefined,
        )
      : []),
    ...unreadExportTableWarnings(
      languageTable,
      'idiomas',
      rawInput.language === undefined ? undefined : `el idioma ${languageId}`,
    ),
    // Con la cotizacion de ARCA, la moneda ya se encontro en su tabla de cotizaciones.
    ...unreadExportTableWarnings(
      currencyTable,
      'monedas',
      isLocalCurrency || officialQuotation || (associated && !rawInput.currencyCode?.trim())
        ? undefined
        : `la moneda ${requestedCurrency.toUpperCase()}`,
    ),
    ...(activity !== undefined && activityTable && input.activity === rawInput.activity
      ? unreadExportTableWarnings(activityTable, 'actividades', `la actividad ${activity}`)
      : []),
    ...(activity !== undefined && activityTable?.ok && activityTable.rows.length === 0
      ? [exportEmptyTableWarning('actividades', activity)]
      : []),
    ...(incoterm && incotermTable?.ok && incotermTable.rows.length === 0
      ? [exportEmptyTableWarning('incoterms', incoterm.code)]
      : []),
  ];
}
