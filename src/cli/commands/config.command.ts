import { Command } from 'commander';
import { join } from 'node:path';

import { errorText } from '../../lib/files/file-error';
import {
  formatConfigAsText,
  formatConfigChangeWarnings,
  formatConfigDoctorAsText,
  serializeConfig,
  serializeConfigDoctor,
  serializeConfigPath,
} from '../../modules/config/config.presenter';
import {
  type ArcliConfig,
  type ArcliEnvironment,
  COTIZACION_DEPRECATION_WARNING,
} from '../../modules/config/config.schemas';
import { type ConfigChange, ConfigService, deprecatedConfigKeyWarning } from '../../modules/config/config.service';
import { buildConfigDoctorReport, type ConfigDoctorRuntimeCheck } from '../../modules/config/config-doctor';
import { acceptsAlias } from '../../modules/config/config-keys';
import { PdfPlugin } from '../../services/pdf/pdf-plugin';
import { writeTerminalJson, writeTerminalNotice, writeTerminalOutput } from '../../ui';
import { checkProfileFromConfig } from '../arca-runtime';
import { registerJsonOption, resolveOutputJson } from '../global-options';
import { configureSpanishHelp, createConfigHelp, createConfigSetHelp } from '../help';
import { startSpinner } from '../spinner';

function createConfigService(): ConfigService {
  const service = new ConfigService();
  service.ensureInitialized();

  return service;
}

function printConfigResult(textValue: string, jsonValue: object, useJson = false): void {
  if (useJson) {
    writeTerminalJson(jsonValue);
    return;
  }

  writeTerminalOutput(textValue);
}

/** La config como quedo y los avisos (otras claves que siguen rotas, el alias que se borro): con JSON van en `avisos`. */
function printConfigChange(
  service: ConfigService,
  { config, pending, warnings }: ConfigChange,
  command: Command,
): void {
  const paths = service.resolvePaths(config);
  const useJson = resolveOutputJson(command, config);

  printConfigResult(
    formatConfigAsText(config, paths, pending),
    serializeConfig(config, paths, pending, warnings),
    useJson,
  );

  if (!useJson) {
    writeTerminalNotice(() => formatConfigChangeWarnings(pending, warnings));
  }
}

/** Una clave deprecada (`comprobantesPorLista`, `cbu`) sigue andando: se avisa para que la cambien. */
function warnIfDeprecatedKey(key: string, action: 'eliminar' | 'establecer'): void {
  const warning = deprecatedConfigKeyWarning(key, action);

  if (warning) {
    writeTerminalNotice(() => warning);
  }
}

/**
 * Solo `cuenta` lleva un tercer argumento: para las demas claves sobra, con el mismo error de commander que si no
 * estuviera declarado.
 */
function rejectExcessArguments(key: string, command: Command): void {
  const expected = acceptsAlias(key) ? 3 : 2;

  if (command.args.length > expected) {
    command.error(
      `error: too many arguments for '${command.name()}'. Expected ${expected} arguments but got ${command.args.length}: ${command.args.join(', ')}.`,
      { code: 'commander.excessArguments' },
    );
  }
}

const ENVIRONMENTS: readonly ArcliEnvironment[] = ['testing', 'produccion'];

/** Valida el entorno por defecto y cualquier otro que tenga cert o key cargados: `revisar` cubre los dos. */
export function buildRuntimeChecks(config: ArcliConfig): ConfigDoctorRuntimeCheck[] {
  return ENVIRONMENTS.filter(
    (environment) =>
      environment === config.entornoPorDefecto || Boolean(config.cert[environment] || config.key[environment]),
  ).map((environment) => {
    try {
      checkProfileFromConfig(config, environment);

      return { environment };
    } catch (error) {
      return {
        environment,
        error: errorText(error),
      };
    }
  });
}

