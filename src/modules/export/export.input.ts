import { resolveRelativeDateInput } from '../../lib/dates/relative-date';
import { type AppError, InputValidationError } from '../../lib/errors/app-error';
import { resolveEmitDecision } from '../billing/billing.emit-decision';
import { formatVoucherWithArticle } from '../billing/voucher-names';
import { mergeAssociatedVoucher } from '../vouchers/associated-voucher.merge';

import { discardExportOverridden } from './export.input-overrides';
import { type ExportJsonInput, exportJsonInputWarnings, mapExportJsonItems } from './export.json-input';
import {
  EXPORT_VOUCHER_KIND,
  type ExportAssociatedVoucherInput,
  type ExportModeSource,
  type ExportVoucherInput,
  type ExportVoucherKind,
  getExportVoucherKindByShortcut,
  isExportNote,
} from './export.types';

const ITEMS_DESCRIPTION_WARNING =
  '`--descripcion` se usa solo cuando no hay `--item`: el detalle del comprobante sale de los items.';

/**
 * Lo escrito en los flags, con la forma del JSON de `--cargar`. Quien los lee detecta los incompatibles y los deja en
 * `errors` en lugar de tirarlos, para que salgan en su lugar entre los demás controles.
 */
export interface ExportFlags extends ExportJsonInput {
  readonly errors?: { readonly pdf?: AppError };
}

export interface ExportInputOptions {
  /** `output.emitirPorDefecto` de la config. */
  readonly defaultEmit?: boolean;
  /** El CUIT de la config, para saber si un asociado es propio. */
  readonly emitterCuit?: number;
  /** El comprobante de `--cargar`, ya validado con `readExportJsonInput`. */
  readonly file?: ExportJsonInput;
  /** Los arma el CLI, que controla las incompatibilidades (`errors`); HTTP y MCP mandan solo `file`. */
  readonly flags?: ExportFlags;
  /** La referencia de las fechas relativas. */
  readonly now: Date;
  /** Que E arma el comando. Sin esto, la factura. */
  readonly voucherKind?: ExportVoucherKind;
}

export interface ExportInputPlan {
  readonly input: ExportVoucherInput;
  /** De donde salio la decision de emitir: define si se pregunta antes de emitir. */
  readonly modeSource: ExportModeSource;
  /** Avisos de lo que trae el JSON de `--cargar`. */
  readonly warnings: readonly string[];
}

interface ExportInputLayers {
  readonly file: ExportJsonInput;
  readonly flags: ExportJsonInput;
}

/** El valor de una clave: el del flag o, si no, el del archivo. */
function written<K extends keyof ExportJsonInput>({ file, flags }: ExportInputLayers, key: K): ExportJsonInput[K] {
  return flags[key] ?? file[key];
}

/** En la factura, los flags del asociado no se usan y el del archivo es un error. */
function resolveExportAssociatedVoucher(
  layers: ExportInputLayers,
  voucherKind: ExportVoucherKind,
  now: Date,
  emitterCuit: number | undefined,
): ExportAssociatedVoucherInput | undefined {
  if (!isExportNote(voucherKind)) {
    if (layers.file.comprobanteAsociado) {
      throw new InputValidationError(
        'La factura E no lleva comprobante asociado: sacá "comprobanteAsociado" del JSON o usá `arcli nce` o `arcli nde`.',
      );
    }

    return undefined;
  }

  const fromFile = layers.file.comprobanteAsociado;
  const fromFlags = layers.flags.comprobanteAsociado;
  const merged = mergeAssociatedVoucher(fromFlags, fromFile, {
    arcaTypeOf: (shortcut) => getExportVoucherKindByShortcut(shortcut)?.arcaType,
    emitterCuit,
  });
  const voucher = merged.voucher ?? {};

  // Como en A, B, C y FCE: no se sabe de quien es, asi que no se toma el de la nota.
  if (merged.ownerUnknown && voucher.numero !== undefined && voucher.puntoVenta === undefined) {
    throw new InputValidationError(
      `Falta el punto de venta del comprobante asociado de ${formatVoucherWithArticle(voucherKind)}. Usá \`--apv <número>\`.`,
    );
  }

  return {
    arcaType: voucher.tipo,
    cuit: voucher.cuit,
    // En la E la fecha sale de ARCA: la del archivo se conserva siempre, para avisar que no se usa.
    date: resolveRelativeDateInput(fromFlags?.fecha ?? fromFile?.fecha, 'day', now),
    number: voucher.numero,
    pointOfSale: voucher.puntoVenta,
    shortcut: voucher.atajo,
  };
}

