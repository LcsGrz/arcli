import type { Command } from 'commander';

import { resolveRelativeDateInput } from '../../lib/dates/relative-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { readJsonFile } from '../../lib/files/read-json-file';
import {
  exportJsonInputWarnings,
  mapExportJsonItems,
  readExportJsonInput,
} from '../../modules/export/export.json-input';
import {
  EXPORT_VOUCHER_KIND,
  type ExportAssociatedVoucherInput,
  type ExportItemInput,
  type ExportModeSource,
  type ExportType,
  type ExportVoucherInput,
  type ExportVoucherKind,
  isExportNote,
} from '../../modules/export/export.types';

export const ITEMS_DESCRIPTION_WARNING =
  '`--descripcion` se usa solo cuando no hay `--item`: el detalle del comprobante sale de los items.';

/** `--descripcion` con ítems no se usa. Si la descripción o los ítems vinieron del JSON, nombra sus claves. */
function itemsDescriptionWarnings(options: {
  readonly descriptionFromFile: boolean;
  readonly hasDescription: boolean;
  readonly hasItems: boolean;
  readonly itemsFromFile: boolean;
}): string[] {
  if (!options.hasDescription || !options.hasItems) {
    return [];
  }

  if (!options.descriptionFromFile && !options.itemsFromFile) {
    return [ITEMS_DESCRIPTION_WARNING];
  }

  const description = options.descriptionFromFile ? 'La clave "descripcion" del JSON de `--cargar`' : '`--descripcion`';
  const items = options.itemsFromFile ? '"items"' : '`--item`';

  return [`${description} se usa solo cuando no hay ${items}: el detalle del comprobante sale de los ítems.`];
}

export interface ExportCommandPlan {
  readonly input: ExportVoucherInput;
  /** De donde salio la decision de emitir: define si se pregunta antes de emitir. */
  readonly modeSource: ExportModeSource;
  /** Avisos de lo que trae el JSON de `--cargar`. */
  readonly warnings: readonly string[];
}

export interface ExportCommandDefaults {
  /** `output.emitirPorDefecto` de la config. */
  readonly defaultEmit?: boolean;
  /** Que E arma el comando. Sin esto, la factura. */
  readonly voucherKind?: ExportVoucherKind;
}

function pickString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string');
}

function pickNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === 'number');
}

function pickBoolean(...values: unknown[]): boolean | undefined {
  return values.find((value): value is boolean => typeof value === 'boolean');
}

function pickItems(flagsValue: unknown, fileItems: ExportItemInput[] | undefined): ExportItemInput[] | undefined {
  return Array.isArray(flagsValue) && flagsValue.length > 0 ? (flagsValue as ExportItemInput[]) : fileItems;
}

function pickList(flagsValue: unknown, fileValue: readonly string[] | undefined): string[] | undefined {
  return Array.isArray(flagsValue) && flagsValue.length > 0 ? (flagsValue as string[]) : fileValue?.slice();
}

/** `--emitir` y `--previsualizar` deciden juntos, y el archivo de `--cargar` puede traer `emitir`. */
function resolveEmitDecision(
  flags: { readonly emitir?: boolean; readonly previsualizar?: boolean },
  file: { readonly emitir?: boolean; readonly previsualizar?: boolean } | undefined,
  defaults: ExportCommandDefaults,
): { readonly emit: boolean; readonly modeSource: ExportModeSource } {
  if (flags.emitir && flags.previsualizar) {
    throw new InputValidationError('Usá `--emitir` o `--previsualizar`, no los dos.');
  }

  if (flags.emitir !== undefined) {
    return { emit: flags.emitir, modeSource: 'flags' };
  }

  if (flags.previsualizar !== undefined) {
    return { emit: !flags.previsualizar, modeSource: 'flags' };
  }

  if (file?.emitir === true && file.previsualizar === true) {
    throw new InputValidationError('En el archivo usá "emitir" o "previsualizar", pero no ambos en true.');
  }

  if (file?.emitir !== undefined) {
    return { emit: file.emitir, modeSource: 'file' };
  }

  // Igual que en A, B y C: "previsualizar": false no es lo mismo que "emitir": true; sin "emitir" decide la config
  // (y en una terminal se pregunta).
  if (file?.previsualizar === true) {
    return { emit: false, modeSource: 'file' };
  }

  return { emit: defaults.defaultEmit ?? false, modeSource: 'default' };
}

