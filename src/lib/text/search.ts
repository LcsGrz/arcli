/** Sin mayusculas ni tildes: "dolar" encuentra "Dólar" y "eur", "EURO". */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Las palabras de lo escrito, sin mayusculas ni tildes: dos textos con las mismas filtran igual. */
export function searchWords(term: string): string[] {
  return normalizeSearchText(term).split(/\s+/).filter(Boolean);
}

/** Si dos textos buscan lo mismo: sin mayusculas ni tildes, y un espacio o un Tab de mas no cambian la busqueda. */
export function sameSearch(left: string, right: string): boolean {
  return searchWords(left).join(' ') === searchWords(right).join(' ');
}
