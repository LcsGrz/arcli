import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { formatExchangeRate } from '../../lib/numbers/argentine-amount';
import { formatMoneyLabel } from '../billing/billing.labels';
import { formatVoucherSubject, formatVoucherWithArticle } from '../billing/billing.mappers';
import { formatVoucherNumber } from '../vouchers/voucher-history.presenter';

import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
  EXPORT_VOUCHER_KINDS,
  type ExportAssociatedVoucherInput,
  type ExportIssuedVoucher,
  type ExportVoucherInput,
  type ExportVoucherKind,
  type ExportVoucherQuery,
  getExportVoucherKindByArcaType,
  getExportVoucherKindByShortcut,
} from './export.types';

/** Servicios: el tipo de exportacion en el que ARCA compara la nota contra el asociado (errores 2048 a 2055). */
const SERVICES_EXPORT_TYPE = 2;

const ASSOCIATED_SHORTCUTS = EXPORT_VOUCHER_KINDS.map((kind) => `\`${kind.shortcut}\``)
  .join(', ')
  .replace(/, ([^,]+)$/, ' o $1');

/** `la factura de exportación E 00003-00000012`, para usar dentro de una frase. */
function describeVoucher(voucher: {
  readonly arcaType: number;
  readonly number: number;
  readonly pointOfSale: number;
}) {
  const kind = getExportVoucherKindByArcaType(voucher.arcaType);
  const name = kind ? formatVoucherWithArticle(kind) : `el comprobante tipo ${voucher.arcaType}`;

  return `${name} ${formatVoucherNumber(voucher.pointOfSale, voucher.number)}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** El tipo del asociado por atajo (`--ac fe`) o por codigo (`--at 19`). Sin ninguno, la factura E. */
function resolveAssociatedKind(input: ExportAssociatedVoucherInput | undefined): ExportVoucherKind {
  const byShortcut = input?.shortcut ? getExportVoucherKindByShortcut(input.shortcut) : undefined;
  const byType = input?.arcaType === undefined ? undefined : getExportVoucherKindByArcaType(input.arcaType);

  if (input?.shortcut && !byShortcut) {
    throw new InputValidationError(
      `El comprobante asociado de una nota E tiene que ser otro comprobante E: usá ${ASSOCIATED_SHORTCUTS} en \`--ac\`, no "${input.shortcut}".`,
    );
  }

  if (input?.arcaType !== undefined && !byType) {
    throw new InputValidationError(
      `El comprobante asociado de una nota E tiene que ser otro comprobante E: \`--at\` acepta 19, 20 o 21, no ${input.arcaType}.`,
    );
  }

  if (byShortcut && byType && byShortcut !== byType) {
    throw new InputValidationError(
      `El atajo "${byShortcut.shortcut}" es el tipo ${byShortcut.arcaType}, no el ${byType.arcaType}. Usá uno solo para el comprobante asociado.`,
    );
  }

  return byShortcut ?? byType ?? EXPORT_VOUCHER_KIND;
}

/**
 * Que comprobante consultar en ARCA. Sin `--ac` es una factura E y sin `--apv`, del punto de venta de la nota. El
 * asociado de una E es siempre del propio emisor (error 2031), asi que `--acuit` solo puede repetir ese CUIT.
 */
export function resolveExportAssociatedQuery(options: {
  readonly emitterCuit?: string;
  readonly input?: ExportAssociatedVoucherInput;
  readonly kind: ExportVoucherKind;
  readonly pointOfSale: number;
}): ExportVoucherQuery {
  const { emitterCuit, input, kind } = options;
  const associatedKind = resolveAssociatedKind(input);

  if (input?.number === undefined) {
    throw new InputValidationError(
      `Falta el número del comprobante asociado: ${formatVoucherWithArticle(kind)} ajusta una factura E. Usá \`--ar <número>\` (y \`--apv\` si es de otro punto de venta).`,
    );
  }

  if (!Number.isInteger(input.number) || input.number < 1) {
    throw new InputValidationError('El número del comprobante asociado tiene que ser un número entero positivo.');
  }

  const pointOfSale = input.pointOfSale ?? options.pointOfSale;

  if (!Number.isInteger(pointOfSale) || pointOfSale < 1) {
    throw new InputValidationError(
      'El punto de venta del comprobante asociado tiene que ser un número entero positivo.',
    );
  }

  if (input.cuit !== undefined && emitterCuit !== undefined && input.cuit.replace(/\D/g, '') !== emitterCuit) {
    throw new InputValidationError(
      `En las notas E el comprobante asociado tiene que ser tuyo (CUIT ${emitterCuit}): ARCA rechaza otro CUIT (error 2031). Sacá \`--acuit\`.`,
    );
  }

  return { arcaType: associatedKind.arcaType, number: input.number, pointOfSale };
}