export function registerConfigCommand(program: Command): void {
  const configCommand = program
    .command('config')
    .description('guardar valores por defecto y credenciales, y revisar si el CLI está listo para emitir');

  configureSpanishHelp(configCommand);

  registerJsonOption(configCommand).action((_options: unknown, command: Command) => {
    const service = createConfigService();

    try {
      const config = service.getConfig();
      const paths = service.resolvePaths(config);
      printConfigResult(
        formatConfigAsText(config, paths),
        serializeConfig(config, paths),
        resolveOutputJson(command, config),
      );
    } finally {
      service.close();
    }
  });

  configCommand.addHelpText('after', createConfigHelp());

  const revisarCommand = configCommand
    .command('revisar')
    .description('revisar configuración, valores por defecto, credenciales y validación de cada entorno')
    .action((_options: unknown, command: Command) => {
      const service = createConfigService();
      let spinner: ReturnType<typeof startSpinner> = null;

      try {
        const config = service.getConfig();
        const useJson = resolveOutputJson(command, config);
        spinner = useJson ? null : startSpinner('Generando revisión...');
        const pdfPlugin = new PdfPlugin({
          configuredBrowser: config.pdfNavegador,
          path: join(service.getPluginsPath(), 'pdf'),
        }).getStatus();
        const report = buildConfigDoctorReport(config, new Date(), buildRuntimeChecks(config), pdfPlugin);
        spinner?.stop();
        printConfigResult(formatConfigDoctorAsText(report), serializeConfigDoctor(report), useJson);
      } catch (error) {
        spinner?.stop();
        throw error;
      } finally {
        service.close();
      }
    });
  registerJsonOption(revisarCommand);
  configureSpanishHelp(revisarCommand);

  const rutaCommand = registerJsonOption(
    configCommand.command('ruta').description('mostrar la ruta del archivo de configuración'),
  ).action((_options: unknown, command: Command) => {
    const service = createConfigService();

    try {
      const path = service.getPath();

      printConfigResult(path, serializeConfigPath(path), resolveOutputJson(command, service.getConfig()));
    } finally {
      service.close();
    }
  });
  configureSpanishHelp(rutaCommand);

  const establecerCommand = configCommand
    .command('establecer')
    .description('guardar un valor de configuración')
    .argument('<clave>', 'clave pública de configuración')
    .argument('<valor>', 'valor a guardar; en `cuenta`, el CBU')
    .argument('[alias]', 'solo en `cuenta`: el alias del CBU; sin él, se borra el guardado')
    .allowExcessArguments()
    .addHelpText('after', createConfigSetHelp())
    .action((key: string, value: string, alias: string | undefined, _options: unknown, command: Command) => {
      rejectExcessArguments(key, command);

      // Sin ensureInitialized: si la config quedo invalida, establecer o eliminar la clave es la forma de arreglarla.
      const service = new ConfigService();

      try {
        const change = service.repairValue(key, value, alias);

        if (key === 'cotizacion') {
          writeTerminalNotice(() => COTIZACION_DEPRECATION_WARNING);
        }

        warnIfDeprecatedKey(key, 'establecer');

        printConfigChange(service, change, command);
      } finally {
        service.close();
      }
    });
  registerJsonOption(establecerCommand);
  configureSpanishHelp(establecerCommand);

  const eliminarCommand = configCommand
    .command('eliminar')
    .description('eliminar un valor de configuración')
    .argument('<clave>', 'clave pública de configuración')
    .action((key: string, _options: unknown, command: Command) => {
      // Sin ensureInitialized: si la config quedo invalida, establecer o eliminar la clave es la forma de arreglarla.
      const service = new ConfigService();

      try {
        const change = service.repairUnset(key);

        warnIfDeprecatedKey(key, 'eliminar');
        printConfigChange(service, change, command);
      } finally {
        service.close();
      }
    });
  registerJsonOption(eliminarCommand);
  configureSpanishHelp(eliminarCommand);
}