/** Los flags ganan sobre el JSON de `--cargar`, igual que en facturacion. */
export function parseExportCommandPlan(command: Command, defaults: ExportCommandDefaults = {}): ExportCommandPlan {
  const options = command.optsWithGlobals<Record<string, unknown>>();
  const filePath = typeof options.cargar === 'string' ? options.cargar : undefined;
  const file = filePath ? readExportJsonInput(readJsonFile<unknown>(filePath)) : undefined;
  const { emit, modeSource } = resolveEmitDecision(
    { emitir: pickBoolean(options.emitir), previsualizar: pickBoolean(options.previsualizar) },
    file,
    defaults,
  );
  const destination =
    pickString(options.paisDestino, file?.paisDestino) ?? pickNumber(options.paisDestino, file?.paisDestino);
  const currency = pickString(options.moneda, options.mda, file?.codigoMoneda);
  const exportPdf = pickBoolean(options.exportarPdf, options.pdf) === true;
  const skipPdf = pickBoolean(options.sinPdf) === true;

  if (exportPdf && skipPdf) {
    throw new InputValidationError('Usá `--exportar-pdf` o `--sin-pdf`, pero no ambos a la vez.');
  }

  // Igual que en A, B y C: los flags ganan y, sin ellos, vale `"pdf"` del archivo.
  const pdf = exportPdf ? true : skipPdf ? false : file?.pdf;
  const voucherKind = defaults.voucherKind ?? EXPORT_VOUCHER_KIND;
  // Las fechas relativas (`hoy`, `+10`...) se resuelven aca, para flags y `--cargar`. En la E todas son de un dia.
  const now = new Date();
  const day = (value: string | undefined) => resolveRelativeDateInput(value, 'day', now);
  const associatedFile = file?.comprobanteAsociado;

  if (associatedFile && !isExportNote(voucherKind)) {
    throw new InputValidationError(
      'La factura E no lleva comprobante asociado: sacá "comprobanteAsociado" del JSON o usá `arcli nce` o `arcli nde`.',
    );
  }

  // `arcli factura e` tambien tiene `--ac`, `--ar`... de A, B y C: en la factura E se saltean con un aviso.
  const associatedVoucher: ExportAssociatedVoucherInput | undefined = isExportNote(voucherKind)
    ? {
        arcaType: pickNumber(options.at, associatedFile?.tipo),
        cuit: pickString(options.acuit, associatedFile?.cuit),
        // `--afecha` es de A, B y C: en `arcli nota-credito e` se saltea con un aviso. Del JSON, se avisa que no se usa.
        date: day(associatedFile?.fecha),
        number: pickNumber(options.ar, associatedFile?.numero),
        pointOfSale: pickNumber(options.apv, options.asociadoPuntoVenta, associatedFile?.puntoVenta),
        shortcut: pickString(options.ac, associatedFile?.atajo),
      }
    : undefined;

  const description = pickString(options.descripcion, file?.descripcion);
  const items = pickItems(options.item, mapExportJsonItems(file?.items));

  return {
    input: {
      activity: pickNumber(options.actividad, file?.actividad),
      amount: pickNumber(options.monto, file?.montoTotal, file?.monto),
      associatedVoucher,
      clientAddress: pickString(options.domicilioCliente, file?.domicilioCliente),
      clientCountryCuit: pickNumber(options.cuitPais, file?.cuitPais),
      clientName: pickString(options.cliente, file?.cliente),
      clientTaxId: pickString(options.idImpositivo, file?.idImpositivo),
      commercialObservations: pickString(options.obsComerciales, file?.observacionesComerciales),
      currencyCode: currency,
      description,
      destinationCountry: destination === undefined ? undefined : String(destination),
      emit,
      exchangeRate: pickNumber(options.cotizacionMoneda, options.cm, file?.cotizacionMoneda),
      exportType: pickNumber(options.tipoExpo, file?.tipoExpo) as ExportType | undefined,
      incoterm: pickString(options.incoterm, file?.incoterm),
      incotermDescription: pickString(options.incotermsDesc, file?.descripcionIncoterm),
      items,
      language: pickNumber(options.idioma, file?.idioma),
      modeSource,
      observations: pickString(options.observaciones, file?.observaciones),
      paymentDate: day(pickString(options.fechaPago, file?.fechaPago)),
      paymentTerms: pickString(options.formaPago, file?.formaPago),
      pdf,
      permits: pickList(options.permiso, file?.permisos),
      permitsExisting: pickBoolean(options.permisoExistente, file?.permisoExistente),
      pointOfSale: pickNumber(options.puntoVenta, options.pv, file?.puntoVenta),
      requestId: pickNumber(options.idSolicitud, file?.idSolicitud),
      // En `arcli nota-credito e`, `--misma-moneda` es el de A, B y C y se saltea con un aviso.
      sameCurrency: pickBoolean(isExportNote(voucherKind) ? undefined : options.mismaMoneda, file?.mismaMoneda),
      voucherDate: day(pickString(options.fecha, file?.fechaComprobante)),
      voucherKind,
      voucherNumber: pickNumber(options.numero, file?.numero),
    },
    modeSource,
    warnings: [
      ...exportJsonInputWarnings(file),
      ...itemsDescriptionWarnings({
        descriptionFromFile: typeof options.descripcion !== 'string',
        hasDescription: Boolean(description?.trim()),
        hasItems: Boolean(items && items.length > 0),
        itemsFromFile: !(Array.isArray(options.item) && options.item.length > 0),
      }),
    ],
  };
}
