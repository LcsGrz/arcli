import type { Command } from 'commander';

import {
  formatEmissionQuestion,
  formatVoucherWithArticle,
  NOTHING_EMITTED_NOTICE,
} from '../../modules/billing/billing.mappers';
import { formatExportResultAsJson, formatExportResultAsText } from '../../modules/export/export.presenter';
import { ExportService } from '../../modules/export/export.service';
import {
  EXPORT_VOUCHER_KIND,
  type ExportExecutionResult,
  type ExportGateway,
  type ExportVoucherKind,
} from '../../modules/export/export.types';
import { formatPdfOutcomeAsText } from '../../modules/pdf/pdf.presenter';
import { planEmissionConfirmation, resolvePdfAfterConfirmation } from '../../modules/pdf/pdf-decision';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { systemClock } from '../../services/time/system-clock';
import { noticePanel, writeTerminalJson, writeTerminalOutput } from '../../ui';
import { certificateWarnings, type CliArcaRuntime, resolveArcaRuntime } from '../arca-runtime';
import { getGlobalOptions } from '../global-options';
import { askEmission } from '../interactive/emission-prompt';
import { startSpinner } from '../spinner';

import { REJECTED_EXIT_CODE } from './billing.command.shared';
import { parseExportCommandPlan } from './export.command.parser';
import { attachExportPdf } from './export.command.pdf';

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

export interface ExportCommandOptions {
  /** Avisos que arma quien llama, como los flags de A, B y C salteados en `arcli factura e`. */
  readonly extraWarnings?: readonly string[];
  /** Factura, nota de debito o nota de credito E. Sin esto, factura. */
  readonly voucherKind?: ExportVoucherKind;
}

/** Lo que el comando toma de afuera: en los tests, una config y un WSFEX falsos. */
export interface ExportCommandDependencies {
  readonly createGateway: (runtime: CliArcaRuntime) => ExportGateway;
  readonly resolveRuntime: typeof resolveArcaRuntime;
}

const DEFAULT_DEPENDENCIES: ExportCommandDependencies = {
  createGateway: (runtime) => new ArcaClientFactory().createExportGateway(runtime),
  resolveRuntime: resolveArcaRuntime,
};

/**
 * Un comprobante por ejecucion: resuelve el payload contra WSFEX, muestra la vista previa si corresponde,
 * emite y, si hay CAE, genera el PDF.
 */
export async function executeExportCommand(
  command: Command,
  options: ExportCommandOptions = {},
  dependencies: ExportCommandDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  const globalOptions = getGlobalOptions(command);
  let spinner: ReturnType<typeof startSpinner> = null;

  try {
    const runtime = dependencies.resolveRuntime(globalOptions);
    const voucherKind = options.voucherKind ?? EXPORT_VOUCHER_KIND;
    const plan = parseExportCommandPlan(command, { defaultEmit: runtime.config.output.emitirPorDefecto, voucherKind });
    const useRaw = typeof globalOptions.bruto === 'boolean' ? globalOptions.bruto : runtime.outputRaw;
    const interactive = !runtime.outputJson && Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const service = new ExportService({ clock: systemClock });
    const gateway = dependencies.createGateway(runtime);

    spinner = runtime.outputJson ? null : startSpinner('Consultando WSFEX...');

    const resolved = await service.resolve(plan.input, gateway, runtime);
    // Los avisos de la resolucion (por ejemplo, la cotizacion de un dia anterior) van con los del certificado.
    const warnings = [
      ...certificateWarnings(runtime),
      ...plan.warnings,
      ...(options.extraWarnings ?? []),
      ...(resolved.warnings ?? []),
    ];

    spinner?.stop();
    spinner = null;

    let result = service.preview(resolved, runtime, warnings);
    let previewShown = false;
    let pdfInput = plan.input;

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

      // Esc cuenta como no, igual que en A, B y C. Si ningun flag decidio el PDF, la pregunta tambien lo decide.
      const choice = await askEmission(
        formatEmissionQuestion(formatVoucherWithArticle(voucherKind), runtime.environment),
        planEmissionConfirmation({ flags: [plan.input.pdf], mode: runtime.config.pdf }),
      );

      if (!choice) {
        writeTerminalOutput(noticePanel(NOTHING_EMITTED_NOTICE, 'muted'));

        return;
      }

      pdfInput = { ...plan.input, pdf: resolvePdfAfterConfirmation(plan.input.pdf, choice) };
      previewShown = true;
    }

    spinner = runtime.outputJson ? null : startSpinner(`Emitiendo ${formatVoucherWithArticle(voucherKind)} en ARCA...`);

    result = await service.execute({ gateway, resolved, runtime, warnings });

    spinner?.stop();
    spinner = null;

    result = await attachExportPdf(result, {
      config: runtime.config,
      input: pdfInput,
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
