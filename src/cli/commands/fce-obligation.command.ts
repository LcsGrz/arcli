import type { Command } from 'commander';

import { formatDateAsArcaDate, parseArgentineDateInputAsArcaDate } from '../../lib/dates/arca-date';
import { formatFceObligationAsJson, formatFceObligationAsText } from '../../modules/fce/fce-obligation.presenter';
import { ArcaFceObligationGateway } from '../../services/arca/arca-fce-obligation.gateway';
import { createArcaQuery, withQuerySpinner, writeQueryOutput } from '../arca-query';
import { registerQueryOptions } from '../global-options';
import { configureSpanishHelp, createFceObligationHelp } from '../help';

import { parseCuitArgument } from './cuit-argument';

export function registerFceObligationCommand(program: Command): void {
  const command = program
    .command('fce-obligado')
    .argument('<cuit>', 'CUIT del receptor a consultar')
    .description('consultar si un receptor está obligado a recibir Factura de Crédito Electrónica (FCE)')
    .option('-f, --fecha <fecha>', 'fecha de emisión a consultar; por defecto hoy')
    .addHelpText('after', createFceObligationHelp());

  registerQueryOptions(command);
  configureSpanishHelp(command);

  command.action(async (rawCuit: string, options: { fecha?: string }, self: Command) => {
    const cuit = parseCuitArgument(rawCuit);
    const issueDate = options.fecha
      ? parseArgentineDateInputAsArcaDate(options.fecha)
      : formatDateAsArcaDate(new Date());
    const { gateway, runtime } = createArcaQuery(self, (arca) => new ArcaFceObligationGateway(arca));
    const obligation = await withQuerySpinner(runtime, () => gateway.getObligation(cuit, issueDate));
    const report = { cuit, environment: runtime.environment, issueDate, obligation };

    writeQueryOutput(runtime, {
      json: () => formatFceObligationAsJson(report),
      text: () => formatFceObligationAsText(report),
    });
  });
}
