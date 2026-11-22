import { padEndVisible, visibleWidth } from '../primitives/text';

/**
 * Filas alineadas en columnas con su encabezado, separadas por dos espacios: cada columna tan ancha como su texto mas
 * largo (sin contar colores), salvo la ultima, que va sin rellenar. Las usan las tablas de ARCA y las listas que se
 * filtran del asistente (paises y CUIT de paises de la E).
 */
export function formatTableRows(
  titles: readonly string[],
  cells: ReadonlyArray<readonly string[]>,
): { readonly header: string; readonly rows: string[] } {
  const widths = titles.map((title, column) =>
    Math.max(visibleWidth(title), ...cells.map((row) => visibleWidth(row[column] ?? ''))),
  );
  const line = (row: readonly string[]) =>
    row
      .map((cell, column) => (column === row.length - 1 ? cell : padEndVisible(cell, widths[column] ?? 0)))
      .join('  ')
      .trimEnd();

  return { header: line(titles), rows: cells.map(line) };
}
