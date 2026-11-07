import type { Command } from 'commander';

import { AppError } from '../../lib/errors/app-error';
import { formatEnvironmentLabel } from '../../modules/config/config.schemas';
import { formatPadronAsJson, formatPadronAsText } from '../../modules/padron/padron.presenter';
import { ArcaPadronGateway } from '../../services/arca/arca-padron.gateway';
import { createArcaQuery, withQuerySpinner, writeQueryOutput } from '../arca-query';
import { registerQueryOptions } from '../global-options';
import { configureSpanishHelp, createPadronHelp } from '../help';

import { parseCuitArgument } from './cuit-argument';

export function registerPadronCommand(program: Command): void {
  const command = program
    .command('padron')
    .argument('<cuit>', 'CUIT a consultar')
    .description('consultar en el padrón de ARCA el nombre, domicilio y condición IVA de un CUIT')
    .addHelpText('after', createPadronHelp());

  registerQueryOptions(command);
  configureSpanishHelp(command);

  command.action(async (rawCuit: string, _options: unknown, self: Command) => {
    const cuit = parseCuitArgument(rawCuit);
    const { gateway, runtime } = createArcaQuery(self, (arca) => new ArcaPadronGateway(arca));
    const taxpayer = await withQuerySpinner(runtime, () => gateway.getTaxpayer(cuit), 'Consultando el padrón...');

    if (!taxpayer) {
      throw new AppError(
        `El CUIT ${cuit} no figura en el padrón de ARCA (${formatEnvironmentLabel(runtime.environment)}).`,
        {
          code: 'TAXPAYER_NOT_FOUND',
          suggestion:
            runtime.environment === 'testing'
              ? 'El padrón de testing tiene datos ficticios: probá con 20201797064.'
              : 'Revisá el número.',
        },
      );
    }

    const report = { environment: runtime.environment, taxpayer };

    writeQueryOutput(runtime, { json: () => formatPadronAsJson(report), text: () => formatPadronAsText(report) });
  });
}
