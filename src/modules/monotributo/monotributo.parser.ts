import {
  checkMonotributoTable,
  type MonotributoCategory,
  type MonotributoTable,
  parseMonotributoLetter,
} from './monotributo';

export type MonotributoPageResult =
  | { readonly ok: false; readonly problems: readonly string[] }
  | { readonly ok: true; readonly table: MonotributoTable };

// Las columnas de cada fila, en el orden de la pagina: categoria, ingresos brutos, superficie, energia, alquileres,
// precio unitario, impuesto integrado (servicios y ventas), SIPA, obra social y total (servicios y ventas).
const COLUMNS_PER_ROW = 12;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  aacute: 'á',
  amp: '&',
  eacute: 'é',
  iacute: 'í',
  nbsp: ' ',
  oacute: 'ó',
  sup2: '²',
  uacute: 'ú',
};

/** Las entidades que usa la pagina (`&#178;`, `&oacute;`, `&nbsp;`); una desconocida queda como esta. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[\da-f]+|[a-z\d]+);/gi, (entity: string, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));

      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }

    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

/** El texto de una celda: sin etiquetas, entidades ni espacios de mas. */
function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `$12.009.410,45` → 12009410.45. NaN si no tiene esa forma.
 *
 * @internal Exportado para los tests.
 */
export function parsePageMoney(text: string): number {
  const value = text.replace(/[$\s]/g, '');

  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(value)) {
    return Number.NaN;
  }

  return Number(value.replace(/\./g, '').replace(',', '.'));
}

/**
 * `Hasta 30 m²`, `Hasta 13000 kWh`, `Hasta 13.000 kWh` → el numero. NaN si no hay uno.
 *
 * @internal Exportado para los tests.
 */
export function parsePageQuantity(text: string): number {
  const match = /(\d[\d.]*)/.exec(text);

  // El grupo es obligatorio en la regex: con `match` siempre hay numero.
  const [, digits] = match ?? [];

  return digits === undefined ? Number.NaN : Number(digits.replace(/\./g, ''));
}

/** "Valores de aplicación desde el 1/08/2026" → `20260801`. */
function readValidFrom(text: string): string | undefined {
  const match = /Valores de aplicaci[oó]n desde el\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(text);

  if (!match) return undefined;

  // Los tres grupos son obligatorios en la regex: los defaults '' nunca se usan, solo le dicen al tipo que hay string.
  const [, day = '', month = '', year = ''] = match;

  return `${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`;
}

function readCategory(cells: readonly string[]): MonotributoCategory | string {
  const letter = parseMonotributoLetter(cells[0] ?? '');

  if (cells.length !== COLUMNS_PER_ROW || !letter) {
    return `una fila con ${cells.length} columnas que empieza con "${cells[0] ?? ''}"`;
  }

  const money = (index: number) => parsePageMoney(cells[index] ?? '');

  return {
    areaLimitM2: parsePageQuantity(cells[2] ?? ''),
    energyLimitKwh: parsePageQuantity(cells[3] ?? ''),
    grossIncomeLimit: money(1),
    healthInsurance: money(9),
    integratedTax: { sales: money(7), services: money(6) },
    letter,
    maxUnitPrice: money(5),
    monthlyFee: { sales: money(11), services: money(10) },
    pensionContribution: money(8),
    rentLimit: money(4),
  };
}

/**
 * Lee la tabla de https://www.afip.gob.ar/monotributo/categorias.asp: la vigencia del titulo ("Valores de
 * aplicación desde el …") y las filas del primer `<tbody>` que le sigue. Sin parser de HTML: la pagina es una tabla
 * simple y el control de consistencia descarta cualquier lectura rara. Los comentarios se sacan antes, porque la
 * pagina tiene columnas comentadas.
 */
export function parseMonotributoPage(html: string): MonotributoPageResult {
  const page = html.replace(/<!--[\s\S]*?-->/g, '');
  const validFrom = readValidFrom(decodeEntities(page));
  const headingIndex = page.search(/Valores de aplicaci/i);
  const bodyStart = page.indexOf('<tbody', Math.max(0, headingIndex));
  const bodyEnd = page.indexOf('</tbody>', bodyStart);

  if (!validFrom || bodyStart < 0 || bodyEnd < 0) {
    return { ok: false, problems: ['no se encontró la vigencia o la tabla'] };
  }

  const rows = page
    .slice(bodyStart, bodyEnd)
    .split(/<tr\b[^>]*>/i)
    .slice(1)
    .map((row) => [...row.matchAll(/<t([hd])\b[^>]*>([\s\S]*?)<\/t\1>/gi)].map((cell) => cellText(cell[2] ?? '')))
    .filter((cells) => cells.length > 0);
  const categories: MonotributoCategory[] = [];
  const problems: string[] = [];

  for (const cells of rows) {
    const category = readCategory(cells);

    if (typeof category === 'string') {
      problems.push(category);
    } else {
      categories.push(category);
    }
  }

  const table = { categories, validFrom };

  problems.push(...checkMonotributoTable(table));

  return problems.length > 0 ? { ok: false, problems } : { ok: true, table };
}
