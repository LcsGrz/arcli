import { InputValidationError } from '../../lib/errors/app-error';

import type { ExportCountry, ExportCountryCuit } from './export.types';

/**
 * DST_CUIT repite cada pais tres veces, con el tipo de entidad pegado al nombre: "BRASIL - Persona Jurídica".
 * DST_pais trae solo "BRASIL", asi que el sufijo no sirve para comparar ni para mostrar el pais.
 */
const COUNTRY_CUIT_ENTITY_SUFFIX =
  /\s*-\s*(?:persona\s+f[ií]sica|persona\s+jur[ií]dica|otro\s+tipo\s+de\s+entidad)\s*$/i;

/** Cuando el pais tiene las tres filas, gana la de persona juridica: el cliente de una exportacion suele ser una empresa. */
const COUNTRY_CUIT_ENTITY_PREFERENCE = [
  /\bpersona\s+jur[ií]dica\s*$/i,
  /\botro\s+tipo\s+de\s+entidad\s*$/i,
  /\bpersona\s+f[ií]sica\s*$/i,
];

/** Para comparar nombres de las dos tablas: sin tipo de entidad, sin acentos, sin mayusculas y con un solo espacio. */
function normalizeCountryName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function countryNameWithoutEntity(value: string): string {
  return value.replace(COUNTRY_CUIT_ENTITY_SUFFIX, '').trim();
}

function pickCountryCuit(entries: readonly ExportCountryCuit[]): ExportCountryCuit | undefined {
  for (const preference of COUNTRY_CUIT_ENTITY_PREFERENCE) {
    const preferred = entries.find((entry) => preference.test(entry.countryName));

    if (preferred) {
      return preferred;
    }
  }

  return entries[0];
}

/** Las filas de la tabla DST_CUIT del destino (una por tipo de entidad), comparando sin el tipo de entidad. */
function countryCuitsOfDestination(
  country: ExportCountry,
  countries: readonly ExportCountryCuit[],
): ExportCountryCuit[] {
  const destination = normalizeCountryName(country.name);

  return countries.filter((entry) => normalizeCountryName(countryNameWithoutEntity(entry.countryName)) === destination);
}

/** El orden de `COUNTRY_CUIT_ENTITY_PREFERENCE`: persona juridica, otro tipo de entidad y persona fisica. */
function entityRank(entry: ExportCountryCuit): number {
  const rank = COUNTRY_CUIT_ENTITY_PREFERENCE.findIndex((preference) => preference.test(entry.countryName));

  return rank === -1 ? COUNTRY_CUIT_ENTITY_PREFERENCE.length : rank;
}

/**
 * Los CUIT de pais que acepta `--cuit-pais` para el destino (`resolveExportClientCountryCuit`): los del destino si la
 * tabla de ARCA los trae, con el que eligiria el flag primero (`pickCountryCuit`), y si no, cualquiera de la tabla, en
 * su orden.
 */
export function exportClientCountryCuitChoices(options: {
  readonly country: ExportCountry;
  readonly countries: readonly ExportCountryCuit[];
}): ExportCountryCuit[] {
  const forDestination = countryCuitsOfDestination(options.country, options.countries);

  return forDestination.length > 0
    ? forDestination.toSorted((left, right) => entityRank(left) - entityRank(right))
    : [...options.countries];
}

/**
 * WSFEX pide el CUIT del pais del cliente o su ID impositivo: con uno alcanza (error 1580). Se resuelve con la tabla DST_CUIT, que nombra cada pais con el tipo de
 * entidad ("ESTADOS UNIDOS - Persona Jurídica"), mientras que la tabla de destinos dice solo "ESTADOS UNIDOS": por
 * eso se compara sin el sufijo. Si el CUIT viene por flag se valida contra la tabla, salvo para los paises cuyo
 * nombre no coincide entre las dos tablas ("CHINA" y "CHINA REP.POPULAR"), donde solo se acepta que exista. Si la
 * tabla no trae el destino y no vino por flag, no hay CUIT: la E va solo con el ID impositivo (ver
 * `assertExportClientIdentification`).
 */
export function resolveExportClientCountryCuit(options: {
  readonly country: ExportCountry;
  readonly countries: readonly ExportCountryCuit[];
  readonly cuit?: number;
}): number | undefined {
  const destination = normalizeCountryName(options.country.name);
  const forDestination = countryCuitsOfDestination(options.country, options.countries);

  if (options.cuit === undefined) {
    return pickCountryCuit(forDestination)?.cuit;
  }

  const expected = pickCountryCuit(forDestination);
  const match = options.countries.find((entry) => entry.cuit === options.cuit);

  if (!match) {
    throw new InputValidationError(
      `El CUIT de país ${options.cuit} no existe en la tabla de ARCA.`,
      undefined,
      expected && `Para "${options.country.name}" la tabla de ARCA trae ${expected.cuit}: pasalo con \`--cuit-pais\`.`,
    );
  }

  if (expected && normalizeCountryName(countryNameWithoutEntity(match.countryName)) !== destination) {
    throw new InputValidationError(
      `El CUIT de país ${options.cuit} corresponde a "${countryNameWithoutEntity(match.countryName)}" y el destino es "${options.country.name}". Para "${options.country.name}" la tabla de ARCA trae ${expected.cuit}.`,
    );
  }

  return options.cuit;
}

/**
 * ARCA pide el CUIT del pais del cliente o su ID impositivo, al menos uno (error 1580). Sin CUIT (la tabla no trae el
 * destino, como pasa con Irlanda, Alemania o las zonas francas) la E va solo con el ID impositivo.
 */
export function assertExportClientIdentification(options: {
  readonly clientCountryCuit?: number;
  readonly clientTaxId?: string;
  readonly country: ExportCountry;
}): void {
  if (options.clientCountryCuit === undefined && !options.clientTaxId?.trim()) {
    throw new InputValidationError(
      `La tabla de ARCA no tiene CUIT para "${options.country.name}" y ARCA pide el CUIT del país o el ID impositivo del cliente (error 1580). Indicá el ID impositivo con \`--id-impositivo\` o el CUIT del país con \`--cuit-pais\`.`,
    );
  }
}
