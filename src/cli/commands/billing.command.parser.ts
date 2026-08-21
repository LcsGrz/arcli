import type { Command } from 'commander';

import { InputValidationError } from '../../lib/errors/app-error';
import { readJsonFile } from '../../lib/files/read-json-file';
import { type BillingCommandInput, billingCommandSchema } from '../../modules/billing/billing.schemas';
import type { VoucherShortcut } from '../../modules/billing/billing.types';

import { resolveConceptShortcut, resolveDocumentIdentity, resolveIvaShortcut } from './billing.command.shortcuts';

export { registerBillingOptions } from './billing.command.options';

type AssociatedVoucherInput = NonNullable<BillingCommandInput['associatedVoucher']>;

interface BillingJsonInput {
  readonly comprobanteAsociado?: {
    readonly atajo?: AssociatedVoucherInput['shortcut'];
    readonly cuit?: AssociatedVoucherInput['cuit'];
    readonly numero?: AssociatedVoucherInput['numero'];
    readonly puntoVenta?: AssociatedVoucherInput['puntoVenta'];
    readonly tipo?: AssociatedVoucherInput['tipo'];
  };
  readonly confirmarProduccion?: boolean;
  readonly concepto?: BillingCommandInput['concept'];
  readonly codigoMoneda?: string;
  readonly cotizacionMoneda?: number;
  readonly dia?: number;
  readonly emitir?: boolean;
  readonly fechaComprobante?: string;
  readonly ivaReceptor?: BillingCommandInput['ivaCondition'];
  readonly montoTotal?: number;
  readonly numeroDocumento?: number;
  readonly previsualizar?: boolean;
  readonly puntoVenta?: number;
  readonly servicioDesde?: string;
  readonly servicioHasta?: string;
  readonly tipoDocumento?: BillingCommandInput['documentType'];
}

type BillingJsonInputSource = BillingJsonInput | BillingJsonInput[];

function pickString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string');
}

function pickNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === 'number');
}

export interface BillingCommandDefaults {
  readonly defaultConcept?: BillingCommandInput['concept'];
  readonly defaultCurrencyCode?: string;
  readonly defaultEmit?: boolean;
  readonly defaultExchangeRate?: number;
  readonly defaultIvaCondition?: BillingCommandInput['ivaCondition'];
}

export interface BillingCommandPlan {
  readonly inputs: BillingCommandInput[];
  readonly modeSource: 'default' | 'file' | 'flags';
}

