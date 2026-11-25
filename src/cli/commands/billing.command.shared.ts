import type { Command } from 'commander';

import { billingDefaultsFromConfig } from '../../modules/billing/billing.defaults';
import { emitBilling, planBillingEmission } from '../../modules/billing/billing.emission';
import { previewBilling } from '../../modules/billing/billing.preview';
import type { BillingCommandInput } from '../../modules/billing/billing.schemas';
import type { VoucherShortcut } from '../../modules/billing/billing.types';
import type { BillingExecutionResult } from '../../modules/billing/billing.types.internal';
import { getVoucherKindByShortcut } from '../../modules/billing/voucher-kind-map';
import { formatVoucherWithArticle } from '../../modules/billing/voucher-names';
import type { ArcliConfig } from '../../modules/config/config.schemas';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { systemClock } from '../../services/time/system-clock';
import { certificateWarnings, type CliArcaRuntime, resolveArcaRuntime } from '../arca-runtime';
import { type BillingGateways, createBillingGateways } from '../billing-gateways';
import { recordEmission, recordFailedPdfs } from '../emitted-vouchers';
import { getGlobalOptions, registerGlobalOptions } from '../global-options';
import { withPendingSpinner } from '../pending-spinner';
import { startSpinner } from '../spinner';

import { runInteractiveBillingPreview } from './billing.command.interactive-preview';
import { writeBillingCommandResults, writePartialResultsFailure, writePdfOutcomes } from './billing.command.output';
import { parseBillingCommandPlan, registerBillingOptions } from './billing.command.parser';
import { attachPdfs } from './billing.command.pdf';

/** Exit code cuando ARCA rechaza algun comprobante: la operacion corrio bien, pero no hay CAE. */
export const REJECTED_EXIT_CODE = 2;

/**
 * 2 si ARCA rechazo alguno de los comprobantes emitidos; si no, no se toca (queda en 0).
 *
 * @internal Exportado para los tests.
 */
export function setExitCodeForResults(results: readonly BillingExecutionResult[]): void {
  if (results.some((result) => !result.dryRun && result.response.status === 'rechazado')) {
    process.exitCode = REJECTED_EXIT_CODE;
  }
}

export function registerBillingCommandOptions(command: Command): void {
  registerGlobalOptions(command);
  registerBillingOptions(command);
}

/**
 * Imprime los resultados con su PDF, segun la config `pdf` o `--exportar-pdf`. Se usa con el lote completo y
 * con los ya emitidos de un lote que se corto: esos tambien tienen CAE y merecen su PDF.
 *
 * @internal Exportado para los tests.
 */
export async function writeResultsWithPdfs(
  results: BillingExecutionResult[],
  options: {
    readonly config: ArcliConfig;
    /** Los del lote entero; se toman los primeros `results.length`. */
    readonly inputs: readonly BillingCommandInput[];
    readonly interactive: boolean;
    readonly output: Parameters<typeof writeBillingCommandResults>[1];
  },
): Promise<void> {
  const pdfOptions = {
    config: options.config,
    inputs: options.inputs.slice(0, results.length),
    interactive: options.interactive,
    results,
  };

  // En JSON el PDF va dentro del mismo resultado; en texto primero se ve el CAE y despues se pregunta.
  if (!options.output.outputJson) {
    writeBillingCommandResults(results, options.output);
  }

  const withPdfs = await attachPdfs(pdfOptions);

  recordFailedPdfs(withPdfs);

  if (options.output.outputJson) {
    writeBillingCommandResults(withPdfs, options.output);
  } else {
    writePdfOutcomes(results, withPdfs);
  }
}

/** Si tampoco se puede escribir el aviso, lo que importa es el error de emision. */
function warnPartialResultsFailure(results: readonly BillingExecutionResult[]): void {
  try {
    writePartialResultsFailure(results);
  } catch {
    // El error de emision sale igual.
  }
}

/**
 * Lo ya procesado de un lote cortado, antes de su error: si no se mostrara, alguien volveria a correr el lote y
 * duplicaria comprobantes. Se espera a que termine (puede generar los PDFs), y si falla no tapa el error de emision.
 */
