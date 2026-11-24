import type { Command } from 'commander';

import { taxpayerNotFoundError } from '../../modules/padron/padron';
import { formatPadronAsText, serializePadron } from '../../modules/padron/padron.presenter';
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
      throw taxpayerNotFoundError(cuit, runtime.environment);
    }

    const report = { environment: runtime.environment, taxpayer };

    writeQueryOutput(runtime, { json: () => serializePadron(report), text: () => formatPadronAsText(report) });
  });
}
