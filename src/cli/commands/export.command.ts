import type { Command } from 'commander';

import { ExportService } from '../../modules/export/export.service';
import { EXPORT_VOUCHER_KIND, type ExportExecutionResult } from '../../modules/export/export.types';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { ArcaExportGateway } from '../../services/arca/arca-export.gateway';
import {
  formatExportResultAsJson,
  formatExportResultAsText,
  formatPdfOutcomeAsText,
  writeTerminalJson,
  writeTerminalOutput,
} from '../../ui';
import { certificateWarnings, resolveArcaRuntime } from '../arca-runtime';
import { getGlobalOptions } from '../global-options';
import { chooseOne } from '../interactive/prompts';
import { startSpinner } from '../spinner';

import { REJECTED_EXIT_CODE } from './billing.command.shared';
import { parseExportCommandPlan } from './export.command.parser';
import { attachExportPdf } from './export.command.pdf';

const ITEMS_DESCRIPTION_WARNING =
  '--descripcion se usa solo cuando no hay --item: el detalle del comprobante sale de los items.';

function writeExportResult(
  result: ExportExecutionResult,
  options: {
    readonly environment: 'produccion' | 'testing';
    readonly outputJson: boolean;
    readonly previewShown: boolean;
    readonly raw: boolean;
  },
): void {
  if (options.outputJson) {
    writeTerminalJson(formatExportResultAsJson(result, { raw: options.raw }));

    return;
  }

  writeTerminalOutput(
    formatExportResultAsText(result, {
      environment: options.environment,
      previewShown: options.previewShown,
      raw: options.raw,
    }),
  );
}

function resolveWarnings(
  certificateWarningsList: readonly string[],
  input: { readonly description?: string; readonly items?: readonly unknown[] },
): string[] {
  const ignored = input.items && input.items.length > 0 && input.description?.trim() ? [ITEMS_DESCRIPTION_WARNING] : [];

  return [...certificateWarningsList, ...ignored];
}

/** Esc cuenta como no, igual que en A, B y C. */
async function promptForEmission(): Promise<boolean> {
  return chooseOne(
    `¿Querés emitir ${EXPORT_VOUCHER_KIND.displayName} ahora?`,
    [
      { name: 'Sí, emitir ahora', value: true },
      { name: 'No, dejar sin emitir', value: false },
    ],
    true,
    { escapeLabel: 'no emitir', escapeValue: false },
  );
}

export interface ExportCommandOptions {
  /** Avisos que arma quien llama, como los flags de A, B y C salteados en `arcli factura e`. */
  readonly extraWarnings?: readonly string[];
}

/**
 * Un comprobante por ejecucion: resuelve el payload contra WSFEX, muestra la vista previa si corresponde,
 * emite y, si hay CAE, genera el PDF.
 */
export async function executeExportCommand(command: Command, options: ExportCommandOptions = {}): Promise<void> {
  const globalOptions = getGlobalOptions(command);
  let spinner: ReturnType<typeof startSpinner> = null;

  try {
    const runtime = resolveArcaRuntime(globalOptions);
    const plan = parseExportCommandPlan(command, { defaultEmit: runtime.config.output.emitirPorDefecto });
    const useRaw = typeof globalOptions.bruto === 'boolean' ? globalOptions.bruto : runtime.outputRaw;
    const interactive = !runtime.outputJson && Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const service = new ExportService();
    const gateway = new ArcaExportGateway(new ArcaClientFactory().createForExport(runtime));

    spinner = runtime.outputJson ? null : startSpinner('Consultando WSFEX...');

    const resolved = await service.resolve(plan.input, gateway, runtime);
    // Los avisos de la resolucion (por ejemplo, la cotizacion de un dia anterior) van con los del certificado.
    const warnings = [
      ...resolveWarnings(certificateWarnings(runtime), plan.input),
      ...(options.extraWarnings ?? []),
      ...(resolved.warnings ?? []),
    ];

    spinner?.stop();
    spinner = null;

    let result = service.preview(resolved, runtime, warnings);
    let previewShown = false;

    if (!plan.input.emit) {
      // Sin flags de emision y con terminal: se muestra la vista previa y se pregunta. Con --json o sin
      // terminal nadie puede responder, asi que queda en vista previa.
      if (plan.modeSource !== 'default' || !interactive) {
        writeExportResult(result, {
          environment: runtime.environment,
          outputJson: runtime.outputJson,
          previewShown: false,
          raw: useRaw,
        });

        return;
      }

      writeTerminalOutput(formatExportResultAsText(result, { environment: runtime.environment, raw: useRaw }));

      if (!(await promptForEmission())) {
        return;
      }

      previewShown = true;
    }

    spinner = runtime.outputJson ? null : startSpinner('Emitiendo comprobante...');

    result = await service.execute({ gateway, resolved, runtime, warnings });

    spinner?.stop();
    spinner = null;

    result = await attachExportPdf(result, {
      config: runtime.config,
      input: plan.input,
      interactive,
    });

    writeExportResult(result, {
      environment: runtime.environment,
      outputJson: runtime.outputJson,
      previewShown,
      raw: useRaw,
    });

    if (result.response.status === 'rechazado') {
      process.exitCode = REJECTED_EXIT_CODE;
    }

    if (result.pdf && !runtime.outputJson) {
      writeTerminalOutput(formatPdfOutcomeAsText(result.pdf));
    }
  } catch (error) {
    spinner?.stop();
    throw error;
  }
}
