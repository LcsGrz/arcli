import { resolveExportActivity, resolveExportLanguage } from './export.catalogs';
import { assertExportClientIdentification, resolveExportClientCountryCuit } from './export.country-cuit';
import type { ExportPreviewGateway } from './export.gateway';
import { resolveExportIncoterm } from './export.incoterm';
import { buildExportItems, DEFAULT_EXPORT_ITEM_DESCRIPTION } from './export.items';
import type { ExportRequest } from './export.resolve.local';
import type { ExportTableReader } from './export.tables';
import type { ExportCountry } from './export.types';

/** El CUIT del pais, los items, el incoterm y el idioma, cada uno contra su tabla. */
export async function resolveExportCatalogs(options: {
  readonly destinationCountry: ExportCountry;
  readonly gateway: ExportPreviewGateway;
  readonly request: ExportRequest;
  readonly tables: ExportTableReader;
}) {
  const { destinationCountry, gateway, request, tables } = options;
  const { associated, input } = request;
  // El mismo destino que el asociado, escrito por nombre: recien con la tabla se sabe.
  const associatedCuit =
    associated?.voucher.destinationCountry === destinationCountry.code
      ? associated.voucher.clientCountryCuit
      : undefined;
  const givenCountryCuit = input.clientCountryCuit ?? associatedCuit;

  // Sin escribirlo, el CUIT del pais sale de la tabla.
  const countryCuitTable = await tables.read(() => gateway.getDestinationCountryCuits(), {
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
  const unitTable = await tables.read(() => gateway.getUnits(), {
    required: input.items?.some(({ unit }) => typeof unit === 'string'),
  });
  const units = unitTable.rows;
  const items = buildExportItems(
    input.items,
    input.amount as number,
    units,
    input.description?.trim() || DEFAULT_EXPORT_ITEM_DESCRIPTION,
  );

  // Sin `--incoterms-desc`, la descripcion (`Incoterms_Ds`) sale de la tabla.
  const incotermTable = input.incoterm?.trim()
    ? await tables.read(() => gateway.getIncoterms(), { required: !input.incotermDescription?.trim() })
    : undefined;
  const incoterm = resolveExportIncoterm(input.incoterm, incotermTable?.rows ?? []);
  // Se consulta siempre: la vista previa muestra el nombre del idioma, tambien el de por defecto.
  const languageTable = await tables.read(() => gateway.getLanguages());
  const languageId = resolveExportLanguage(input.language, languageTable.rows);

  return { clientCountryCuit, countryCuitTable, incoterm, incotermTable, items, languageId, languageTable, unitTable };
}

/** La actividad. Sin `--actividad` ni `exportacion.actividad` la E va sin el bloque `Actividades`: ARCA no lo exige. */
export async function resolveExportActivityCode(
  activityCode: number | undefined,
  gateway: ExportPreviewGateway,
  tables: ExportTableReader,
) {
  const activityTable = activityCode === undefined ? undefined : await tables.read(() => gateway.getActivities());
  const activity =
    activityCode === undefined ? undefined : resolveExportActivity(activityCode, activityTable?.rows ?? []);

  return { activity, activityTable };
}
