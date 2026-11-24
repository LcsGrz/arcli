import type { Command } from 'commander';

import { AppError, InputValidationError } from '../../lib/errors/app-error';
import { parseArgentineAmount } from '../../lib/numbers/argentine-amount';
import type { BillingFlagGroup, BillingFlags } from '../../modules/billing/billing.input';
import type { BillingJsonInput } from '../../modules/billing/billing.json-input';
import { resolvePdfFlag } from '../../modules/pdf/pdf-decision';

import { resolveConceptShortcut, resolveDocumentIdentity, resolveIvaShortcut } from './billing.command.shortcuts';

type FlagOptions = Record<string, unknown>;

function pickString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string');
}

function pickNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === 'number');
}

/** `true` si se escribió; `undefined` si no, para que decida el archivo. */
function pickSwitch(value: unknown): true | undefined {
  return value === true ? true : undefined;
}

const ASSOCIATED_FLAGS = ['ac', 'acuit', 'afecha', 'apv', 'ar', 'asociadoPuntoVenta', 'at'] as const;

function readAssociatedVoucher(options: FlagOptions): BillingJsonInput {
  if (typeof options.ac === 'string' && typeof options.at === 'number') {
    throw new InputValidationError(
      'Usá `--ac` o `--at` para identificar el comprobante asociado, pero no ambos a la vez.',
    );
  }

  // Un valor vacío o en cero no cuenta como escrito.
  if (!ASSOCIATED_FLAGS.some((name) => options[name])) {
    return {};
  }

  return {
    comprobanteAsociado: {
      atajo: pickString(options.ac),
      cuit: pickString(options.acuit),
      fecha: pickString(options.afecha),
      numero: pickNumber(options.ar),
      puntoVenta: pickNumber(options.apv, options.asociadoPuntoVenta),
      tipo: pickNumber(options.at),
    },
  };
}

/** El concepto, el documento y el IVA del receptor, que tienen flags cortos. */
function readIdentification(options: FlagOptions): BillingJsonInput {
  const conceptShortcut = resolveConceptShortcut(options);
  const { documentNumber, documentType } = resolveDocumentIdentity(options);
  const ivaShortcut = resolveIvaShortcut(options);
  const concepto = pickString(options.concepto);
  const ivaReceptor = pickString(options.ivaReceptor, options.ir);

  if (concepto !== undefined && conceptShortcut) {
    throw new InputValidationError(
      'Usá `--concepto` o un flag corto de concepto (`--cs`, `--cp`, `--csp`), pero no ambos.',
    );
  }

  if (typeof options.ivaReceptor === 'string' && typeof options.ir === 'string') {
    throw new InputValidationError('Usá `--iva-receptor` o `--ir` para indicar IVA receptor, pero no ambos.');
  }

  if (ivaReceptor !== undefined && ivaShortcut) {
    throw new InputValidationError('Usá `--iva-receptor`, `--ir` o un flag corto `--ir-*`, pero no varios a la vez.');
  }

  return {
    concepto: concepto ?? conceptShortcut,
    ivaReceptor: ivaReceptor ?? ivaShortcut,
    numeroDocumento: documentNumber,
    tipoDocumento: documentType,
  };
}

function readCurrency(options: FlagOptions): BillingJsonInput {
  const cotizacionMoneda = pickNumber(options.cotizacionMoneda, options.cm);
  const mismaMoneda = pickSwitch(options.mismaMoneda);

  if (mismaMoneda && cotizacionMoneda !== undefined) {
    throw new InputValidationError(
      'Con `--misma-moneda` la cotización se toma de ARCA. Sacá `--cotizacion-moneda` o `--cm`.',
    );
  }

  return { codigoMoneda: pickString(options.moneda, options.mda), cotizacionMoneda, mismaMoneda };
}

function parseRateAmount(flagValue: string, raw: string): number {
  const result = parseArgentineAmount(raw);

  if (!result.ok) {
    throw new InputValidationError(`\`--alicuota\` "${flagValue}": el monto no es válido: ${result.reason}.`);
  }

  return result.value;
}

/**
 * `--alicuota` acepta una tasa sola ("reducida", "10.5") o, repetido, pares TASA:MONTO con el importe
 * de cada alicuota IVA incluido. No se pueden mezclar las dos formas.
 */
