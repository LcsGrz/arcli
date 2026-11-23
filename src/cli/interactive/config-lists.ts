import { ARCA_CURRENCIES, toArcaCurrencyCode } from '../../modules/billing/currency-codes';
import type { ExportActivity } from '../../modules/export/export.types';
import type { ConfigField } from '../../modules/interactive/config-fields';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { ArcaContextResolver } from '../../services/arca/arca-context.resolver';
import { formatTableRows, noticePanel, writeTerminalOutput } from '../../ui';
import { withSpinner } from '../spinner';
import type { GlobalCliOptions } from '../types';

import { type FilterListRow, sameSearch } from './filter-list';
import { ACTIVITY_HELP, activityRows } from './steps/export';

/**
 * Un dato de la config que se elige de una lista donde tambien se escribe (TUI-35, TUI-39). Lo escrito se valida y se
 * guarda como `arcli config establecer`; una fila guarda su `value`.
 */
export interface ConfigFieldList {
  readonly header?: string;
  readonly help?: string;
  /** La fila de lo guardado, si es una (USD guardado es la fila DOL); si no, lo guardado arranca escrito. */
  readonly previous?: (current: string) => string;
  readonly rows: ReadonlyArray<FilterListRow<string>>;
  /** Si la fila elegida es lo mismo que lo guardado ("Contado" y `contado`, DOL y USD): queda "Sin cambios.". */
  readonly same: (chosen: string, current: string) => boolean;
}

/** La condicion de venta y los demas datos con `choices` y `freeText`: sus valores, con su etiqueta. */
function choicesList(field: ConfigField & { readonly choices: readonly string[] }): ConfigFieldList {
  const label = (choice: string) => field.choiceLabels?.[choice] ?? choice;

  return {
    rows: field.choices.map((choice) => ({ keywords: choice, label: label(choice), value: choice })),
    same: (chosen, current) => sameSearch(label(chosen), current),
  };
}

/**
 * Las monedas de la tabla de ARCA (`ARCA_CURRENCIES`), sin consultar ARCA: el codigo de ARCA y el nombre, con el ISO
 * para buscar ("usd" encuentra DOL). Una fila guarda el codigo de ARCA, como el default `PES`.
 */
function currencyList(): ConfigFieldList {
  const { header, rows } = formatTableRows(
    ['CÓDIGO', 'MONEDA'],
    ARCA_CURRENCIES.map((currency) => [currency.arca, currency.name]),
  );

  return {
    header,
    help: 'Escribí el nombre o el código, por ejemplo "euro", "060" o "EUR".',
    previous: toArcaCurrencyCode,
    rows: ARCA_CURRENCIES.map((currency, index) => ({
      keywords: currency.iso,
      label: rows[index] ?? currency.arca,
      short: currency.name,
      value: currency.arca,
    })),
    same: (chosen, current) => chosen === toArcaCurrencyCode(current),
  };
}

/**
 * La tabla de actividades de WSFEX con el certificado con el que la consultan los comandos: el de exportacion o, si no
 * hay, el de facturacion (`ArcaClientFactory.createExportGateway`). Sin certificado o si ARCA falla, `undefined`: la
 * actividad se escribe, como antes, sin cortar el menu.
 */
async function loadActivities(flags: ConfigListFlags): Promise<readonly ExportActivity[] | undefined> {
  try {
    const runtime = new ArcaContextResolver({ options: flags }).resolve();

    return await withSpinner('Consultando las actividades de WSFEX...', () =>
      new ArcaClientFactory().createExportGateway(runtime).getActivities(),
    );
  } catch {
    writeTerminalOutput(
      noticePanel('No se pudo consultar la tabla de actividades de WSFEX: escribí el código.', 'muted'),
    );

    return undefined;
  }
}

type ConfigListFlags = Pick<GlobalCliOptions, 'produccion' | 'testing'>;

/**
 * Las listas de "Modificar configuracion", con la tabla de actividades consultada una vez por menu (si se consiguio).
 * Un dato sin lista, o la actividad sin tabla, se pregunta como texto.
 */
export function configFieldLists(
  flags: ConfigListFlags = {},
): (field: ConfigField) => Promise<ConfigFieldList | undefined> {
  let activities: readonly ExportActivity[] | undefined;

  return async (field) => {
    if (field.choices && field.freeText) {
      return choicesList({ ...field, choices: field.choices });
    }

    if (field.key === 'moneda') {
      return currencyList();
    }

    if (field.key === 'exportacion.actividad') {
      activities ??= await loadActivities(flags);

      if (!activities?.length) {
        return undefined;
      }

      const { header, rows } = activityRows(activities);

      return {
        header,
        help: ACTIVITY_HELP,
        rows: rows.map((row) => ({ ...row, value: String(row.value) })),
        same: (chosen, current) => chosen === current.trim(),
      };
    }

    return undefined;
  };
}
