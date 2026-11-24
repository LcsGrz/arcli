import type { Command } from 'commander';

import { InputValidationError } from '../../lib/errors/app-error';
import { resolveEnvironment } from '../../modules/config/arca-profile';
import { type ArcliConfig, CONFIG_DEFAULTS } from '../../modules/config/config.schemas';
import { ConfigService } from '../../modules/config/config.service';
import { type MonotributoCategoryLetter, parseMonotributoLetter } from '../../modules/monotributo/monotributo';
import {
  formatMonotributoCategoryAsText,
  formatMonotributoFullAsText,
  formatMonotributoNotices,
  formatMonotributoSummaryAsText,
  serializeMonotributo,
} from '../../modules/monotributo/monotributo.presenter';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { writeTerminalJson, writeTerminalNotice, writeTerminalOutput } from '../../ui';
import { loadArcaRuntime } from '../arca-runtime';
import { getGlobalOptions, registerQueryOptions, resolveOutputJson } from '../global-options';
import { configureSpanishHelp, createMonotributoHelp } from '../help';
import { loadMonotributoReport } from '../monotributo-report';

interface MonotributoCommandOptions {
  readonly actualizar?: boolean;
  readonly categoria?: string;
  readonly completa?: boolean;
}

/** La tabla no necesita config: si no se puede leer, se muestra igual, sin la categoria propia. */
function readConfigIfAny(): ArcliConfig | undefined {
  try {
    const service = new ConfigService();

    try {
      return service.getConfig();
    } finally {
      service.close();
    }
  } catch {
    return undefined;
  }
}

function parseCategoryOption(value: string | undefined): MonotributoCategoryLetter | undefined {
  if (value === undefined) return undefined;

  const letter = parseMonotributoLetter(value);

  if (!letter) {
    throw new InputValidationError(`\`--categoria\` "${value}" no es válido: usá una letra de la A a la K.`);
  }

  return letter;
}

export function registerMonotributoCommand(program: Command): void {
  const command = program
    .command('monotributo')
    .description('ver las categorías del monotributo: hasta cuánto podés facturar y cuánto pagás por mes')
    .option('--categoria <letra>', 'ver una categoría completa, de la A a la K')
    .option('--completa', 'ver todas las columnas: límites anuales y cuota mensual')
    .option('--actualizar', 'volver a leer la tabla en la página de ARCA')
    .addHelpText('after', createMonotributoHelp());

  registerQueryOptions(command);
  configureSpanishHelp(command);

  command.action(async (options: MonotributoCommandOptions, self: Command) => {
    const letter = parseCategoryOption(options.categoria);

    if (letter && options.completa) {
      throw new InputValidationError('Usá `--categoria` o `--completa`, no los dos.');
    }

    const globalOptions = getGlobalOptions(self);
    const config = readConfigIfAny();
    const environment = resolveEnvironment(globalOptions, config ?? CONFIG_DEFAULTS);
    const outputJson = resolveOutputJson(self, config);
    const report = await loadMonotributoReport({
      config,
      createArca: () => new ArcaClientFactory().create(loadArcaRuntime(globalOptions)),
      environment,
      quiet: outputJson,
      refresh: options.actualizar === true,
    });

    if (outputJson) {
      writeTerminalJson(serializeMonotributo(report, letter));

      return;
    }

    // Los avisos (tabla vieja, sin conexion, pagina cambiada) a stderr, arriba de la tabla.
    writeTerminalNotice(() => formatMonotributoNotices(report.notices));
    writeTerminalOutput(
      letter
        ? formatMonotributoCategoryAsText(report, letter)
        : options.completa
          ? formatMonotributoFullAsText(report)
          : formatMonotributoSummaryAsText(report, { hints: true }),
    );
  });
}