function readIvaRates(options: FlagOptions): BillingJsonInput {
  const values = options.alicuota as string[] | undefined;

  if (!values || values.length === 0) {
    return {};
  }

  const withAmount = values.filter((value) => value.includes(':'));

  if (withAmount.length === 0) {
    if (values.length > 1) {
      throw new InputValidationError(
        'Para varias alícuotas usá `--alicuota TASA:MONTO` en cada una, por ejemplo `--alicuota general:1210 --alicuota reducida:552,50`.',
      );
    }

    return { alicuotaIva: values[0] };
  }

  if (withAmount.length !== values.length) {
    throw new InputValidationError('No mezcles `--alicuota TASA` con `--alicuota TASA:MONTO`: usá una sola forma.');
  }

  return {
    alicuotas: values.map((value) => {
      const separator = value.indexOf(':');

      return { monto: parseRateAmount(value, value.slice(separator + 1)), tasa: value.slice(0, separator) };
    }),
  };
}

function readSaleCondition(options: FlagOptions): BillingJsonInput {
  const condicionVenta = pickString(options.condicionVenta, options.cv);

  if (options.sinCondicionVenta !== true) {
    return { condicionVenta };
  }

  if (condicionVenta) {
    throw new InputValidationError('Usá `--condicion-venta`/`--cv` o `--sin-condicion-venta`, pero no ambos a la vez.');
  }

  return { condicionVenta: null };
}

function readPdf(options: FlagOptions): BillingJsonInput {
  return {
    pdf: resolvePdfFlag({
      exportPdf: options.exportarPdf === true || options.pdf === true,
      skipPdf: options.sinPdf === true,
    }),
  };
}

const FLAG_GROUPS: Readonly<Record<BillingFlagGroup, (options: FlagOptions) => BillingJsonInput>> = {
  alicuota: readIvaRates,
  asociado: readAssociatedVoucher,
  condicionVenta: readSaleCondition,
  identificacion: readIdentification,
  moneda: readCurrency,
  pdf: readPdf,
};

function readAssociatedPeriod(options: FlagOptions): BillingJsonInput['periodoAsociado'] {
  const desde = pickString(options.periodoDesde, options.pd);
  const hasta = pickString(options.periodoHasta, options.ph);

  return desde || hasta ? { desde, hasta } : undefined;
}

/** Los que no chocan con otros, y `--emitir` con `--previsualizar`, que controla `resolveEmitDecision`. */
function readOtherFlags(command: Command, options: FlagOptions): BillingJsonInput {
  const fromCli = (name: 'emitir' | 'previsualizar') =>
    command.getOptionValueSource(name) === 'cli' ? options[name] === true : undefined;

  return {
    aliasCbu: pickString(options.alias),
    anulacion: pickSwitch(options.anulacion),
    cbu: pickString(options.cbu),
    descripcion: pickString(options.descripcion),
    dia: pickNumber(options.dia),
    emitir: fromCli('emitir'),
    fechaComprobante: pickString(options.fecha),
    importeExento: pickNumber(options.exento),
    importeNoGravado: pickNumber(options.nogravado),
    montoTotal: pickNumber(options.monto),
    periodoAsociado: readAssociatedPeriod(options),
    previsualizar: fromCli('previsualizar'),
    puntoVenta: pickNumber(options.puntoVenta, options.pv),
    receptorDomicilio: pickString(options.receptorDomicilio),
    receptorNombre: pickString(options.receptorNombre),
    servicioDesde: pickString(options.servicioDesde, options.sd),
    servicioHasta: pickString(options.servicioHasta, options.sh),
    transferencia: pickString(options.transferencia),
    vencimientoPago: pickString(options.vencimiento, options.vto),
  };
}

/** Traduce los flags de A, B, C y FCE a la forma de `--cargar`; los incompatibles quedan en `errors`. */
export function readBillingFlags(command: Command): BillingFlags {
  const options = command.optsWithGlobals<FlagOptions>();
  const errors: Partial<Record<BillingFlagGroup, AppError>> = {};
  const flags = readOtherFlags(command, options);

  for (const group of Object.keys(FLAG_GROUPS) as BillingFlagGroup[]) {
    try {
      Object.assign(flags, FLAG_GROUPS[group](options));
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw error;
      }

      errors[group] = error;
    }
  }

  return { ...flags, errors };
}
