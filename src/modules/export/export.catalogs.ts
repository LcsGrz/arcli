import { InputValidationError } from '../../lib/errors/app-error';
import { normalizeSearchText, searchWords } from '../../lib/text/search';

import { EXPORT_VOUCHER_KIND } from './export.kinds';
import { requireText } from './export.text-fields';
import {
  DEFAULT_EXPORT_LANGUAGE,
  DEFAULT_EXPORT_TYPE,
  EXPORT_TYPE_VALUES,
  type ExportActivity,
  type ExportCountry,
  type ExportType,
} from './export.types';

/** Codigo de pais de Argentina en la tabla DST_pais: no es un destino de exportacion. */
const ARGENTINA_COUNTRY_CODE = 200;

/**
 * El aviso de una tabla de WSFEX que ARCA devolvio vacia: el dato no se pudo validar y va como se escribio
 * (`resolveExportActivity`, `resolveExportIncoterm`). Si esta mal, lo rechaza ARCA al emitir.
 */
export function exportEmptyTableWarning(table: 'actividades' | 'incoterms', value: number | string): string {
  return `ARCA devolvió vacía la tabla de ${table} de WSFEX: ${value} va sin validar y, si no es válido, ARCA lo rechaza al emitir.`;
}

/**
 * Lo que tiene de malo una actividad contra la tabla de WSFEX (error 2105), con el texto del CLI y el del asistente
 * (`question`, sin el flag), o `undefined` si esta o si ARCA devolvio la tabla vacia. Es la misma regla para `arcli fe`
 * (`resolveExportActivity`) y para las preguntas de la actividad de "Emitir factura E" y "Repetir" E (REV-74, #11).
 */
export function exportActivityProblem(
  value: number,
  activities: readonly ExportActivity[] = [],
): { readonly message: string; readonly question: string } | undefined {
  if (activities.length === 0 || activities.some((activity) => activity.id === value)) {
    return undefined;
  }

  const prefix = String(value).slice(0, 3);
  const family = activities.filter((activity) => String(activity.id).startsWith(prefix)).slice(0, 5);
  const candidates =
    family.length > 0 ? ` Las que empiezan con ${prefix} son ${family.map((activity) => activity.id).join(', ')}.` : '';
  const problem = `La actividad ${value} no está en la tabla de actividades de WSFEX y ARCA la rechaza (error 2105).${candidates}`;

  return { message: `${problem} Indicá la que corresponda con \`--actividad\`.`, question: problem };
}

/**
 * La actividad es opcional (`Actividades` no es obligatorio en WSFEX v3.1.0; la 2100 solo prohibe el bloque vacio),
 * pero si se informa, ARCA solo acepta los codigos de su propia tabla, que no es la del padron y es mas chica (error
 * 2105 al emitir). Sale de `--actividad` o de `exportacion.actividad`: no hay default. Los nombres de la tabla llegan
 * con la codificacion rota, por eso los mensajes solo dan codigos.
 */
export function resolveExportActivity(value: number, activities: readonly ExportActivity[] = []): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new InputValidationError('La actividad tiene que ser un número entero positivo. Usá `--actividad`.');
  }

  const problem = exportActivityProblem(value, activities);

  if (problem) {
    throw new InputValidationError(problem.message);
  }

  return value;
}

export function resolveExportType(value: ExportType | undefined): ExportType {
  if (value === undefined) {
    return DEFAULT_EXPORT_TYPE;
  }

  if (!EXPORT_TYPE_VALUES.includes(value)) {
    throw new InputValidationError(
      '`--tipo-expo` tiene que ser 1 (exportación definitiva de bienes), 2 (servicios) o 4 (otros).',
    );
  }

  return value;
}

export function resolveExportLanguage(
  value: number | undefined,
  languages: readonly { readonly id: number; readonly name?: string }[],
): number {
  if (value === undefined) {
    return DEFAULT_EXPORT_LANGUAGE;
  }

  if (languages.length > 0 && !languages.some((language) => language.id === value)) {
    throw new InputValidationError(
      `El idioma ${value} no existe en la tabla de ARCA.`,
      undefined,
      `Los válidos: ${languages.map(({ id, name }) => (name ? `${id} (${name})` : id)).join(', ')}.`,
    );
  }

  return value;
}

/**
 * El pais se puede escribir por codigo (`203`) o por nombre (`Brasil`). Se valida contra la tabla de ARCA y
 * se rechaza Argentina: WSFEX es solo para exportaciones.
 */
export function resolveExportDestinationCountry(
  value: string | undefined,
  countries: readonly ExportCountry[],
): ExportCountry {
  const trimmed = requireText(value, 'el país de destino', '`--pais-destino`');
  const numeric = /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
  const country = numeric
    ? countries.find((entry) => entry.code === numeric)
    : countries.find((entry) => entry.name.trim().toLowerCase() === trimmed.toLowerCase());

  if (!country) {
    throw new InputValidationError(
      `El país de destino "${trimmed}" no existe en la tabla de ARCA. Usá el código o el nombre que informa ARCA.`,
      undefined,
      countriesHint(trimmed, countries),
    );
  }

  // Propia: WSFEX v3.1.0 no tiene ese control y ARCA testing aprueba una E con destino 200 (TEST-8).
  if (country.code === ARGENTINA_COUNTRY_CODE) {
    throw new InputValidationError(
      'Argentina no es un destino de exportación: usá `arcli factura a` o `arcli factura b`.',
    );
  }

  return country;
}

const MAX_SIMILAR_COUNTRIES = 5;

/** Donde ver los paises, que no tienen comando: los que contienen lo escrito y el asistente. Sin tabla, nada. */
function countriesHint(value: string, countries: readonly ExportCountry[]): string | undefined {
  if (countries.length === 0) {
    return undefined;
  }

  const words = searchWords(value);
  const similar = exportDestinationCountryChoices(countries)
    .filter(({ name }) => words.every((word) => normalizeSearchText(name).includes(word)))
    .slice(0, MAX_SIMILAR_COUNTRIES)
    .map(({ code, name }) => `${name.trim()} (${code})`);
  const everywhere = `Están todos en el asistente: \`arcli\` > "Emitir factura" > "${EXPORT_VOUCHER_KIND.displayName}".`;

  return similar.length > 0 ? `Parecidos: ${similar.join(', ')}. ${everywhere}` : everywhere;
}

/** Los destinos que acepta `--pais-destino` (`resolveExportDestinationCountry`): la tabla de ARCA sin Argentina. */
export function exportDestinationCountryChoices(countries: readonly ExportCountry[]): ExportCountry[] {
  return countries.filter((country) => country.code !== ARGENTINA_COUNTRY_CODE);
}
