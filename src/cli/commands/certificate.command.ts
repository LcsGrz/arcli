import { Command } from 'commander';
import { readFileSync } from 'node:fs';

import { AppError, InputValidationError } from '../../lib/errors/app-error';
import { maskPath } from '../../lib/paths/mask-path';
import {
  formatGeneratedRequestAsJson,
  formatGeneratedRequestAsText,
  formatImportedCertificateAsJson,
  formatImportedCertificateAsText,
} from '../../modules/certificates/certificate.presenter';
import { CertificateService, type ImportedCertificate } from '../../modules/certificates/certificate.service';
import type { ArcliEnvironment } from '../../modules/config/config.schemas';
import { ConfigService } from '../../modules/config/config.service';
import { writeTerminalJson, writeTerminalOutput } from '../../ui';
import { getGlobalOptions, registerEnvironmentOptions, registerJsonOption, resolveOutputJson } from '../global-options';
import { configureSpanishHelp } from '../help';
import { confirm, isPromptCancellation } from '../interactive/prompts';

interface CertificateCommandOptions {
  readonly alias?: string;
  readonly reemplazar?: boolean;
}

function withService<T>(run: (service: CertificateService, config: ConfigService) => T): T {
  const config = new ConfigService();

  try {
    return run(new CertificateService({ certificatesRoot: config.getCertificatesPath(), config }), config);
  } finally {
    config.close();
  }
}

/** `--testing` / `--produccion`; sin ninguno, `undefined` (cada subcomando decide su default). */
function explicitEnvironment(command: Command): ArcliEnvironment | undefined {
  const { produccion, testing } = getGlobalOptions(command);

  if (produccion && testing) {
    throw new InputValidationError('Usá --testing o --produccion, pero no ambos a la vez.');
  }

  return produccion ? 'produccion' : testing ? 'testing' : undefined;
}

function readCertificateFile(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new InputValidationError(`No se puede leer el certificado: ${maskPath(path)}.`);
  }
}

/** En una terminal pregunta antes de reemplazar el certificado configurado; sin terminal o con --json, --reemplazar. */
async function importWithConfirmation(
  service: CertificateService,
  options: { content: string; environment?: ArcliEnvironment; replace: boolean },
  interactive: boolean,
): Promise<ImportedCertificate> {
  try {
    return service.import(options);
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'CERTIFICATE_REPLACE_CONFIRMATION' || !interactive) {
      throw error;
    }

    writeTerminalOutput(error.message);

    try {
      if (!(await confirm('¿Lo reemplazamos por el nuevo?', 'Sí, reemplazar', 'No, dejar el actual'))) {
        throw error;
      }
    } catch (promptError) {
      throw isPromptCancellation(promptError) ? error : promptError;
    }

    return service.import({ ...options, replace: true });
  }
}

export function registerCertificateCommand(program: Command): void {
  const certificateCommand = program
    .command('certificado')
    .description('armar el pedido del certificado de ARCA y cargar el certificado que te devuelve');

  configureSpanishHelp(certificateCommand);

  const generarCommand = registerJsonOption(
    registerEnvironmentOptions(
      certificateCommand
        .command('generar')
        .description('crear la clave privada y el CSR para subir a ARCA; la clave actual sigue andando hasta importar'),
    ),
  )
    .option('--alias <alias>', 'nombre del certificado en ARCA (por defecto "arcli")')
    .option('--reemplazar', 'descartar un pedido anterior que todavía no importaste')
    .action((options: CertificateCommandOptions, command: Command) => {
      withService((service, config) => {
        const json = resolveOutputJson(command, config.getConfig());
        const request = service.generate({
          alias: options.alias,
          environment: explicitEnvironment(command) ?? config.getConfig().entornoPorDefecto,
          replace: options.reemplazar === true,
        });

        if (json) {
          writeTerminalJson(formatGeneratedRequestAsJson(request));

          return;
        }

        writeTerminalOutput(formatGeneratedRequestAsText(request));
      });
    });
  configureSpanishHelp(generarCommand);

  const importarCommand = registerJsonOption(
    registerEnvironmentOptions(
      certificateCommand
        .command('importar')
        .argument('<archivo>', 'el .crt que bajaste de ARCA')
        .description('validar el certificado, guardarlo y configurarlo; el entorno sale del certificado'),
    ),
  )
    .option('--reemplazar', 'reemplazar el certificado configurado sin preguntar')
    .action(async (file: string, options: CertificateCommandOptions, command: Command) => {
      const content = readCertificateFile(file);
      const config = new ConfigService();

      try {
        const json = resolveOutputJson(command, config.getConfig());
        const service = new CertificateService({ certificatesRoot: config.getCertificatesPath(), config });
        const imported = await importWithConfirmation(
          service,
          { content, environment: explicitEnvironment(command), replace: options.reemplazar === true },
          !json && Boolean(process.stdin.isTTY && process.stdout.isTTY),
        );

        if (json) {
          writeTerminalJson(formatImportedCertificateAsJson(imported));

          return;
        }

        writeTerminalOutput(formatImportedCertificateAsText(imported));
      } finally {
        config.close();
      }
    });
  configureSpanishHelp(importarCommand);
}
