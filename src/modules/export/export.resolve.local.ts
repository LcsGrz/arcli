import {
  formatArcaDateAsArgentineDate,
  formatDateAsArcaDate,
  parseArgentineDateInputAsArcaDate,
} from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { AMOUNT_DECIMALS, hasAtMostDecimals } from '../../lib/numbers/argentine-amount';
import { assertRules } from '../../lib/rules/rules';
import type { ArcliConfig } from '../config/config.schemas';

import { resolveExportType } from './export.catalogs';
import { resolveExportVoucherDate } from './export.dates';
import { assertExportIncoterm } from './export.incoterm';
import { assertExportItemsTotal, assertExportItemTexts } from './export.items';
import { type ExportVoucherKind, isExportNote } from './export.kinds';
import { applyExportAssociatedDefaults, assertExportNoteFields } from './export.notes';
import { resolveExportPointOfSale } from './export.numbering';
import type { ResolvedAssociatedVoucher } from './export.resolve.associated';
import { EXPORT_DATE_RULES } from './export.rules';
import { assertExportTextLengths } from './export.text-fields';
import type { ExportType, ExportVoucherInput } from './export.types';

/**
 * Lo que hay que validar antes de tocar la red: un flag que falta no tiene por que autenticar en WSAA. En las notas,
 * cliente, domicilio, destino y actividad pueden salir del asociado, asi que se validan despues de consultarlo.
 */
export function assertExportLocalFields(input: ExportVoucherInput, kind: ExportVoucherKind): void {
  if (typeof input.amount !== 'number' || !(input.amount > 0)) {
    throw new InputValidationError('Falta el monto total o no es válido. Usá `--monto`.');
  }

  // Como en A, B y C: con mas decimales se redondearia en silencio y el total no coincidiria con el item.
  if (!hasAtMostDecimals(input.amount, AMOUNT_DECIMALS)) {
    throw new InputValidationError(`El monto total no puede tener más de ${AMOUNT_DECIMALS} decimales.`);
  }

  if (isExportNote(kind)) {
    assertExportNoteFields(input, kind);
  }

  assertExportTextLengths(input);
  assertExportItemTexts(input.items);
  assertExportItemsTotal(input.items, input.amount);
}

/**
 * Lo que pide la factura (y la nota, ya completada con su asociado) antes de consultar las tablas. La actividad no:
 * `Actividades` no es obligatorio en WSFEX v3.1.0 (la 2100 solo prohibe el bloque vacio).
 */
function assertRequiredFields(input: ExportVoucherInput): void {
  if (!input.clientName?.trim()) {
    throw new InputValidationError('Falta el nombre del cliente. Usá `--cliente`.');
  }

  if (!input.clientAddress?.trim()) {
    throw new InputValidationError('Falta el domicilio del cliente. Usá `--domicilio-cliente`.');
  }

  if (!input.destinationCountry?.trim()) {
    throw new InputValidationError('Falta el país de destino. Usá `--pais-destino`.');
  }
}

/** El pedido completo, hasta donde se resuelve sin las tablas de WSFEX. */
export interface ExportRequest {
  /** La de la entrada o la de la config. */
  readonly activityCode: number | undefined;
  readonly associated: ResolvedAssociatedVoucher | undefined;
  readonly exportType: ExportType;
  /** La entrada, completada con el asociado si es una nota. */
  readonly input: ExportVoucherInput;
  readonly paymentDate: string;
  readonly pointOfSale: number;
  /** La entrada como se escribio, sin lo del asociado. */
  readonly rawInput: ExportVoucherInput;
  readonly today: string;
  readonly voucherDate: string;
  readonly voucherKind: ExportVoucherKind;
}

/** Completa la entrada con el asociado y valida todo lo que no necesita las tablas. */
export function resolveExportRequest(options: {
  readonly associated: ResolvedAssociatedVoucher | undefined;
  readonly config: ArcliConfig;
  readonly now: Date;
  readonly rawInput: ExportVoucherInput;
  readonly voucherKind: ExportVoucherKind;
}): ExportRequest {
  const { associated, config, now, rawInput, voucherKind } = options;
  const today = formatDateAsArcaDate(now);
  const input = associated ? applyExportAssociatedDefaults(rawInput, associated.voucher) : rawInput;
  const activityCode = input.activity ?? config.exportacion?.actividad;

  assertRequiredFields(input);

  const exportType = resolveExportType(input.exportType);
  const voucherDate = resolveExportVoucherDate(input.voucherDate, now);
  const paymentDate = input.paymentDate?.trim()
    ? parseArgentineDateInputAsArcaDate(input.paymentDate, now)
    : voucherDate;

  // 1500 y 1674, con las fechas ya resueltas: las mismas reglas que el asistente al preguntarlas.
  assertRules(
    EXPORT_DATE_RULES,
    {
      exportType,
      paymentDate: formatArcaDateAsArgentineDate(paymentDate),
      voucherDate: formatArcaDateAsArgentineDate(voucherDate),
      voucherKind,
    },
    { today },
  );
  assertExportIncoterm({
    exportType,
    incoterm: input.incoterm,
    incotermDescription: input.incotermDescription,
    isNote: isExportNote(voucherKind),
  });

  // La ultima de las locales, antes de consultar las tablas (ERR-11). En una nota con asociado ya se valido al buscarlo.
  const pointOfSale = resolveExportPointOfSale(input.pointOfSale, config);

  return {
    activityCode,
    associated,
    exportType,
    input,
    paymentDate,
    pointOfSale,
    rawInput,
    today,
    voucherDate,
    voucherKind,
  };
}