function parseBillingCommandInputFromSource(
  command: Command,
  shortcut: VoucherShortcut,
  fileInput: BillingJsonInput | undefined,
  defaults: BillingCommandDefaults = {},
): BillingCommandInput & { readonly __modeSource: BillingCommandPlan['modeSource'] } {
  const commandOptions = command.optsWithGlobals<Record<string, unknown>>();
  const emitirSource = command.getOptionValueSource('emitir');
  const previsualizarSource = command.getOptionValueSource('previsualizar');
  const hasAssociatedShortcut = typeof commandOptions.ac === 'string';
  const hasAssociatedType = typeof commandOptions.at === 'number';

  if (hasAssociatedShortcut && hasAssociatedType) {
    throw new InputValidationError('Use --ac o --at para identificar el comprobante asociado, pero no ambos a la vez.');
  }

  const associatedVoucherFromFlags =
    commandOptions.ar ||
    commandOptions.apv ||
    commandOptions.asociadoPuntoVenta ||
    commandOptions.at ||
    commandOptions.acuit ||
    commandOptions.ac
      ? {
          cuit: pickString(commandOptions.acuit),
          numero: pickNumber(commandOptions.ar),
          puntoVenta: pickNumber(commandOptions.apv, commandOptions.asociadoPuntoVenta),
          shortcut: pickString(commandOptions.ac),
          tipo: pickNumber(commandOptions.at),
        }
      : undefined;

  const modeSource: BillingCommandPlan['modeSource'] =
    emitirSource === 'cli' || previsualizarSource === 'cli'
      ? 'flags'
      : typeof fileInput?.emitir === 'boolean' || typeof fileInput?.previsualizar === 'boolean'
        ? 'file'
        : 'default';
  const shouldEmit =
    emitirSource === 'cli'
      ? Boolean(commandOptions.emitir)
      : typeof fileInput?.emitir === 'boolean'
        ? fileInput.emitir
        : Boolean(defaults.defaultEmit);
  const shouldDryRun =
    previsualizarSource === 'cli'
      ? Boolean(commandOptions.previsualizar)
      : typeof fileInput?.previsualizar === 'boolean'
        ? fileInput.previsualizar
        : !shouldEmit;
  const conceptShortcut = resolveConceptShortcut(commandOptions);
  const documentIdentity = resolveDocumentIdentity(commandOptions);
  const ivaShortcut = resolveIvaShortcut(commandOptions);
  const resolvedConcept =
    pickString(commandOptions.concepto) ?? conceptShortcut ?? fileInput?.concepto ?? defaults.defaultConcept;
  const resolvedIvaCondition =
    pickString(commandOptions.ivaReceptor, commandOptions.ir) ??
    ivaShortcut ??
    fileInput?.ivaReceptor ??
    defaults.defaultIvaCondition;

  if (typeof commandOptions.concepto === 'string' && conceptShortcut) {
    throw new InputValidationError('Use --concepto o un flag corto de concepto (--cs, --cp, --csp), pero no ambos.');
  }

  if (typeof commandOptions.ivaReceptor === 'string' && typeof commandOptions.ir === 'string') {
    throw new InputValidationError('Use --iva-receptor o --ir para indicar IVA receptor, pero no ambos.');
  }

  if ((typeof commandOptions.ivaReceptor === 'string' || typeof commandOptions.ir === 'string') && ivaShortcut) {
    throw new InputValidationError('Use --iva-receptor, --ir o un flag corto --ir-*, pero no varios a la vez.');
  }

  if (shouldEmit && shouldDryRun) {
    throw new InputValidationError('Use --emitir o --previsualizar, pero no ambos a la vez.');
  }

  if (!resolvedConcept) {
    throw new InputValidationError(
      'Falta el concepto. Use --concepto <tipo>, o bien --cs/--cp/--csp, o configure uno por defecto con "arcli config establecer concepto servicios".',
    );
  }

  if (!resolvedIvaCondition) {
    throw new InputValidationError(
      'Falta IVA receptor. Use --iva-receptor <tipo>, --ir <tipo>, un flag --ir-*, o configure uno por defecto con "arcli config establecer ivaReceptor consumidor-final".',
    );
  }

  const associatedVoucherFromFile = fileInput?.comprobanteAsociado
    ? {
        cuit: fileInput.comprobanteAsociado.cuit,
        numero: fileInput.comprobanteAsociado.numero,
        puntoVenta: fileInput.comprobanteAsociado.puntoVenta,
        shortcut: fileInput.comprobanteAsociado.atajo,
        tipo: fileInput.comprobanteAsociado.tipo,
      }
    : undefined;

  return {
    ...billingCommandSchema.parse({
      associatedVoucher: associatedVoucherFromFlags ?? associatedVoucherFromFile,
      billingDate: pickString(commandOptions.fecha, fileInput?.fechaComprobante),
      concept: resolvedConcept,
      currencyCode: pickString(
        commandOptions.moneda,
        commandOptions.mda,
        fileInput?.codigoMoneda,
        defaults.defaultCurrencyCode,
      ),
      documentNumber: documentIdentity.documentNumber ?? fileInput?.numeroDocumento,
      documentType: documentIdentity.documentType ?? fileInput?.tipoDocumento,
      dryRun: shouldDryRun,
      dueDay: pickNumber(commandOptions.dia, fileInput?.dia),
      emit: shouldEmit,
      exchangeRate: pickNumber(
        commandOptions.cotizacionMoneda,
        commandOptions.cm,
        fileInput?.cotizacionMoneda,
        defaults.defaultExchangeRate,
      ),
      ivaCondition: resolvedIvaCondition,
      pointOfSale: pickNumber(commandOptions.puntoVenta, commandOptions.pv, fileInput?.puntoVenta),
      serviceEndDate: pickString(commandOptions.servicioHasta, commandOptions.sh, fileInput?.servicioHasta),
      serviceStartDate: pickString(commandOptions.servicioDesde, commandOptions.sd, fileInput?.servicioDesde),
      shortcut,
      totalAmount: pickNumber(commandOptions.monto, fileInput?.montoTotal),
    }),
    __modeSource: modeSource,
  };
}

export function parseBillingCommandPlan(
  command: Command,
  shortcut: VoucherShortcut,
  defaults: BillingCommandDefaults = {},
): BillingCommandPlan {
  const commandOptions = command.optsWithGlobals<Record<string, unknown>>();
  const inputFilePath = typeof commandOptions.cargar === 'string' ? commandOptions.cargar : undefined;
  const fileInputSource = inputFilePath ? readJsonFile<BillingJsonInputSource>(inputFilePath) : undefined;
  const fileInputs = Array.isArray(fileInputSource) ? fileInputSource : [fileInputSource].filter(Boolean);

  if (fileInputs.length === 0) {
    const { __modeSource, ...input } = parseBillingCommandInputFromSource(command, shortcut, undefined, defaults);

    return {
      inputs: [input],
      modeSource: __modeSource,
    };
  }

  const inputs = fileInputs.map((fileInput) =>
    parseBillingCommandInputFromSource(command, shortcut, fileInput, defaults),
  );
  const modeSource = inputs.some((input) => input.__modeSource === 'flags')
    ? 'flags'
    : inputs.some((input) => input.__modeSource === 'file')
      ? 'file'
      : 'default';

  return {
    inputs: inputs.map(({ __modeSource: _modeSource, ...input }) => input),
    modeSource,
  };
}

export function parseBillingCommandInputs(
  command: Command,
  shortcut: VoucherShortcut,
  defaults: BillingCommandDefaults = {},
): BillingCommandInput[] {
  return parseBillingCommandPlan(command, shortcut, defaults).inputs;
}

export function parseBillingCommandInput(
  command: Command,
  shortcut: VoucherShortcut,
  defaults: BillingCommandDefaults = {},
): BillingCommandInput {
  return parseBillingCommandInputs(command, shortcut, defaults)[0];
}
