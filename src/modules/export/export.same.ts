import { sameSearch } from '../../lib/text/search';

/**
 * Si dos datos de la E son el mismo, para saber si los que dependen de el (el domicilio, el CUIT del pais, la
 * descripcion del incoterm) siguen valiendo: al mezclar flags y archivo y al completar una nota con su asociado. Sin
 * distinguir mayusculas, tildes ni espacios.
 */
export const isSameExportClient = sameSearch;

export const isSameExportIncoterm = sameSearch;

/**
 * El pais por codigo o por nombre. Un codigo y un nombre se toman por distintos: compararlos necesita la tabla de ARCA,
 * que tiene `ExportService` recien al resolver.
 */
export function isSameExportCountry(left: string, right: string): boolean {
  const normalize = (value: string) => (/^\s*\d+\s*$/.test(value) ? String(Number(value)) : value);

  return sameSearch(normalize(left), normalize(right));
}
