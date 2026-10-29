import type { Command } from 'commander';

import { ExportService } from '../../modules/export/export.service';
import type { ExportExecutionResult } from '../../modules/export/export.types';
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
import { getGlobalOptions, registerGlobalOptions } from '../global-options';
import { configureSpanishHelp } from '../help';
import { confirm } from '../interactive/prompts';
import { startSpinner } from '../spinner';

import { REJECTED_EXIT_CODE } from './billing.command.shared';
import { registerExportOptions } from './export.command.options';
import { parseExportCommandPlan } from './export.command.parser';
import { attachExportPdf } from './export.command.pdf';

export const EXPORT_COMMAND_NAME = 'factura-exportacion';

const ITEMS_DESCRIPTION_WARNING =
  '--descripcion se usa solo cuando no hay --item: el detalle del comprobante sale de los items.';

const EXPORT_HELP = `
Ejemplos:
  arcli fe --monto 1500 --cliente "ACME LLC" --id-impositivo "12-3456789" \\
    --domicilio-cliente "123 Main St" --pais-destino 203 \\
    --item "001|Servicios de consultoria|1|1500|unidad" --previsualizar

  arcli fe --monto 1500 --cliente "ACME LLC" --domicilio-cliente "123 Main St" \\
    --pais-destino Brasil --tipo-expo 1 --incoterm FOB --misma-moneda --emitir --json

  arcli ${EXPORT_COMMAND_NAME} --cargar factura-e.json --emitir --exportar-pdf

Por defecto la exportación es de servicios (--tipo-expo 2), en dólares (--moneda DOL), con la actividad 620900
(servicios de informática N.C.P.) y con forma de pago "Transferencia Internacional".
El pago de la exportación se cancela en moneda extranjera: con --misma-moneda ARCA recibe CanMisMonExt = S.
La vista previa consulta las tablas y la numeración de WSFEX, pero no emite nada.
Los permisos de embarque van con --permiso y --permiso-existente, solo con --tipo-expo 1.`;

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

/**
 * Un comprobante por ejecucion: resuelve el payload contra WSFEX, muestra la vista previa si corresponde,
 * emite y, si hay CAE, genera el PDF.
 */
export async function executeExportCommand(command: Command): Promise<void> {
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
    const warnings = [...resolveWarnings(certificateWarnings(runtime), plan.input), ...(resolved.warnings ?? [])];

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

      const confirmed = await confirm('¿Emitimos la factura de exportacion ahora?', 'Si, emitir ahora', 'No');

      if (!confirmed) {
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

/** `arcli factura-exportacion` con alias `arcli fe`. */
export function registerExportCommand(program: Command): void {
  const command = program
    .command(EXPORT_COMMAND_NAME)
    .description('factura de exportación E (WSFEX): previsualizar o emitir con items, incoterm y país de destino')
    .alias('fe');

  configureSpanishHelp(command);
  registerGlobalOptions(command);
  registerExportOptions(command);

  command.action(async () => {
    await executeExportCommand(command);
  });

  command.addHelpText('after', EXPORT_HELP);
}