/** La descripción con ítems no se usa. Si la descripción o los ítems vinieron del JSON, nombra sus claves. */
function itemsDescriptionWarnings(layers: ExportInputLayers): string[] {
  const { flags } = layers;

  if (!written(layers, 'descripcion')?.trim() || !written(layers, 'items')?.length) {
    return [];
  }

  if (flags.descripcion !== undefined && flags.items !== undefined) {
    return [ITEMS_DESCRIPTION_WARNING];
  }

  const description =
    flags.descripcion === undefined ? 'La clave "descripcion" del JSON de `--cargar`' : '`--descripcion`';
  const items = flags.items === undefined ? '"items"' : '`--item`';

  return [`${description} se usa solo cuando no hay ${items}: el detalle del comprobante sale de los ítems.`];
}

/**
 * La entrada de una E: mezcla flags, archivo y config, igual que en A, B y C. Los valores los valida `ExportService`,
 * vengan de donde vengan. El orden de los controles decide qué error sale cuando hay más de uno.
 */
export function resolveExportInput({
  defaultEmit,
  emitterCuit,
  file = {},
  flags = {},
  now,
  voucherKind = EXPORT_VOUCHER_KIND,
}: ExportInputOptions): ExportInputPlan {
  const layers: ExportInputLayers = discardExportOverridden({ file, flags, voucherKind });
  // Las fechas relativas (`hoy`, `+10`...) se resuelven aca, para flags y `--cargar`. En la E todas son de un dia.
  const day = (value: string | undefined) => resolveRelativeDateInput(value, 'day', now);
  const { emit, source: modeSource } = resolveEmitDecision({
    bothFlagsMessage: 'Usá `--emitir` o `--previsualizar`, no los dos.',
    defaultEmit,
    file,
    flags,
  });

  if (flags.errors?.pdf) {
    throw flags.errors.pdf;
  }

  const associatedVoucher = resolveExportAssociatedVoucher(layers, voucherKind, now, emitterCuit);

  return {
    input: {
      activity: written(layers, 'actividad'),
      // `monto` es la clave deprecada.
      amount: written(layers, 'montoTotal') ?? written(layers, 'monto'),
      associatedVoucher,
      clientAddress: written(layers, 'domicilioCliente'),
      clientCountryCuit: written(layers, 'cuitPais'),
      clientName: written(layers, 'cliente'),
      clientTaxId: written(layers, 'idImpositivo'),
      commercialObservations: written(layers, 'observacionesComerciales'),
      currencyCode: written(layers, 'codigoMoneda'),
      description: written(layers, 'descripcion'),
      destinationCountry: written(layers, 'paisDestino')?.toString(),
      emit,
      exchangeRate: written(layers, 'cotizacionMoneda'),
      exportType: written(layers, 'tipoExpo'),
      incoterm: written(layers, 'incoterm'),
      incotermDescription: written(layers, 'descripcionIncoterm'),
      items: mapExportJsonItems(written(layers, 'items')),
      language: written(layers, 'idioma'),
      modeSource,
      observations: written(layers, 'observaciones'),
      paymentDate: day(written(layers, 'fechaPago')),
      paymentTerms: written(layers, 'formaPago'),
      pdf: written(layers, 'pdf'),
      permits: written(layers, 'permisos')?.slice(),
      permitsExisting: written(layers, 'permisoExistente'),
      pointOfSale: written(layers, 'puntoVenta'),
      requestId: written(layers, 'idSolicitud'),
      sameCurrency: written(layers, 'mismaMoneda'),
      voucherDate: day(written(layers, 'fechaComprobante')),
      voucherKind,
      voucherNumber: written(layers, 'numero'),
    },
    modeSource,
    warnings: [...exportJsonInputWarnings(file), ...itemsDescriptionWarnings(layers)],
  };
}
