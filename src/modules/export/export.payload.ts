import { InputValidationError } from '../../lib/errors/app-error';
import { roundToCents } from '../../lib/numbers/argentine-amount';

import { exportTypeTakesPaymentDate } from './export.dates';
import { type ExportVoucherKind, isExportNote } from './export.kinds';
import { requireText } from './export.text-fields';
import {
  EXPORT_TYPES,
  EXPORT_TYPES_WITHOUT_PERMITS,
  type ExportAssociatedVoucherPayload,
  type ExportCountry,
  type ExportCurrencyResolution,
  type ExportIncoterm,
  type ExportItemPayload,
  type ExportType,
  type ExportVoucherInput,
  type ExportVoucherPayload,
  SERVICES_EXPORT_TYPE,
} from './export.types';

/** Forma de pago por defecto: WSFEX la exige y casi todas las exportaciones se cobran por transferencia internacional. */
export const DEFAULT_EXPORT_PAYMENT_TERMS = 'Transferencia Internacional';

/**
 * Las formas de cobro mas comunes de una exportacion, para sugerir en el asistente (TUI-26). ARCA toma `Forma_pago`
 * como texto libre: son sugerencias, cualquier otro texto de hasta 50 caracteres vale igual. La de por defecto va
 * primera.
 */
export const EXPORT_PAYMENT_TERMS_SUGGESTIONS: readonly string[] = [
  DEFAULT_EXPORT_PAYMENT_TERMS,
  'Pago anticipado',
  'Carta de crédito',
  'Cobranza documentaria',
  'Cuenta corriente',
];

export interface BuildExportResolution {
  /** Sin actividad no va el bloque `Actividades` (no es obligatorio; vacio es el error 2100). */
  readonly activity?: number;
  /** Solo en las notas: va en `Cmps_asoc`. */
  readonly associatedVoucher?: ExportAssociatedVoucherPayload;
  /** Sin CUIT del pais la E va solo con el ID impositivo (error 1580). */
  readonly clientCountryCuit?: number;
  readonly currency: ExportCurrencyResolution['fields'];
  readonly destinationCountry: ExportCountry;
  readonly exportType: ExportType;
  readonly incoterm?: ExportIncoterm;
  readonly items: readonly ExportItemPayload[];
  readonly languageId: number;
  readonly paymentDate: string;
  readonly pointOfSale: number;
  readonly requestId: number;
  readonly voucherDate: string;
  readonly voucherKind: ExportVoucherKind;
  readonly voucherNumber: number;
}

/** En los tipos 2 (servicios) y 4 (otros) ARCA exige `Permiso_existente` vacio, no `N` (error 1550, WSFEX v3.1.0). */
function requiresEmptyPermitsExisting(exportType: ExportType): boolean {
  return EXPORT_TYPES_WITHOUT_PERMITS.includes(exportType);
}

/**
 * Con `Permiso_existente = N` ARCA rechaza el campo `Permisos` (error 1720), y en los tipos 2 y 4 pide el campo
 * vacio y no admite permisos (error 1550): sin permisos no se manda. En las notas de bienes los permisos son
 * opcionales y van con `Permiso_existente` vacio (tabla de la 1720), asi que no piden `--permiso-existente`.
 */
function resolvePermits(
  input: ExportVoucherInput,
  destinationCountry: number,
  exportType: ExportType,
  isNote: boolean,
): ExportVoucherPayload['Permisos'] {
  const permits = (input.permits ?? []).map((permit) => permit.trim()).filter(Boolean);

  if (permits.length === 0) {
    if (input.permitsExisting) {
      throw new InputValidationError('`--permiso-existente` pide al menos un permiso de embarque. Usá `--permiso`.');
    }

    return undefined;
  }

  if (requiresEmptyPermitsExisting(exportType)) {
    throw new InputValidationError(
      `El tipo de exportación ${exportType} (${EXPORT_TYPES[exportType]}) no lleva permisos de embarque: ARCA exige Permiso_existente vacío (error 1550). Quitá \`--permiso\`.`,
    );
  }

  if (!isNote && !input.permitsExisting) {
    throw new InputValidationError(
      'Los permisos de embarque van con `--permiso-existente`: ARCA necesita saber que el permiso ya existe.',
    );
  }

  return { Permiso: [...new Set(permits)].map((id) => ({ Dst_merc: destinationCountry, Id_permiso: id })) };
}

