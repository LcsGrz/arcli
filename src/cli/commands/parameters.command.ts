import type { Command } from 'commander';

import { formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { AppError, InputValidationError } from '../../lib/errors/app-error';
import { filterCurrentEntries, resolveParameterTable, salesPointToEntry } from '../../modules/parameters/parameters';
import {
  formatParameterEntriesAsJson,
  formatParameterEntriesAsText,
  formatParameterTablesAsJson,
  formatParameterTablesAsText,
  formatQuotationAsJson,
  formatQuotationAsText,
  formatStatusAsJson,
  formatStatusAsText,
} from '../../modules/parameters/parameters.presenter';
import { buildStatusReport } from '../../modules/parameters/status';
import { ArcaParametersGateway } from '../../services/arca/arca-parameters.gateway';
import { writeTerminalJson, writeTerminalOutput } from '../../ui';
import { type ArcaQuery, createArcaQuery, withQuerySpinner, writeQueryOutput } from '../arca-query';
import { registerQueryOptions, resolveOutputJson } from '../global-options';
import { configureSpanishHelp } from '../help';

function createContext(command: Command): ArcaQuery<ArcaParametersGateway> {
  return createArcaQuery(command, (arca) => new ArcaParametersGateway(arca));
}

export function registerParametersCommands(program: Command): void {
  const parameters = program
    .command('parametros')
    .argument('[tabla]', 'tabla a consultar; sin tabla lista las disponibles')
    .argument('[moneda]', 'solo para "cotizacion": código de moneda, por ejemplo USD')
    .description('consultar tablas de ARCA: puntos de venta, tipos, alícuotas, monedas y cotización');

  registerQueryOptions(parameters);
  configureSpanishHelp(parameters);

  parameters.action(
    async (rawTable: string | undefined, currency: string | undefined, _options: unknown, self: Command) => {
      if (!rawTable) {
        // No consulta ARCA: no hace falta config ni credenciales para ver las tablas (si la config no se puede
        // leer, sale en texto salvo con --json).
        if (resolveOutputJson(self)) {
          writeTerminalJson(formatParameterTablesAsJson());
        } else {
          writeTerminalOutput(formatParameterTablesAsText());
        }

        return;
      }

      if (rawTable.trim().toLowerCase() === 'cotizacion') {
        if (!currency) {
          throw new InputValidationError('Indicá la moneda, por ejemplo: arcli parametros cotizacion USD.');
        }

        const { gateway, runtime } = createContext(self);
        const quotation = await withQuerySpinner(runtime, () => gateway.getQuotation(currency));

        writeQueryOutput(runtime, {
          json: () => formatQuotationAsJson(quotation, runtime.environment),
          text: () => formatQuotationAsText(quotation, runtime.environment),
        });

        return;
      }

      const table = resolveParameterTable(rawTable);
      const { gateway, runtime } = createContext(self);
      const entries = await withQuerySpinner(runtime, async () =>
        table === 'puntos-venta'
          ? (await gateway.getSalesPoints()).map(salesPointToEntry)
          : filterCurrentEntries(await gateway.listTable(table), formatDateAsArcaDate(new Date())),
      );

      writeQueryOutput(runtime, {
        json: () => formatParameterEntriesAsJson(table, entries, runtime.environment),
        text: () => formatParameterEntriesAsText(table, entries, runtime.environment),
      });
    },
  );

  const status = program
    .command('estado')
    .description('ver si ARCA responde y si el punto de venta configurado está habilitado');

  registerQueryOptions(status);
  configureSpanishHelp(status);

  status.action(async (_options: unknown, self: Command) => {
    const { gateway, runtime } = createContext(self);
    const report = await withQuerySpinner(runtime, async () => {
      try {
        return await buildStatusReport({ environment: runtime.environment, gateway, pointOfSale: runtime.pointOfSale });
      } catch (error) {
        throw new AppError(`ARCA no respondió: ${error instanceof Error ? error.message : String(error)}`, {
          code: 'ARCA_UNAVAILABLE',
        });
      }
    });

    writeQueryOutput(runtime, { json: () => formatStatusAsJson(report), text: () => formatStatusAsText(report) });
  });
}
