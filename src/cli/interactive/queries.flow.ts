import { formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { formatCuit } from '../../lib/identity/format-cuit';
import { toIsoCurrencyCode } from '../../modules/billing/currency-codes';
import { resolveRowsPerList } from '../../modules/config/config.schemas';
import { formatFceObligationAsText } from '../../modules/fce/fce-obligation.presenter';
import { BACK } from '../../modules/interactive/wizard';
import { taxpayerNotFoundError } from '../../modules/padron/padron';
import { formatPadronAsText } from '../../modules/padron/padron.presenter';
import {
  filterCurrentEntries,
  PARAMETER_TABLE_NAMES,
  PARAMETER_TABLES,
  type ParameterEntry,
  type ParameterTable,
  quotableCurrencies,
  type Quotation,
  salesPointToEntry,
} from '../../modules/parameters/parameters';
import {
  formatParameterEntriesAsText,
  formatParameterRows,
  formatQuotationAsText,
  PARAMETER_TABLE_HELP,
} from '../../modules/parameters/parameters.presenter';
import { ArcaFceObligationGateway } from '../../services/arca/arca-fce-obligation.gateway';
import { ArcaPadronGateway } from '../../services/arca/arca-padron.gateway';
import { ArcaParametersGateway } from '../../services/arca/arca-parameters.gateway';
import { writeTerminalError, writeTerminalOutput } from '../../ui';
import { formatCliError } from '../error-output';
import { withSpinner } from '../spinner';

import { runHistoryFlow } from './history.flow';
import { runInvoiceFlow } from './invoice.flow';
import { runMonotributoQuery } from './monotributo.flow';
import { markIfNew } from './new-mark';
import {
  askTextStep,
  BACK_CHOICE,
  browseFilterList,
  chooseFromFilterList,
  chooseOne,
  chooseStep,
  confirm,
  FILTER_LIST_EXTRA_LINES,
  fitPageSize,
  isPromptCancellation,
} from './prompts';
import type { InteractiveSession } from './session';
import { normalizeDocumentNumber, validateCuit } from './validators';

type QueryOption = 'comprobantes' | 'cotizacion' | 'cuit' | 'fce' | 'monotributo' | 'tablas';

/** Lo que pasa despues de una consulta: seguir en el submenu, o volver al menu principal (se emitio una factura). */
type QueryOutcome = 'menu' | 'seguir';

/** Filas por pagina de las tablas de ARCA: las mismas que en las listas de comprobantes (`filasPorLista`). */
function rowsPerPage(session: InteractiveSession): number {
  return resolveRowsPerList(session.runtime.config);
}

/**
 * "Datos de un CUIT", como `arcli padron`. Despues ofrece emitirle una factura, con el CUIT y la condicion IVA ya
 * cargados.
 */
async function runPadronQuery(session: InteractiveSession): Promise<QueryOutcome> {
  const answer = await askTextStep('CUIT a consultar:', { validate: validateCuit });

  if (answer === BACK) {
    return 'seguir';
  }

  const cuit = normalizeDocumentNumber(answer);
  const { environment } = session.runtime;
  const taxpayer = await withSpinner('Consultando el padrón...', () =>
    new ArcaPadronGateway(session.arca).getTaxpayer(cuit),
  );

  if (!taxpayer) {
    throw taxpayerNotFoundError(cuit, environment);
  }

  writeTerminalOutput(formatPadronAsText({ environment, taxpayer }));

  const receiver = {
    address: taxpayer.address ?? undefined,
    cuit,
    ivaCondition: taxpayer.ivaCondition ?? undefined,
    name: taxpayer.name ?? undefined,
  };

  for (;;) {
    const emit = await confirm(
      `¿Le emitimos una factura a ${taxpayer.name ?? formatCuit(cuit)}?`,
      'Emitir una factura a este CUIT',
      'No, volver',
    );

    if (!emit) {
      return 'seguir';
    }

    // Volver desde el primer paso de la factura vuelve a esta pregunta.
    if ((await runInvoiceFlow(session, undefined, receiver)) !== BACK) {
      return 'menu';
    }
  }
}

/** "Si un cliente recibe FCE", como `arcli fce-obligado` con la fecha de hoy. */
async function runFceObligationQuery(session: InteractiveSession): Promise<void> {
  const answer = await askTextStep('CUIT del cliente:', { validate: validateCuit });

  if (answer === BACK) {
    return;
  }

  const cuit = normalizeDocumentNumber(answer);
  const issueDate = formatDateAsArcaDate(new Date());
  const obligation = await withSpinner('Consultando ARCA...', () =>
    new ArcaFceObligationGateway(session.arca).getObligation(cuit, issueDate),
  );

  writeTerminalOutput(
    formatFceObligationAsText({ cuit, environment: session.runtime.environment, issueDate, obligation }),
  );
}

async function loadTable(session: InteractiveSession, table: ParameterTable): Promise<ParameterEntry[]> {
  const gateway = new ArcaParametersGateway(session.arca);

  return withSpinner('Consultando ARCA...', async () =>
    table === 'puntos-venta'
      ? (await gateway.getSalesPoints()).map(salesPointToEntry)
      : filterCurrentEntries(await gateway.listTable(table), formatDateAsArcaDate(new Date())),
  );
}

/**
 * "Monedas y cotizaciones": la tabla de monedas de ARCA (sin el peso), que se filtra por nombre o codigo ("eur" o
 * "060"); Enter muestra la cotizacion oficial, como `arcli parametros cotizacion`, y vuelve a la lista. ARCA da la
 * cotizacion de a una moneda: cada una se pide la primera vez que se elige y despues sale de lo ya consultado.
 */
async function runQuotationQuery(session: InteractiveSession): Promise<void> {
  const currencies = quotableCurrencies(await loadTable(session, 'monedas'));
  const { header, rows } = formatParameterRows('monedas', currencies);
  const choices = currencies.map((entry, index) => ({
    // El ISO tambien sirve para buscar: "usd" encuentra el dolar aunque ARCA lo llame DOL.
    keywords: toIsoCurrencyCode(entry.id),
    label: rows[index] ?? entry.id,
    short: entry.description,
    value: entry.id,
  }));
  const quotations = new Map<string, Quotation>();
  let last: string | undefined;

  for (;;) {
    const currency = await chooseFromFilterList('¿De qué moneda?', choices, {
      defaultValue: last,
      header,
      help: 'Escribí el nombre o el código, por ejemplo "eur" o "060", y Enter muestra la cotización oficial.',
      pageSize: Math.min(rowsPerPage(session), fitPageSize(choices.length, { extraLines: FILTER_LIST_EXTRA_LINES })),
    });

    if (currency === BACK) {
      return;
    }

    last = currency;

    const quotation =
      quotations.get(currency) ??
      (await withSpinner('Consultando la cotización...', () =>
        new ArcaParametersGateway(session.arca).getQuotation(currency),
      ));

    quotations.set(currency, quotation);

    writeTerminalOutput(
      formatQuotationAsText(quotation, session.runtime.environment, {
        currencyName: currencies.find((entry) => entry.id === currency)?.description,
      }),
    );
  }
}

/** Las tablas de "Tablas de ARCA": las de `arcli parametros` menos monedas, que esta en "Monedas y cotizaciones". */
const BROWSABLE_TABLES = PARAMETER_TABLE_NAMES.filter((name) => name !== 'monedas');

/**
 * "Tablas de ARCA": las mismas de `arcli parametros`, menos monedas. Una tabla que entra en una pagina se muestra en su panel; una
 * mas larga, en una lista que se filtra escribiendo y se desplaza con las flechas.
 */
async function runTablesQuery(session: InteractiveSession): Promise<void> {
  let last: ParameterTable | undefined;

  for (;;) {
    const table = await chooseStep<ParameterTable>(
      '¿Qué tabla querés ver?',
      BROWSABLE_TABLES.map((name) => ({
        description: PARAMETER_TABLE_HELP[name],
        name: PARAMETER_TABLES[name],
        value: name,
      })),
      last,
    );

    if (table === BACK) {
      return;
    }

    last = table;

    const entries = await loadTable(session, table);
    const pageSize = rowsPerPage(session);

    if (entries.length <= pageSize) {
      writeTerminalOutput(formatParameterEntriesAsText(table, entries, session.runtime.environment));
      continue;
    }

    const { header, rows } = formatParameterRows(table, entries);

    await browseFilterList(PARAMETER_TABLES[table], rows, {
      header,
      help: PARAMETER_TABLE_HELP[table],
      pageSize: Math.min(pageSize, fitPageSize(rows.length, { extraLines: FILTER_LIST_EXTRA_LINES })),
    });
  }
}

async function runQuery(session: InteractiveSession, option: QueryOption): Promise<QueryOutcome> {
  switch (option) {
    case 'comprobantes':
      await runHistoryFlow(session);
      return 'seguir';
    case 'cuit':
      return runPadronQuery(session);
    case 'fce':
      await runFceObligationQuery(session);
      return 'seguir';
    case 'cotizacion':
      await runQuotationQuery(session);
      return 'seguir';
    case 'monotributo':
      await runMonotributoQuery(session);
      return 'seguir';
    case 'tablas':
      await runTablesQuery(session);
      return 'seguir';
  }
}

/**
 * Submenu "Consultas": los comprobantes emitidos y lo que el CLI consulta con `padron`, `fce-obligado`,
 * `monotributo` y `parametros`. Un error de ARCA se muestra y vuelve a este submenu; Ctrl+C vuelve al menu principal.
 */
export async function runQueriesMenu(session: InteractiveSession): Promise<void> {
  let last: QueryOption | undefined;

  for (;;) {
    const option = await chooseOne<QueryOption | typeof BACK>(
      '¿Qué querés consultar?',
      [
        {
          description: 'Los últimos de cada tipo, o buscar uno por número',
          name: 'Mis comprobantes',
          value: 'comprobantes',
        },
        markIfNew(
          { description: 'Nombre, domicilio y condición frente al IVA', name: 'Datos de un CUIT', value: 'cuit' },
          'consultas',
        ),
        markIfNew(
          {
            description: 'Si está obligado a recibir Factura de Crédito Electrónica, y desde qué importe',
            name: 'Si un cliente recibe FCE',
            value: 'fce',
          },
          'consultas',
        ),
        markIfNew(
          {
            description: 'Las monedas de ARCA y la cotización oficial de cada una',
            name: 'Monedas y cotizaciones',
            value: 'cotizacion',
          },
          'consultas',
        ),
        markIfNew(
          {
            description: 'Topes de ingresos y cuota mensual de cada categoría',
            name: 'Categorías del monotributo',
            value: 'monotributo',
          },
          'monotributo',
        ),
        markIfNew(
          {
            description: 'Puntos de venta, comprobantes, documentos, alícuotas y más',
            name: 'Tablas de ARCA',
            value: 'tablas',
          },
          'consultas',
        ),
      ],
      last,
      { back: { label: BACK_CHOICE.name, value: BACK }, escapeValue: BACK },
    );

    if (option === BACK) {
      return;
    }

    last = option;

    try {
      if ((await runQuery(session, option)) === 'menu') {
        return;
      }
    } catch (error) {
      if (isPromptCancellation(error)) {
        throw error;
      }

      writeTerminalError(() => formatCliError(error, false));
    }
  }
}