/**
 * Arma el `Cmp` de `FEXAuthorize` con los datos ya resueltos contra las tablas de ARCA.
 *
 * Los bloques vacios no van: `Permisos` sin permisos (error 1720), `Cmps_asoc` sin filas (error 1820) y
 * `Actividades` sin actividad (error 2100). ARCLI no manda `Opcionales`. Las notas llevan `Cmps_asoc` y
 * `Permiso_existente` vacio (1550), y no llevan `Fecha_pago` (1673) ni `CanMisMonExt` (1605). La factura de bienes
 * tampoco lleva `Fecha_pago` (1673): solo va en servicios y otros. La factura en pesos no lleva `CanMisMonExt` (1605).
 */
export function buildExportPayload(input: ExportVoucherInput, resolution: BuildExportResolution): ExportVoucherPayload {
  const clientName = requireText(input.clientName, 'el nombre del cliente', '`--cliente`');
  const clientAddress = requireText(input.clientAddress, 'el domicilio del cliente', '`--domicilio-cliente`');

  if (typeof input.amount !== 'number' || !(input.amount > 0)) {
    throw new InputValidationError('Falta el importe total o no es válido. Usá `--monto`.');
  }

  const isNote = isExportNote(resolution.voucherKind);

  // 2047 (WSFEX v3.1.0): el asociado solo es obligatorio en las notas de servicios.
  if (isNote && !resolution.associatedVoucher && resolution.exportType === SERVICES_EXPORT_TYPE) {
    throw new InputValidationError('Falta el comprobante asociado de la nota de servicios (error 2047). Usá `--ar`.');
  }

  const permits = resolvePermits(input, resolution.destinationCountry.code, resolution.exportType, isNote);
  /** En notas, servicios y otros ARCA pide el campo vacio; en el resto, `N` sin permisos y `S` con permisos. */
  const permitsExisting: ExportVoucherPayload['Permiso_existente'] =
    isNote || requiresEmptyPermitsExisting(resolution.exportType) ? '' : input.permitsExisting ? 'S' : 'N';

  return {
    // Sin actividad el bloque no va: vacio, ARCA contesta 2100.
    ...(resolution.activity === undefined ? {} : { Actividades: { Actividad: [{ Id: resolution.activity }] } }),
    ...(isNote || !resolution.currency.CanMisMonExt ? {} : { CanMisMonExt: resolution.currency.CanMisMonExt }),
    Cbte_nro: resolution.voucherNumber,
    Cbte_Tipo: resolution.voucherKind.arcaType,
    Cliente: clientName,
    ...(resolution.associatedVoucher ? { Cmps_asoc: { Cmp_asoc: [resolution.associatedVoucher] } } : {}),
    ...(resolution.clientCountryCuit === undefined ? {} : { Cuit_pais_cliente: resolution.clientCountryCuit }),
    Domicilio_cliente: clientAddress,
    Dst_cmp: resolution.destinationCountry.code,
    Fecha_cbte: resolution.voucherDate,
    ...(exportTypeTakesPaymentDate(resolution.exportType, isNote) ? { Fecha_pago: resolution.paymentDate } : {}),
    Forma_pago: input.paymentTerms?.trim() || DEFAULT_EXPORT_PAYMENT_TERMS,
    Id: resolution.requestId,
    Id_impositivo: input.clientTaxId?.trim() ?? '',
    Idioma_cbte: resolution.languageId,
    Imp_total: roundToCents(input.amount),
    Incoterms: resolution.incoterm?.code ?? '',
    Incoterms_Ds: input.incotermDescription?.trim() || resolution.incoterm?.name || '',
    Items: { Item: [...resolution.items] },
    Moneda_ctz: resolution.currency.Moneda_ctz,
    Moneda_Id: resolution.currency.Moneda_Id,
    Obs: input.observations?.trim() ?? '',
    Obs_comerciales: input.commercialObservations?.trim() ?? '',
    Permiso_existente: permitsExisting,
    ...(permits ? { Permisos: permits } : {}),
    Punto_vta: resolution.pointOfSale,
    Tipo_expo: resolution.exportType,
  };
}
