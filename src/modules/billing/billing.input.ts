import type { AppError } from '../../lib/errors/app-error';

import type { BillingDefaults } from './billing.defaults';
import { type EmitDecisionSource, resolveEmitDecision } from './billing.emit-decision';
import {
  type BillingInputLayers,
  resolveAmounts,
  resolveAssociatedPeriod,
  resolveAssociatedVoucher,
  resolveConcept,
  resolveCurrency,
  resolveFceFields,
  resolveFileFields,
  resolveReceiver,
  written,
  writtenDate,
} from './billing.input-groups';
import type { BillingJsonInput } from './billing.json-input';
import { type BillingCommandInput, billingCommandSchema } from './billing.schemas';
import type { VoucherShortcut } from './billing.types';
import { parseZodInput } from './billing.zod-errors';

/** Los grupos de flags que pueden ser incompatibles entre sí, en el orden en que se informan. */
export type BillingFlagGroup = 'asociado' | 'identificacion' | 'moneda' | 'alicuota' | 'condicionVenta' | 'pdf';

/**
 * Lo escrito en los flags, con la forma del JSON de `--cargar`: `--sin-condicion-venta` es `condicionVenta: null` y
 * `--sin-pdf`, `pdf: false`. Quien los lee detecta los incompatibles y los deja en `errors` en lugar de tirarlos: son un
 * error de cada comprobante, y salen en su lugar entre los demás controles.
 */
export interface BillingFlags extends BillingJsonInput {
  readonly errors?: Partial<Record<BillingFlagGroup, AppError>>;
}

export interface BillingInputOptions {
  readonly defaults: BillingDefaults;
  /** Un comprobante de `--cargar`, ya validado con `parseBillingJsonInput`. */
  readonly file?: BillingJsonInput;
  readonly flags?: BillingFlags;
  /** La referencia de las fechas relativas, la misma para todo el lote. */
  readonly now: Date;
  readonly shortcut: VoucherShortcut;
}

export interface ResolvedBillingInput {
  readonly input: BillingCommandInput;
  readonly modeSource: EmitDecisionSource;
}

/**
 * La entrada de un comprobante A, B, C o FCE: mezcla flags, archivo y config, y la valida. El orden de los controles
 * decide qué error sale cuando hay más de uno: no lo cambies sin mirar `billing.input-conflicts.test.ts`.
 */
export function resolveBillingInput({ file = {}, flags = {}, ...context }: BillingInputOptions): ResolvedBillingInput {
  const layers: BillingInputLayers = { ...context, file, flags };
  const assertFlags = (group: BillingFlagGroup): void => {
    const error = flags.errors?.[group];

    if (error) {
      throw error;
    }
  };

  assertFlags('asociado');

  const { emit, source: modeSource } = resolveEmitDecision({
    bothFlagsMessage: 'Usá `--emitir` o `--previsualizar`, pero no ambos a la vez.',
    defaultEmit: context.defaults.defaultEmit,
    file,
    flags,
  });

  assertFlags('identificacion');

  const concept = resolveConcept(layers);
  const receiver = resolveReceiver(layers);

  assertFlags('moneda');

  const currency = resolveCurrency(layers);
  const associatedPeriod = resolveAssociatedPeriod(layers);

  assertFlags('alicuota');

  const amounts = resolveAmounts(layers);

  assertFlags('condicionVenta');

  const associatedVoucher = resolveAssociatedVoucher(layers);
  const billingDate = writtenDate(layers, 'fechaComprobante', 'day');
  const paymentDueDate = writtenDate(layers, 'vencimientoPago', 'day');

  assertFlags('pdf');

  const serviceEndDate = writtenDate(layers, 'servicioHasta', 'to');
  const serviceStartDate = writtenDate(layers, 'servicioDesde', 'from');

  const input = parseZodInput(billingCommandSchema, {
    ...receiver,
    ...currency,
    ...amounts,
    ...resolveFceFields(layers),
    associatedPeriod,
    associatedVoucher,
    billingDate,
    concept,
    dryRun: !emit,
    dueDay: written(layers, 'dia'),
    emit,
    fromFile: resolveFileFields(layers),
    paymentDueDate,
    pdf: written(layers, 'pdf'),
    pdfDescription: written(layers, 'descripcion'),
    pointOfSale: written(layers, 'puntoVenta'),
    // En los flags, `null` es que no va: no pasa al archivo.
    saleCondition: flags.condicionVenta === undefined ? file.condicionVenta : flags.condicionVenta,
    serviceEndDate,
    serviceStartDate,
    shortcut: context.shortcut,
  });

  return { input, modeSource };
}
