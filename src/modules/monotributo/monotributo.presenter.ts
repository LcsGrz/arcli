import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { formatArgentineAmount, formatArgentineMoney } from '../../lib/numbers/argentine-amount';
import { attentionPanel, listingPanel, sheetPanel } from '../../ui/components';
import {
  bold,
  colorize,
  panelContentWidth,
  renderKeyValueRows,
  resolveKeyValueLabelWidth,
  uiSymbol,
  visibleWidth,
} from '../../ui/primitives';

import {
  findMonotributoCategory,
  MONOTRIBUTO_CATEGORIES_URL,
  type MonotributoCategory,
  type MonotributoCategoryLetter,
  nextMonotributoCategory,
} from './monotributo';
import { serializeMonotributoCategory } from './monotributo.serialization';
import type { LoadedMonotributoTable } from './monotributo.service';

/** Lo que muestran las vistas de `arcli monotributo` y "Categorías del monotributo". */
export interface MonotributoReport extends LoadedMonotributoTable {
  /** `monotributo.tope` de la config, si esta. */
  readonly configuredLimit?: number;
  /** La categoria del padron para el CUIT de la config; null si no se sabe o no es monotributista. */
  readonly ownCategory: MonotributoCategoryLetter | null;
  /** Version de ARCLI, para nombrar la tabla incluida. */
  readonly version: string;
}

/** Los dos bloques de `--completa` y de "Ver todas las columnas". */
export type MonotributoBlock = 'cuota' | 'limites';

export const MONOTRIBUTO_BLOCKS: readonly MonotributoBlock[] = ['limites', 'cuota'];

/** Como se pasa de un bloque al otro: uno debajo del otro (`--completa`) o con ←/→ (modo interactivo). */
export type MonotributoBlockNavigation = 'apilados' | 'flechas';

interface ViewOptions {
  /** Columnas para el contenido del panel; por defecto, las de la terminal. Los tests lo fijan. */
  readonly width?: number;
}

const GAP = '  ';
const OWN_LABEL = 'tu categoría';

// ---------------------------------------------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------------------------------------------

