import type { Command } from 'commander';

import { AppError } from '../../lib/errors/app-error';
import type { ExportFlags } from '../../modules/export/export.input';
import type { ExportJsonInput } from '../../modules/export/export.json-input';
import {
  type ExportItemInput,
  type ExportType,
  type ExportVoucherKind,
  isExportNote,
} from '../../modules/export/export.types';
import { resolvePdfFlag } from '../../modules/pdf/pdf-decision';

import { type OptionValues, pickNumber, pickString, pickSwitch } from './option-values';

function nonBlank(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Un flag repetible; sin valores no se escribió. */
function pickList<T>(value: unknown): T[] | undefined {
  return Array.isArray(value) && value.length > 0 ? (value as T[]) : undefined;
}

function readItems(options: OptionValues): ExportJsonInput['items'] {
  return pickList<ExportItemInput>(options.item)?.map((item) => ({
    cantidad: item.quantity,
    codigo: item.code,
    descripcion: item.description,
    precioUnitario: item.unitPrice,
    unidad: item.unit,
  }));
}

function readPdf(options: OptionValues): Pick<ExportFlags, 'errors' | 'pdf'> {
  try {
    return {
      pdf: resolvePdfFlag({
        exportPdf: options.exportarPdf === true || options.pdf === true,
        skipPdf: options.sinPdf === true,
      }),
    };
  } catch (error) {
    if (!(error instanceof AppError)) {
      throw error;
    }

    return { errors: { pdf: error } };
  }
}

/** Traduce los flags de la E a la forma de `--cargar`; los incompatibles quedan en `errors`. */
export function readExportFlags(command: Command, voucherKind: ExportVoucherKind): ExportFlags {
  const options = command.optsWithGlobals<OptionValues>();

  return {
    ...readPdf(options),
    actividad: pickNumber(options.actividad),
    cliente: pickString(options.cliente),
    // Una moneda vacia no pisa la del archivo ni la del asociado.
    codigoMoneda: [options.moneda, options.mda].map(nonBlank).find((code) => code !== undefined),
    // Sin `--afecha`, que es de A, B y C: en `arcli nota-credito e` se saltea con un aviso. En `arcli factura e` se
    // saltean todos.
    comprobanteAsociado: {
      // Vacio no identifica nada.
      atajo: pickString(options.ac) || undefined,
      cuit: pickString(options.acuit),
      numero: pickNumber(options.ar),
      puntoVenta: pickNumber(options.apv, options.asociadoPuntoVenta),
      tipo: pickNumber(options.at),
    },
    cotizacionMoneda: pickNumber(options.cotizacionMoneda, options.cm),
    cuitPais: pickNumber(options.cuitPais),
    descripcion: pickString(options.descripcion),
    descripcionIncoterm: pickString(options.incotermsDesc),
    domicilioCliente: pickString(options.domicilioCliente),
    emitir: pickSwitch(options.emitir),
    fechaComprobante: pickString(options.fecha),
    fechaPago: pickString(options.fechaPago),
    formaPago: pickString(options.formaPago),
    idImpositivo: pickString(options.idImpositivo),
    idSolicitud: pickNumber(options.idSolicitud),
    idioma: pickNumber(options.idioma),
    incoterm: pickString(options.incoterm),
    items: readItems(options),
    // En `arcli nota-credito e`, `--misma-moneda` es el de A, B y C y se saltea con un aviso.
    mismaMoneda: isExportNote(voucherKind) ? undefined : pickSwitch(options.mismaMoneda),
    montoTotal: pickNumber(options.monto),
    numero: pickNumber(options.numero),
    observaciones: pickString(options.observaciones),
    observacionesComerciales: pickString(options.obsComerciales),
    paisDestino: pickString(options.paisDestino),
    permisoExistente: pickSwitch(options.permisoExistente),
    permisos: pickList<string>(options.permiso),
    previsualizar: pickSwitch(options.previsualizar),
    puntoVenta: pickNumber(options.puntoVenta, options.pv),
    tipoExpo: pickNumber(options.tipoExpo) as ExportType | undefined,
  };
}