async function writeInterruptedResults(
  results: BillingExecutionResult[],
  options: Parameters<typeof writeResultsWithPdfs>[1],
): Promise<void> {
  if (results.length === 0) {
    return;
  }

  try {
    await writeResultsWithPdfs(results, options);
  } catch {
    // Con --json no hay donde avisarlo sin cambiar la salida: `detalles.procesados` dice cuantos son.
    if (!options.output.outputJson) {
      warnPartialResultsFailure(results);
    }
  }
}

export interface BillingCommandOptions {
  /** Avisos que arma quien llama, como los flags de la E salteados en `arcli factura a`. */
  readonly extraWarnings?: readonly string[];
}

/** @internal Exportado para los tests. */
export type BillingCommandGateways = BillingGateways;

/** Lo que el comando toma de afuera: en los tests, una config y un ARCA falsos. */
export interface BillingCommandDependencies {
  readonly createGateways: (runtime: CliArcaRuntime) => BillingGateways;
  readonly resolveRuntime: typeof resolveArcaRuntime;
}

const DEFAULT_DEPENDENCIES: BillingCommandDependencies = {
  createGateways: (runtime) => createBillingGateways(new ArcaClientFactory().create(runtime)),
  resolveRuntime: resolveArcaRuntime,
};

export async function executeBillingCommand(
  command: Command,
  shortcut: VoucherShortcut,
  options: BillingCommandOptions = {},
  dependencies: BillingCommandDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  const globalOptions = getGlobalOptions(command);
  let spinner: ReturnType<typeof startSpinner> = null;
  const voucherKind = getVoucherKindByShortcut(shortcut);

  try {
    const runtime = dependencies.resolveRuntime(globalOptions);
    const plan = parseBillingCommandPlan(command, shortcut, billingDefaultsFromConfig(runtime.config));
    const gateways = dependencies.createGateways(runtime);
    const useRaw = typeof globalOptions.bruto === 'boolean' ? globalOptions.bruto : runtime.outputRaw;
    const items = await withPendingSpinner(runtime.outputJson ? null : 'Consultando ARCA...', () =>
      previewBilling({
        clock: systemClock,
        extraWarnings: [...certificateWarnings(runtime), ...(options.extraWarnings ?? [])],
        gateways,
        plan,
        runtime,
      }),
    );

    const preview = await runInteractiveBillingPreview({
      items,
      modeSource: plan.modeSource,
      runtime,
      useRaw,
      voucherLabel: voucherKind ? formatVoucherWithArticle(voucherKind) : 'este comprobante',
    });

    if (!preview.proceed) {
      return;
    }

    const { previewShown } = preview;
    const inputs = preview.items.map(({ input }) => input);

    const emitting = inputs.some((input) => input.emit);
    const emittedVouchers =
      inputs.length > 1
        ? `${inputs.length} comprobantes`
        : voucherKind
          ? formatVoucherWithArticle(voucherKind)
          : 'el comprobante';

    spinner = runtime.outputJson
      ? null
      : startSpinner(emitting ? `Emitiendo ${emittedVouchers} en ARCA...` : 'Preparando la vista previa...');

    const deliveryOptions = {
      config: runtime.config,
      inputs,
      interactive: !runtime.outputJson && Boolean(process.stdin.isTTY && process.stdout.isTTY),
      output: {
        batch: plan.isBatch,
        environment: runtime.environment,
        outputJson: runtime.outputJson,
        previewShown,
        raw: useRaw,
      },
    };
    const outcome = await emitBilling({
      clock: systemClock,
      gateway: gateways.billing,
      items: planBillingEmission(preview.items),
      onEmitted: (result) => {
        recordEmission(result);
      },
      runtime,
      scope: plan,
    });
    const { results } = outcome;

    spinner?.stop();

    if ('error' in outcome) {
      await writeInterruptedResults(results, deliveryOptions);

      throw outcome.error;
    }

    setExitCodeForResults(results);
    await writeResultsWithPdfs(results, deliveryOptions);
  } catch (error) {
    spinner?.stop();
    throw error;
  }
}
