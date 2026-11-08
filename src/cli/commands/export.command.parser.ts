import type { Command } from 'commander';

import { InputValidationError } from '../../lib/errors/app-error';
import { readJsonFile } from '../../lib/files/read-json-file';
import {
  exportJsonInputWarnings,
  mapExportJsonItems,
  readExportJsonInput,
} from '../../modules/export/export.json-input';
import type {
  ExportItemInput,
  ExportModeSource,
  ExportType,
  ExportVoucherInput,
} from '../../modules/export/export.types';

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

  return {
    input: {
      activity: pickNumber(options.actividad, file?.actividad),
      amount: pickNumber(options.monto, file?.montoTotal, file?.monto),
      clientAddress: pickString(options.domicilioCliente, file?.domicilioCliente),
      clientCountryCuit: pickNumber(options.cuitPais, file?.cuitPais),
      clientName: pickString(options.cliente, file?.cliente),
      clientTaxId: pickString(options.idImpositivo, file?.idImpositivo),
      commercialObservations: pickString(options.obsComerciales, file?.observacionesComerciales),
      currencyCode: currency,
      description: pickString(options.descripcion, file?.descripcion),
      destinationCountry: destination === undefined ? undefined : String(destination),
      emit,
      exchangeRate: pickNumber(options.cotizacionMoneda, options.cm, file?.cotizacionMoneda),
      exportType: pickNumber(options.tipoExpo, file?.tipoExpo) as ExportType | undefined,
      incoterm: pickString(options.incoterm, file?.incoterm),
      incotermDescription: pickString(options.incotermsDesc, file?.descripcionIncoterm),
      items: pickItems(options.item, mapExportJsonItems(file?.items)),
      language: pickNumber(options.idioma, file?.idioma),
      modeSource,
      observations: pickString(options.observaciones, file?.observaciones),
      paymentDate: pickString(options.fechaPago, file?.fechaPago),
      paymentTerms: pickString(options.formaPago, file?.formaPago),
      pdf,
      permits: pickList(options.permiso, file?.permisos),
      permitsExisting: pickBoolean(options.permisoExistente, file?.permisoExistente),
      pointOfSale: pickNumber(options.puntoVenta, options.pv, file?.puntoVenta),
      requestId: pickNumber(options.idSolicitud, file?.idSolicitud),
      sameCurrency: pickBoolean(options.mismaMoneda, file?.mismaMoneda),
      voucherDate: pickString(options.fecha, file?.fechaComprobante),
      voucherNumber: pickNumber(options.numero, file?.numero),
    },
    modeSource,
    warnings: exportJsonInputWarnings(file),
  };
}
