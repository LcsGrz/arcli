import type { ExportActivity } from '../../modules/export/export.types';
import type { ConfigField } from '../../modules/interactive/config-fields';
import {
  configCurrencyOptions,
  type ConfigListKind,
  configListKind,
  configListPrefersTyped,
  configListPrevious,
  isSameConfigChoice,
} from '../../modules/interactive/config-lists';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { formatTableRows, noticePanel, writeTerminalOutput } from '../../ui';
import { loadArcaRuntime } from '../arca-runtime';
import { isPromptCancellation } from '../prompt-cancellation';
import type { GlobalCliOptions } from '../types';

import { waitForArca } from './arca-wait';
import type { FilterListRow } from './filter-list';
import { ACTIVITY_HELP, activityRows } from './steps/export';

/**
 * Un dato de la config que se elige de una lista donde tambien se escribe (TUI-35, TUI-39). Lo escrito se valida y se
 * guarda como `arcli config establecer`; una fila guarda su `value`. Las reglas (que lista, que fila es lo guardado,
 * cuando no hay cambios) son de `modules/interactive/config-lists`.
 */
interface ConfigFieldList {
  readonly header?: string;
  readonly help?: string;
  readonly preferTyped: boolean;
  /** La fila de lo guardado, si es una (USD guardado es la fila DOL); si no, lo guardado arranca escrito. */
  readonly previous: (current: string) => string;
  readonly rows: ReadonlyArray<FilterListRow<string>>;
  /** Si lo elegido es lo guardado ("Contado" y `contado`, DOL y USD): queda "Sin cambios.". */
  readonly same: (chosen: string, current: string) => boolean;
}

function fieldList(
  kind: ConfigListKind,
  rows: ReadonlyArray<FilterListRow<string>>,
  view: Pick<ConfigFieldList, 'header' | 'help'> = {},
): ConfigFieldList {
  const labelOf = (value: string) => rows.find((row) => row.value === value)?.label ?? value;

  return {
    ...view,
    preferTyped: configListPrefersTyped(kind),
    previous: (current) => configListPrevious(kind, current),
    rows,
    same: (chosen, current) => isSameConfigChoice(kind, { label: labelOf(chosen), value: chosen }, current),
  };
}

/** Las monedas de ARCA con CODIGO y MONEDA, sin consultarla. */
function currencyRows(): Pick<ConfigFieldList, 'header' | 'rows'> {
  const options = configCurrencyOptions();
  const { header, rows } = formatTableRows(
    ['CÓDIGO', 'MONEDA'],
    options.map((option) => [option.code, option.name]),
  );

  return {
    header,
    rows: options.map((option, index) => ({
      keywords: option.keywords,
      label: rows[index] ?? option.code,
      short: option.name,
      value: option.code,
    })),
  };
}

type ConfigListFlags = Pick<GlobalCliOptions, 'produccion' | 'testing'>;

/**
 * La tabla de actividades de WSFEX con el mismo perfil que `arcli fe`: hacen falta el CUIT y el certificado y la
 * clave de facturacion del entorno, y el de exportacion se usa si esta configurado (`createExportGateway`). Si falta
 * algo o ARCA falla, `undefined`: la actividad se escribe, como antes, sin cortar el menu.
 */
async function loadActivities(flags: ConfigListFlags): Promise<readonly ExportActivity[] | undefined> {
  try {
    const runtime = loadArcaRuntime(flags);

    return await waitForArca('Consultando las actividades de WSFEX...', () =>
      new ArcaClientFactory().createExportGateway(runtime).getActivities(),
    );
  } catch (error) {
    // Ctrl+C mientras se consultaba vuelve al menu.
    if (isPromptCancellation(error)) {
      throw error;
    }

    writeTerminalOutput(
      noticePanel('No se pudo consultar la tabla de actividades de WSFEX: escribí el código.', 'muted'),
    );

    return undefined;
  }
}

export interface ConfigFieldLists {
  /** La lista de un dato, o `undefined` si se escribe (tambien la actividad sin tabla). */
  readonly of: (field: ConfigField) => Promise<ConfigFieldList | undefined>;
  /** Descarta la tabla ya consultada: cambio el entorno o un certificado (`changesArcaAccess`). */
  readonly reset: () => void;
}

/**
 * Las listas de "Modificar configuracion", con la tabla de actividades consultada una vez (si se consiguio) hasta que
 * cambie con que se consulta ARCA.
 */
export function configFieldLists(flags: ConfigListFlags = {}): ConfigFieldLists {
  let activities: readonly ExportActivity[] | undefined;

  return {
    of: async (field) => {
      const kind = configListKind(field);

      if (kind === 'choices') {
        return fieldList(
          kind,
          (field.choices ?? []).map((choice) => ({
            keywords: choice,
            label: field.choiceLabels?.[choice] ?? choice,
            value: choice,
          })),
        );
      }

      if (kind === 'currency') {
        const { header, rows } = currencyRows();

        return fieldList(kind, rows, {
          header,
          help: 'Escribí el nombre o el código, por ejemplo "euro", "060" o "EUR".',
        });
      }

      if (kind === 'activity') {
        activities ??= await loadActivities(flags);

        if (!activities?.length) {
          return undefined;
        }

        const { header, rows } = activityRows(activities);

        return fieldList(
          kind,
          rows.map((row) => ({ ...row, value: String(row.value) })),
          { header, help: ACTIVITY_HELP },
        );
      }

      return undefined;
    },
    reset: () => {
      activities = undefined;
    },
  };
}