/** `--json`: con `letter`, `categorias` trae solo esa. */
export function formatMonotributoAsJson(report: MonotributoReport, letter?: MonotributoCategoryLetter): string {
  const categories = letter
    ? report.table.categories.filter((category) => category.letter === letter)
    : report.table.categories;

  return JSON.stringify(
    {
      vigenteDesde: report.table.validFrom,
      fuente: report.source,
      consultadaEl: report.consultedOn,
      url: MONOTRIBUTO_CATEGORIES_URL,
      tuCategoria: report.ownCategory,
      categorias: categories.map(serializeMonotributoCategory),
      avisos: report.notices,
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Piezas comunes
// ---------------------------------------------------------------------------------------------------------------

/** Los avisos (tabla vieja, sin conexion, pagina cambiada) en el panel de avisos, arriba de la tabla. */
export function formatMonotributoNotices(notices: readonly string[]): string | undefined {
  return notices.length === 0
    ? undefined
    : attentionPanel('Avisos', notices.map((notice) => `${uiSymbol('bullet')} ${notice}`).join('\n'));
}

function sinceLabel(report: MonotributoReport): string {
  return `desde el ${formatArcaDateAsArgentineDate(report.table.validFrom)}`;
}

/** "Tabla de ARCA, consultada el 18/11/2026." o "Tabla incluida en ARCLI 2.6.0." */
export function formatMonotributoSource(report: MonotributoReport): string {
  return report.consultedOn && report.source !== 'incluida'
    ? `Tabla de ARCA, consultada el ${formatArcaDateAsArgentineDate(report.consultedOn)}.`
    : `Tabla incluida en ARCLI ${report.version}.`;
}

/**
 * El primer titulo que entra en el borde del panel (el contenido mas el margen, menos lo que ocupan las esquinas):
 * boxen corta el que no entra y "DESDE EL 01/08/2026" quedaria a medias.
 */
function panelTitle(width: number, ...candidates: readonly [string, ...string[]]): string {
  return candidates.find((title) => visibleWidth(title) + 4 <= width + 6) ?? candidates[candidates.length - 1];
}

function muted(lines: readonly string[]): string[] {
  return lines.map((line) => colorize(line, 'muted'));
}

/** `❯ ` en la fila propia, dos espacios en las demas: asi la marca se lee sin color. */
function rowPrefix(isOwn: boolean): string {
  return isOwn ? `${uiSymbol('pointer')} ` : '  ';
}

function emphasize(line: string, isOwn: boolean): string {
  return isOwn ? bold(line) : line;
}

interface Column {
  readonly align: 'left' | 'right';
  readonly header: string;
  readonly value: (category: MonotributoCategory) => string;
}

const CATEGORY_COLUMN: Column = { align: 'left', header: 'CAT.', value: (category) => category.letter };

function columnWidth(column: Column, categories: readonly MonotributoCategory[]): number {
  return Math.max(visibleWidth(column.header), ...categories.map((category) => visibleWidth(column.value(category))));
}

function pad(text: string, width: number, align: Column['align']): string {
  const fill = ' '.repeat(Math.max(0, width - visibleWidth(text)));

  return align === 'right' ? `${fill}${text}` : `${text}${fill}`;
}

/** Tabla en columnas: encabezado y una fila por categoria, con la propia marcada. Devuelve tambien su ancho. */
function renderColumns(
  columns: readonly Column[],
  categories: readonly MonotributoCategory[],
  ownCategory: MonotributoCategoryLetter | null,
): { readonly lines: string[]; readonly width: number } {
  const widths = columns.map((column) => columnWidth(column, categories));
  const join = (cells: readonly string[]) =>
    cells.map((cell, index) => pad(cell, widths[index] ?? 0, columns[index]?.align ?? 'left')).join(GAP);
  const header = `  ${join(columns.map((column) => column.header))}`;
  const rows = categories.map((category) => {
    const isOwn = category.letter === ownCategory;

    return emphasize(`${rowPrefix(isOwn)}${join(columns.map((column) => column.value(category)))}`, isOwn);
  });

  return { lines: [bold(header.trimEnd()), ...rows], width: visibleWidth(header) };
}

// ---------------------------------------------------------------------------------------------------------------
// Vista por defecto: tope y cuota de cada categoria
// ---------------------------------------------------------------------------------------------------------------

const SUMMARY_COLUMNS: readonly Column[] = [
  CATEGORY_COLUMN,
  {
    align: 'right',
    header: 'INGRESOS ANUALES HASTA',
    value: (category) => formatArgentineMoney(category.grossIncomeLimit),
  },
  {
    align: 'right',
    header: 'CUOTA SERVICIOS',
    value: (category) => formatArgentineMoney(category.monthlyFee.services),
  },
  { align: 'right', header: 'CUOTA VENTAS', value: (category) => formatArgentineMoney(category.monthlyFee.sales) },
];

/** En columnas; la etiqueta "tu categoría" al lado de la fila propia, si entra. */
function summaryWide(report: MonotributoReport, width: number): { lines: string[]; ownLabelFits: boolean } | undefined {
  const { lines, width: tableWidth } = renderColumns(SUMMARY_COLUMNS, report.table.categories, report.ownCategory);

  if (tableWidth > width) return undefined;

  const ownLabelFits = tableWidth + GAP.length + OWN_LABEL.length <= width;

  return {
    lines: lines.map((line, index) => {
      const category = report.table.categories[index - 1];
      const isOwn = category !== undefined && category.letter === report.ownCategory;
      const label = isOwn && ownLabelFits ? `${GAP}${colorize(OWN_LABEL, 'muted')}` : '';

      return `${line}${label}`;
    }),
    ownLabelFits,
  };
}

/**
 * Terminal angosta: cada categoria en dos lineas, el tope arriba y "cuota serv. · cuota ventas" abajo. La etiqueta
 * "tu categoría" va en la primera linea que la deja entrar.
 */
function summaryNarrow(report: MonotributoReport, width: number): string[] {
  const separator = ` ${uiSymbol('separator')} `;
  const indent = ' '.repeat(5);
  // Sin "CAT.": no entra sobre la letra, que se entiende sola.
  const lines = [bold(`${indent}INGRESOS ANUALES HASTA`), bold(`${indent}CUOTA SERV.${separator}CUOTA VENTAS`)];

  for (const category of report.table.categories) {
    const isOwn = category.letter === report.ownCategory;
    const pair = [
      `${rowPrefix(isOwn)}${category.letter}  ${formatArgentineMoney(category.grossIncomeLimit)}`,
      `${indent}${formatArgentineMoney(category.monthlyFee.services)}${separator}${formatArgentineMoney(category.monthlyFee.sales)}`,
    ];
    const labelLine = isOwn
      ? pair.findIndex((line) => visibleWidth(line) + GAP.length + OWN_LABEL.length <= width)
      : -1;
    const styled = pair.map(
      (line, index) => emphasize(line, isOwn) + (index === labelLine ? `${GAP}${colorize(OWN_LABEL, 'muted')}` : ''),
    );

    lines.push(...styled);

    if (isOwn && labelLine < 0) {
      lines.push(`${indent}${colorize(OWN_LABEL, 'muted')}`);
    }
  }

  return lines;
}

/**
 * Vista por defecto: `CATEGORÍAS DEL MONOTRIBUTO · DESDE EL …`, con tope y cuota de cada categoria y la propia
 * marcada. Abajo, que es la cuota, de donde sale la tabla y, con `hints`, los comandos para ver mas.
 */
export function formatMonotributoSummaryAsText(
  report: MonotributoReport,
  options: ViewOptions & { readonly hints?: boolean } = {},
): string {
  const width = options.width ?? panelContentWidth('wide');
  const wide = summaryWide(report, width);
  const table = wide?.lines ?? summaryNarrow(report, width);
  const example = report.ownCategory ?? 'E';
  const notes = [
    'La cuota es mensual: impuesto integrado, aporte jubilatorio (SIPA) y obra social.',
    formatMonotributoSource(report),
    ...(report.ownCategory && wide && !wide.ownLabelFits ? [`${uiSymbol('pointer')} ${OWN_LABEL}.`] : []),
    ...(report.configuredLimit === undefined
      ? []
      : [`Tu tope de ingresos configurado (\`monotributo.tope\`): ${formatArgentineMoney(report.configuredLimit)}.`]),
  ];
  const hints = options.hints
    ? [
        '',
        `Una categoría completa: \`arcli monotributo --categoria ${example}\``,
        'Todas las columnas: `arcli monotributo --completa`',
      ]
    : [];

  const separator = uiSymbol('separator');
  const title = panelTitle(
    width,
    `Categorías del monotributo ${separator} ${sinceLabel(report)}`,
    `Monotributo ${separator} ${sinceLabel(report)}`,
  );

  return listingPanel(title, [...table, '', ...muted(notes), ...muted(hints)]);
}

// ---------------------------------------------------------------------------------------------------------------
// --categoria: la ficha de una categoria
// ---------------------------------------------------------------------------------------------------------------

function formatArea(value: number): string {
  return `${formatArgentineAmount(value)} m${uiSymbol('squared')}`;
}

function formatEnergy(value: number): string {
  return `${formatArgentineAmount(value)} kWh`;
}

function ownCategoryRow(
  report: MonotributoReport,
  letter: MonotributoCategoryLetter,
): Array<readonly [string, string]> {
  if (!report.ownCategory) return [];

  return [['Tu categoría', report.ownCategory === letter ? 'sí' : `no (la tuya es la ${report.ownCategory})`]];
}

/**
 * `--categoria E`: vigencia, si es la propia, limites anuales, cuota mensual con su desglose y la categoria
 * siguiente. Al pie, de donde sale la tabla.
 */
export function formatMonotributoCategoryAsText(report: MonotributoReport, letter: MonotributoCategoryLetter): string {
  const category = findMonotributoCategory(report.table, letter);

  if (!category) {
    throw new Error(`La tabla no tiene la categoría ${letter}.`);
  }

  const separator = uiSymbol('separator');
  const head: Array<readonly [string, string]> = [
    ['Vigente desde', formatArcaDateAsArgentineDate(report.table.validFrom)],
    ...ownCategoryRow(report, letter),
  ];
  const limits: Array<readonly [string, string]> = [
    ['Ingresos brutos', formatArgentineMoney(category.grossIncomeLimit)],
    ['Superficie', formatArea(category.areaLimitM2)],
    ['Energía eléctrica', formatEnergy(category.energyLimitKwh)],
    ['Alquileres', formatArgentineMoney(category.rentLimit)],
    ['Precio unitario máximo', `${formatArgentineMoney(category.maxUnitPrice)} (solo venta de cosas muebles)`],
  ];
  const fee: Array<readonly [string, string]> = [
    ['Servicios', formatArgentineMoney(category.monthlyFee.services)],
    ['Ventas', formatArgentineMoney(category.monthlyFee.sales)],
    [
      'Impuesto integrado',
      `${formatArgentineMoney(category.integratedTax.services)} servicios ${separator} ${formatArgentineMoney(category.integratedTax.sales)} ventas`,
    ],
    ['Aporte jubilatorio (SIPA)', formatArgentineMoney(category.pensionContribution)],
    ['Obra social', `${formatArgentineMoney(category.healthInsurance)} por titular; cada adherente suma lo mismo`],
  ];
  const labelWidth = resolveKeyValueLabelWidth(
    'standard',
    [...head, ...limits, ...fee].map(([label]) => [`  ${label}`]),
  );
  const next = nextMonotributoCategory(report.table, letter);
  const section = (title: string, rows: ReadonlyArray<readonly [string, string]>) => [
    '',
    colorize(title, 'info'),
    ...renderKeyValueRows(rows, { indent: 2, labelTone: 'muted', labelWidth: labelWidth - 2 }),
  ];

  return sheetPanel(
    `Categoría ${letter} del monotributo`,
    [
      ...renderKeyValueRows(head, { labelTone: 'muted', labelWidth }),
      ...section('Límites anuales', limits),
      ...section('Cuota mensual', fee),
      '',
      next
        ? `Categoría siguiente ${next.letter}, hasta ${formatArgentineMoney(next.grossIncomeLimit)}.`
        : 'Es la categoría más alta.',
    ],
    { footer: formatMonotributoSource(report), footerTone: 'muted' },
  );
}

// ---------------------------------------------------------------------------------------------------------------
// --completa y "Ver todas las columnas": limites anuales y cuota mensual
// ---------------------------------------------------------------------------------------------------------------

const BLOCK_COLUMNS: Readonly<Record<MonotributoBlock, readonly Column[]>> = {
  cuota: [
    CATEGORY_COLUMN,
    {
      align: 'right',
      header: 'IMP. SERV.',
      value: (category) => formatArgentineAmount(category.integratedTax.services),
    },
    { align: 'right', header: 'IMP. VENTAS', value: (category) => formatArgentineAmount(category.integratedTax.sales) },
    { align: 'right', header: 'SIPA', value: (category) => formatArgentineAmount(category.pensionContribution) },
    { align: 'right', header: 'OBRA SOCIAL', value: (category) => formatArgentineAmount(category.healthInsurance) },
    { align: 'right', header: 'TOTAL SERV.', value: (category) => formatArgentineAmount(category.monthlyFee.services) },
    { align: 'right', header: 'TOTAL VENTAS', value: (category) => formatArgentineAmount(category.monthlyFee.sales) },
  ],
  limites: [
    CATEGORY_COLUMN,
    { align: 'right', header: 'INGRESOS', value: (category) => formatArgentineMoney(category.grossIncomeLimit) },
    { align: 'right', header: 'SUPERFICIE', value: (category) => formatArea(category.areaLimitM2) },
    { align: 'right', header: 'ENERGÍA', value: (category) => formatEnergy(category.energyLimitKwh) },
    { align: 'right', header: 'ALQUILERES', value: (category) => formatArgentineMoney(category.rentLimit) },
    { align: 'right', header: 'PRECIO UNIT.', value: (category) => formatArgentineMoney(category.maxUnitPrice) },
  ],
};

const BLOCK_TITLES: Readonly<Record<MonotributoBlock, string>> = {
  cuota: 'Cuota mensual en pesos',
  limites: 'Límites anuales',
};

/** La linea de arriba de cada bloque: en cual estas y donde esta el otro. */
export function formatMonotributoBlockPosition(
  block: MonotributoBlock,
  navigation: MonotributoBlockNavigation,
): string {
  if (navigation === 'apilados') {
    return block === 'limites'
      ? `1/2  sigue abajo: cuota mensual ${uiSymbol('moreBelow')}`
      : `2/2  ${uiSymbol('moreAbove')} arriba: límites anuales`;
  }

  return block === 'limites'
    ? `1/2  cuota mensual ${uiSymbol('moreRight')}`
    : `${uiSymbol('moreLeft')} límites anuales  2/2`;
}

/**
 * Sin lugar para las columnas, cada categoria apilada: la letra y debajo un dato por linea, con el nombre de la
 * columna.
 */
function stackedBlock(columns: readonly Column[], report: MonotributoReport): string[] {
  const [, ...data] = columns;

  return report.table.categories.flatMap((category, index) => {
    const isOwn = category.letter === report.ownCategory;
    const rows = data.map((column) => [column.header.toLowerCase(), column.value(category)] as const);

    return [
      ...(index > 0 ? [''] : []),
      emphasize(`${rowPrefix(isOwn)}${category.letter}`, isOwn),
      ...renderKeyValueRows(rows, { indent: 4, labelTone: 'muted' }),
    ];
  });
}

/** Un bloque de `--completa`, con la columna de categoria, la propia marcada y su linea de posicion arriba. */
export function formatMonotributoBlockAsText(
  report: MonotributoReport,
  block: MonotributoBlock,
  options: ViewOptions & { readonly navigation: MonotributoBlockNavigation },
): string {
  const width = options.width ?? panelContentWidth('wide');
  const columns = BLOCK_COLUMNS[block];
  const table = renderColumns(columns, report.table.categories, report.ownCategory);
  const lines = table.width <= width ? table.lines : stackedBlock(columns, report);

  const separator = uiSymbol('separator');
  const title = panelTitle(
    width,
    `${BLOCK_TITLES[block]} ${separator} ${sinceLabel(report)}`,
    `${BLOCK_TITLES[block]} ${separator} ${formatArcaDateAsArgentineDate(report.table.validFrom)}`,
  );

  return listingPanel(title, [
    colorize(formatMonotributoBlockPosition(block, options.navigation), 'muted'),
    '',
    ...lines,
    ...(block === 'cuota' ? ['', colorize(formatMonotributoSource(report), 'muted')] : []),
  ]);
}

/** `--completa`: los dos bloques, uno debajo del otro. */
export function formatMonotributoFullAsText(report: MonotributoReport, options: ViewOptions = {}): string {
  return MONOTRIBUTO_BLOCKS.map((block) =>
    formatMonotributoBlockAsText(report, block, { ...options, navigation: 'apilados' }),
  ).join('\n\n');
}
