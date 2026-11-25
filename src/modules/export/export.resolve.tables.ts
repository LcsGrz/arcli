import { createTaskQueue } from '../../lib/concurrency/task-queue';

import { resolveExportActivity, resolveExportLanguage } from './export.catalogs';
import { assertExportClientIdentification, resolveExportClientCountryCuit } from './export.country-cuit';
import type { ExportPreviewGateway } from './export.gateway';
import { resolveExportIncoterm } from './export.incoterm';
import { buildExportItems, DEFAULT_EXPORT_ITEM_DESCRIPTION } from './export.items';
import type { ExportRequest } from './export.resolve.local';
import type { ExportTableReader } from './export.tables';
import type {
  ExportActivity,
  ExportCountry,
  ExportCountryCuit,
  ExportCurrency,
  ExportIncoterm,
  ExportLanguage,
  ExportUnit,
} from './export.types';

const MAX_SIMULTANEOUS_TABLES = 4;

/** Las tablas que necesita el pedido, ya arrancadas. Las opcionales, solo si se usan. */
export interface StartedExportTables {
  readonly activities?: Promise<readonly ExportActivity[]>;
  readonly countryCuits: Promise<readonly ExportCountryCuit[]>;
  readonly currencies: Promise<readonly ExportCurrency[]>;
  readonly incoterms?: Promise<readonly ExportIncoterm[]>;
  readonly languages: Promise<readonly ExportLanguage[]>;
  /** Las que todavia no arrancaron ya no arrancan. */
  readonly stop: () => void;
  readonly units: Promise<readonly ExportUnit[]>;
}

/**
 * Arranca las tablas en el orden en que se usan, hasta 4 a la vez. Quien resuelve las espera y valida en ese orden, asi
 * que con que error se corta no depende de cual conteste antes. Va despues de los paises, que piden el ticket de WSAA:
 * las que van a la vez ya lo encuentran. Al cortar, las que estan en vuelo no se abortan y sus respuestas se ignoran: el
 * error se muestra enseguida, pero el proceso termina recien cuando contestan (el SDK no tiene timeout propio).
 */
export function startExportTables(request: ExportRequest, gateway: ExportPreviewGateway): StartedExportTables {
  const queue = createTaskQueue(MAX_SIMULTANEOUS_TABLES);

  return {
    countryCuits: queue.add(() => gateway.getDestinationCountryCuits()),
    units: queue.add(() => gateway.getUnits()),
    // Sin `--incoterms-desc`, la descripcion (`Incoterms_Ds`) sale de la tabla.
    incoterms: request.input.incoterm?.trim() ? queue.add(() => gateway.getIncoterms()) : undefined,
    // Se consulta siempre: la vista previa muestra el nombre del idioma, tambien el de por defecto.
    languages: queue.add(() => gateway.getLanguages()),
    // Se consulta siempre: la vista previa muestra el nombre de la moneda.
    currencies: queue.add(() => gateway.getCurrencies()),
    // Sin `--actividad` ni `exportacion.actividad` la E va sin el bloque `Actividades`: ARCA no lo exige.
    activities: request.activityCode === undefined ? undefined : queue.add(() => gateway.getActivities()),
    stop: queue.stop,
  };
}

/** El CUIT del pais, los items, el incoterm y el idioma, cada uno contra su tabla. */
export async function resolveExportCatalogs(options: {
  readonly destinationCountry: ExportCountry;
  readonly request: ExportRequest;
  readonly started: StartedExportTables;
  readonly tables: ExportTableReader;
}) {
  const { destinationCountry, request, started, tables } = options;
  const { associated, input } = request;
  // El mismo destino que el asociado, escrito por nombre: recien con la tabla se sabe.
  const associatedCuit =
    associated?.voucher.destinationCountry === destinationCountry.code
      ? associated.voucher.clientCountryCuit
      : undefined;
  const givenCountryCuit = input.clientCountryCuit ?? associatedCuit;

  // Sin escribirlo, el CUIT del pais sale de la tabla.
  const countryCuitTable = await tables.read(() => started.countryCuits, {
    required: givenCountryCuit === undefined,
  });
  const countryCuits = countryCuitTable.rows;
  const clientCountryCuit = countryCuitTable.ok
    ? resolveExportClientCountryCuit({
        country: destinationCountry,
        countries: countryCuits,
        cuit: givenCountryCuit,
      })
    : givenCountryCuit;

  assertExportClientIdentification({
    clientCountryCuit,
    clientTaxId: input.clientTaxId,
    country: destinationCountry,
  });

  // Una unidad escrita por nombre sale de la tabla.
  const unitTable = await tables.read(() => started.units, {
    required: input.items?.some(({ unit }) => typeof unit === 'string'),
  });
  const units = unitTable.rows;
  const items = buildExportItems(
    input.items,
    input.amount as number,
    units,
    input.description?.trim() || DEFAULT_EXPORT_ITEM_DESCRIPTION,
  );

  const incotermRows = started.incoterms;
  const incotermTable = incotermRows
    ? await tables.read(() => incotermRows, { required: !input.incotermDescription?.trim() })
    : undefined;
  const incoterm = resolveExportIncoterm(input.incoterm, incotermTable?.rows ?? []);
  const languageTable = await tables.read(() => started.languages);
  const languageId = resolveExportLanguage(input.language, languageTable.rows);

  return { clientCountryCuit, countryCuitTable, incoterm, incotermTable, items, languageId, languageTable, unitTable };
}

/** La actividad, si el pedido lleva una, contra su tabla. */
export async function resolveExportActivityCode(
  activityCode: number | undefined,
  rows: StartedExportTables['activities'],
  tables: ExportTableReader,
) {
  const activityTable = rows ? await tables.read(() => rows) : undefined;
  const activity =
    activityCode === undefined ? undefined : resolveExportActivity(activityCode, activityTable?.rows ?? []);

  return { activity, activityTable };
}
