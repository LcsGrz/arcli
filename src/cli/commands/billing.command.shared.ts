import type { Command } from 'commander';

import { DEFAULT_EXCHANGE_RATE } from '../../modules/billing/billing.constants';
import { formatVoucherWithArticle } from '../../modules/billing/billing.mappers';
import { prepareBillingInput, resolveFceWarningsInOrder } from '../../modules/billing/billing.prepare';
import type { BillingCommandInput } from '../../modules/billing/billing.schemas';
import { BillingService } from '../../modules/billing/billing.service';
import type { VoucherShortcut } from '../../modules/billing/billing.types';
import type { BillingExecutionResult, BillingGateway } from '../../modules/billing/billing.types.internal';
import { getVoucherKindByShortcut } from '../../modules/billing/voucher-kind-map';
import type { ArcliConfig } from '../../modules/config/config.schemas';
import { isPadronLookupEnabled } from '../../modules/config/config.schemas';
import type { FceObligationGateway } from '../../modules/fce/fce-obligation';
import type { PadronGateway } from '../../modules/padron/padron';
import { ArcaBillingGateway } from '../../services/arca/arca-billing.gateway';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import type { ResolvedArcaRuntime } from '../../services/arca/arca-context.resolver';
import { ArcaFceObligationGateway } from '../../services/arca/arca-fce-obligation.gateway';
import { ArcaPadronGateway } from '../../services/arca/arca-padron.gateway';
import { certificateWarnings, resolveArcaRuntime } from '../arca-runtime';
import { getGlobalOptions, registerGlobalOptions } from '../global-options';
import { startSpinner } from '../spinner';

import { emitBatch, prepareBatch } from './billing.command.batch';
import { runInteractiveBillingPreview } from './billing.command.interactive-preview';
import { writeBillingCommandResults, writePdfOutcomes } from './billing.command.output';
import { type BillingCommandDefaults, parseBillingCommandPlan, registerBillingOptions } from './billing.command.parser';
import { attachPdfs } from './billing.command.pdf';

/** Exit code cuando ARCA rechaza algun comprobante: la operacion corrio bien, pero no hay CAE. */
export const REJECTED_EXIT_CODE = 2;

/** 2 si ARCA rechazo alguno de los comprobantes emitidos; si no, no se toca (queda en 0). */
export function setExitCodeForResults(results: readonly BillingExecutionResult[]): void {
  if (results.some((result) => !result.dryRun && result.response.status === 'rechazado')) {
    process.exitCode = REJECTED_EXIT_CODE;
  }
}

export function registerBillingCommandOptions(command: Command): void {
  registerGlobalOptions(command);
  registerBillingOptions(command);
}

/** Los defaults de la config que completan lo que no viene por flags ni por JSON. */
export function resolveBillingCommandDefaults(config: ArcliConfig): BillingCommandDefaults {
  return {
    defaultCbu: config.cbu,
    defaultCbuAlias: config.aliasCbu,
    defaultConcept: config.conceptoPorDefecto,
    defaultCurrencyCode: config.monedaPorDefecto,
    defaultEmit: config.output.emitirPorDefecto,
    // `conf` guarda el default 1 en el archivo: 1 es lo mismo que no tenerla, y en moneda extranjera no es valida.
    defaultExchangeRate:
      config.cotizacionPorDefecto === DEFAULT_EXCHANGE_RATE ? undefined : config.cotizacionPorDefecto,
    defaultIvaCondition: config.ivaReceptorPorDefecto,
    defaultIvaRate: config.alicuotaPorDefecto,
    lookupIvaConditionInPadron: isPadronLookupEnabled(config),
  };
}

/**
 * Imprime los resultados con su PDF, segun la config `pdf` o `--exportar-pdf`. Se usa con el lote completo y
 * con los ya emitidos de un lote que se corto: esos tambien tienen CAE y merecen su PDF.
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
  if (options.output.outputJson) {
    writeBillingCommandResults(await attachPdfs(pdfOptions), options.output);

    return;
  }

  writeBillingCommandResults(results, options.output);
  writePdfOutcomes(results, await attachPdfs(pdfOptions));
}

export interface BillingCommandOptions {
  /** Avisos que arma quien llama, como los flags de la E salteados en `arcli factura a`. */
  readonly extraWarnings?: readonly string[];
}

/** Los gateways de ARCA que usa el comando. */
export interface BillingCommandGateways {
  readonly billing: BillingGateway;
  readonly fce: FceObligationGateway;
  readonly padron: PadronGateway;
}

/** Lo que el comando toma de afuera: en los tests, una config y un ARCA falsos. */
export interface BillingCommandDependencies {
  readonly createGateways: (runtime: ResolvedArcaRuntime) => BillingCommandGateways;
  readonly resolveRuntime: typeof resolveArcaRuntime;
}

const DEFAULT_DEPENDENCIES: BillingCommandDependencies = {
  createGateways: (runtime) => {
    const arca = new ArcaClientFactory().create(runtime);

    return {
      billing: new ArcaBillingGateway(arca),
      fce: new ArcaFceObligationGateway(arca),
      padron: new ArcaPadronGateway(arca),
    };
  },
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
    const plan = parseBillingCommandPlan(command, shortcut, resolveBillingCommandDefaults(runtime.config));
    const service = new BillingService();
    const gateways = dependencies.createGateways(runtime);
    const gateway = gateways.billing;
    const useRaw = typeof globalOptions.bruto === 'boolean' ? globalOptions.bruto : runtime.outputRaw;
    // En un lote, un fallo del padron o de la cotizacion sale con su indice, junto a los de validacion.
    const prepared = await prepareBatch({
      inputs: plan.inputs,
      plan,
      resolve: (input) => prepareBillingInput(service, input, gateways),
      validate: ({ input }) => {
        service.buildVoucherPayload(input, runtime);
      },
    });
    const plannedInputs = prepared.map(({ input }) => input);
    const fceWarnings = runtime.config.verificarFce
      ? await resolveFceWarningsInOrder(service, plannedInputs, gateways.fce)
      : [];
    const warnings = prepared.map((entry, position) => [
      ...certificateWarnings(runtime),
      ...(options.extraWarnings ?? []),
      ...entry.warnings,
      ...(fceWarnings[position] ?? []),
    ]);

    const preview = await runInteractiveBillingPreview({
      inputs: plannedInputs,
      modeSource: plan.modeSource,
      runtime,
      service,
      useRaw,
      voucherLabel: voucherKind ? formatVoucherWithArticle(voucherKind) : 'este comprobante',
      warnings,
    });

    if (!preview.proceed) {
      return;
    }

    const { inputs, previewShown } = preview;

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
    const results = await emitBatch({
      emit: (input, position) => service.execute({ gateway, input, runtime, warnings: warnings[position] }),
      inputs,
      onPartialResults: async (partial) => {
        spinner?.stop();
        await writeResultsWithPdfs(partial, deliveryOptions);
      },
      plan,
    });

    spinner?.stop();
    setExitCodeForResults(results);
    await writeResultsWithPdfs(results, deliveryOptions);
  } catch (error) {
    spinner?.stop();
    throw error;
  }
}