/** Avisos de lo que trae el asociado y no se usa. */
export function exportAssociatedVoucherWarnings(input: ExportAssociatedVoucherInput | undefined): string[] {
  return input?.date ? ['En las notas E la fecha del comprobante asociado sale de ARCA: `--afecha` no se usa.'] : [];
}

/**
 * Lo que la factura no comparte con las notas: ARCA rechaza en una nota la fecha de pago (1673), `CanMisMonExt`
 * (1605) y `Permiso_existente` distinto de vacio (1550). Los permisos de embarque si van, opcionales, en las notas de
 * bienes: se informan sin `--permiso-existente` (ver `buildExportPayload`).
 */
export function assertExportNoteFields(input: ExportVoucherInput, kind: ExportVoucherKind): void {
  const subject = formatVoucherSubject(kind);

  if (input.paymentDate?.trim()) {
    throw new InputValidationError(
      `${subject} no lleva fecha de pago: ARCA la rechaza (error 1673). Sacá \`--fecha-pago\`.`,
    );
  }

  if (input.sameCurrency) {
    throw new InputValidationError(
      `${subject} no lleva \`--misma-moneda\`: ARCA solo lo acepta en la factura (error 1605).`,
    );
  }

  if (input.permitsExisting) {
    throw new InputValidationError(
      `${subject} no lleva \`--permiso-existente\`: ARCA pide ese campo vacío en las notas (error 1550). Los permisos de embarque van solos, con \`--permiso\`.`,
    );
  }
}

/**
 * Los datos de la nota que faltan salen del asociado: cliente, domicilio, destino, CUIT del pais, ID impositivo,
 * tipo de exportacion, moneda y cotizacion, idioma, incoterm, forma de pago y actividad. Lo que vino por flag gana.
 * La cotizacion del asociado solo se toma si la moneda es la misma: en servicios ARCA exige esa (error 2053).
 */
export function applyExportAssociatedDefaults(
  input: ExportVoucherInput,
  associated: ExportIssuedVoucher,
): ExportVoucherInput {
  const currencyCode = input.currencyCode ?? associated.currencyCode;
  const sameCurrency = currencyCode.trim().toUpperCase() === associated.currencyCode.trim().toUpperCase();

  return {
    ...input,
    activity: input.activity ?? associated.activities[0],
    clientAddress: input.clientAddress ?? associated.clientAddress,
    clientCountryCuit: input.clientCountryCuit ?? associated.clientCountryCuit,
    clientName: input.clientName ?? associated.clientName,
    clientTaxId: input.clientTaxId ?? associated.clientTaxId,
    currencyCode,
    destinationCountry: input.destinationCountry ?? String(associated.destinationCountry),
    exchangeRate:
      input.exchangeRate ?? (sameCurrency && associated.exchangeRate > 0 ? associated.exchangeRate : undefined),
    exportType: input.exportType ?? associated.exportType,
    incoterm: input.incoterm ?? associated.incoterm,
    incotermDescription: input.incotermDescription ?? associated.incotermDescription,
    language: input.language ?? associated.language,
    paymentTerms: input.paymentTerms ?? associated.paymentTerms,
  };
}

/**
 * Lo que ARCA va a controlar contra el asociado, validado antes de emitir. En servicios (tipo 2) ARCA pide el mismo
 * tipo, destino y moneda (o pesos), la misma cotizacion y una fecha igual o posterior (2049 a 2053); una ND solo
 * ajusta una factura (2041, 2042) y una NC, una factura o una ND (2045). La fecha y el tope de la NC valen para todos
 * los tipos: una nota anterior al comprobante que ajusta, o una NC mayor, no tienen sentido.
 */
