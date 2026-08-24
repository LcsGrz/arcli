import type { Command } from 'commander';
import ora from 'ora';

import { BillingService } from '../../modules/billing/billing.service';
import type { VoucherShortcut } from '../../modules/billing/billing.types';
import type { BillingExecutionResult } from '../../modules/billing/billing.types.internal';
import { getVoucherKindByShortcut } from '../../modules/billing/voucher-kind-map';
import { ArcaBillingGateway } from '../../services/arca/arca-billing.gateway';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { ArcaContextResolver } from '../../services/arca/arca-context.resolver';
import type { GlobalCliOptions } from '../types';

import { runInteractiveBillingPreview } from './billing.command.interactive-preview';
import { writeBillingCommandResults } from './billing.command.output';
import { parseBillingCommandPlan, registerBillingOptions } from './billing.command.parser';

export function registerGlobalOptions(command: Command): void {
  command
    .option('--testing', 'usar entorno de testing en esta ejecucion')
    .option('--produccion', 'usar entorno de produccion en esta ejecucion')
    .option('--json', 'imprimir salida JSON')
    .option('--bruto', 'mostrar la respuesta bruta de ARCA cuando exista');
}

export function registerBillingCommandOptions(command: Command): void {
  registerGlobalOptions(command);
  registerBillingOptions(command);
}

export function getGlobalOptions(command: Command): GlobalCliOptions {
  return command.optsWithGlobals<GlobalCliOptions>();
}

export async function executeBillingCommand(command: Command, shortcut: VoucherShortcut): Promise<void> {
  const globalOptions = getGlobalOptions(command);
  let spinner: ReturnType<typeof ora> | null = null;
  const voucherKind = getVoucherKindByShortcut(shortcut);

  try {
    const runtime = new ArcaContextResolver({ options: globalOptions }).resolve();
    const plan = parseBillingCommandPlan(command, shortcut, {
      defaultConcept: runtime.config.conceptoPorDefecto,
      defaultCurrencyCode: runtime.config.monedaPorDefecto,
      defaultEmit: runtime.config.output.emitirPorDefecto,
      defaultExchangeRate: runtime.config.cotizacionPorDefecto,
      defaultIvaCondition: runtime.config.ivaReceptorPorDefecto,
    });
    const service = new BillingService();
    const arca = new ArcaClientFactory().create(runtime);
    const useRaw = typeof globalOptions.bruto === 'boolean' ? globalOptions.bruto : runtime.outputRaw;

    const preview = await runInteractiveBillingPreview({
      inputs: plan.inputs,
      modeSource: plan.modeSource,
      runtime,
      service,
      useRaw,
      voucherLabel: voucherKind?.displayName ?? 'este comprobante',
    });

    if (!preview.proceed) {
      return;
    }

    const { inputs, previewShown } = preview;

    spinner = !runtime.outputJson && process.stdout.isTTY ? ora('Procesando comprobante...').start() : null;

    if (spinner) {
      spinner.text = inputs.length > 1 ? `Procesando ${inputs.length} comprobantes...` : 'Procesando comprobante...';
    }

    const gateway = new ArcaBillingGateway(arca);
    const results: BillingExecutionResult[] = [];

    for (const input of inputs) {
      results.push(
        await service.execute({
          gateway,
          input,
          runtime,
        }),
      );
    }

    spinner?.stop();

    writeBillingCommandResults(results, {
      environment: runtime.environment,
      outputJson: runtime.outputJson,
      previewShown,
      raw: useRaw,
    });
  } catch (error) {
    spinner?.stop();
    throw error;
  }
}