export function assertExportNoteMatchesAssociated(options: {
  readonly associated: ExportIssuedVoucher;
  readonly kind: ExportVoucherKind;
  readonly note: {
    readonly amount: number;
    readonly currencyCode: string;
    readonly date: string;
    readonly destinationCountry: number;
    readonly exchangeRate: number;
    readonly exportType: number;
  };
}): void {
  const { associated, kind, note } = options;
  const label = describeVoucher(associated);

  if (associated.result && associated.result !== 'A') {
    throw new InputValidationError(
      `${capitalize(label)} no está autorizada en ARCA: una nota E solo ajusta comprobantes aprobados.`,
    );
  }

  if (note.date < associated.date) {
    throw new InputValidationError(
      `La fecha de ${formatVoucherWithArticle(kind)} (${formatArcaDateAsArgentineDate(note.date)}) no puede ser anterior a la de ${label} (${formatArcaDateAsArgentineDate(associated.date)}).`,
    );
  }

  const sameCurrency = note.currencyCode.trim().toUpperCase() === associated.currencyCode.trim().toUpperCase();

  if (kind === EXPORT_CREDIT_NOTE_KIND && associated.arcaType !== EXPORT_CREDIT_NOTE_KIND.arcaType && sameCurrency) {
    if (note.amount > associated.total) {
      throw new InputValidationError(
        `La nota de crédito (${formatMoneyLabel(note.amount, note.currencyCode)}) no puede superar el total de ${label} (${formatMoneyLabel(associated.total, associated.currencyCode)}).`,
      );
    }
  }

  const isServices = note.exportType === SERVICES_EXPORT_TYPE || associated.exportType === SERVICES_EXPORT_TYPE;

  if (!isServices) {
    return;
  }

  if (note.exportType !== associated.exportType) {
    throw new InputValidationError(
      `${capitalize(label)} es de tipo de exportación ${associated.exportType}: en servicios la nota tiene que ser del mismo tipo (error 2049). Sacá \`--tipo-expo\`.`,
    );
  }

  if (kind === EXPORT_DEBIT_NOTE_KIND && associated.arcaType !== EXPORT_VOUCHER_KIND.arcaType) {
    throw new InputValidationError(
      `En servicios una nota de débito E solo ajusta una factura E, no ${label} (errores 2041 y 2042). Usá \`--ac fe\`.`,
    );
  }

  if (kind === EXPORT_CREDIT_NOTE_KIND && associated.arcaType === EXPORT_CREDIT_NOTE_KIND.arcaType) {
    throw new InputValidationError(
      `En servicios una nota de crédito E ajusta una factura o una nota de débito E, no otra nota de crédito (error 2045).`,
    );
  }

  if (
    kind === EXPORT_CREDIT_NOTE_KIND &&
    associated.arcaType === EXPORT_DEBIT_NOTE_KIND.arcaType &&
    associated.associatedVoucher !== undefined &&
    associated.associatedVoucher.arcaType !== EXPORT_VOUCHER_KIND.arcaType
  ) {
    throw new InputValidationError(
      `${capitalize(label)} no ajusta una factura E: ARCA no acepta notas sobre ella (error 2055).`,
    );
  }

  if (note.destinationCountry !== associated.destinationCountry) {
    throw new InputValidationError(
      `En servicios el país de destino tiene que ser el de ${label} (${associated.destinationCountry}): ARCA rechaza otro (error 2050). Sacá \`--pais-destino\`.`,
    );
  }

  if (!sameCurrency && note.currencyCode.trim().toUpperCase() !== 'PES') {
    throw new InputValidationError(
      `En servicios la nota va en la moneda de ${label} (${associated.currencyCode}) o en pesos: ARCA rechaza otra (error 2051).`,
    );
  }

  if (sameCurrency && note.exchangeRate !== associated.exchangeRate) {
    throw new InputValidationError(
      `En servicios la cotización tiene que ser la de ${label} (${formatExchangeRate(associated.exchangeRate)}): ARCA rechaza otra (error 2053). Sacá \`--cotizacion-moneda\`.`,
    );
  }
}

/** El asociado no existe en ARCA. */
export function missingExportAssociatedVoucherError(query: ExportVoucherQuery): InputValidationError {
  return new InputValidationError(
    `ARCA no tiene ${describeVoucher(query)}. Revisá \`--ar\`, \`--apv\` y \`--ac\`: el asociado tiene que estar emitido por WSFEX.`,
  );
}
