import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { formatArgentineAmount, formatArgentineMoney } from '../../lib/numbers/argentine-amount';
import { attentionPanel, listingPanel, sheetPanel } from '../../ui/components';
import {
  bold,
  colorize,
  markRow,
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

const OWN_LABEL = 'tu categoría';
/** Entre columnas: el sobrante se reparte si deja por lo menos 3; si no, 2, como las demas tablas. */
const WIDE_GAP = 3;
const NARROW_GAP = 2;
/** Antes de la primera columna: la `❯ ` de la fila propia o dos espacios. */
const ROW_PREFIX_WIDTH = 2;

// ---------------------------------------------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------------------------------------------

/** `--json`: con `letter`, `categorias` trae solo esa. */
export function serializeMonotributo(report: MonotributoReport, letter?: MonotributoCategoryLetter) {
  const categories = letter
    ? report.table.categories.filter((category) => category.letter === letter)
    : report.table.categories;

  return {
    vigenteDesde: report.table.validFrom,
    fuente: report.source,
    consultadaEl: report.consultedOn,
    url: MONOTRIBUTO_CATEGORIES_URL,
    tuCategoria: report.ownCategory,
    categorias: categories.map(serializeMonotributoCategory),
    avisos: report.notices,
  };
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
function formatMonotributoSource(report: MonotributoReport): string {
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

/** `❯ ` en la fila propia, dos espacios en las demas: asi la marca se lee sin color. */
function rowPrefix(isOwn: boolean): string {
  return isOwn ? `${uiSymbol('pointer')} ` : '  ';
}

/** La fila propia, en negrita y con el fondo `mark` hasta `width` (sin color, solo la `❯`). */
function emphasize(line: string, isOwn: boolean, width: number): string {
  return isOwn ? markRow(bold(line), width) : line;
}

/** La leyenda de la marca, si hay categoria propia: "❯ tu categoría". */
function ownCategoryLegend(report: MonotributoReport): string[] {
  return report.ownCategory ? [`${uiSymbol('pointer')} ${OWN_LABEL}`] : [];
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

/**
 * Los espacios entre columnas de `widths` para que la tabla ocupe `width`: el sobrante repartido en partes iguales
 * (lo que no se reparte parejo va en las primeras), si deja por lo menos 3 entre cada una; si no, 2. `undefined` si
 * no entra con `minimumGap`.
 */
function columnGaps(widths: readonly number[], width: number, minimumGap = NARROW_GAP): number[] | undefined {
  const count = widths.length - 1;
  const free = width - ROW_PREFIX_WIDTH - widths.reduce((total, columnWidth) => total + columnWidth, 0);

  if (free < count * minimumGap) return undefined;
  if (count === 0) return [];
  if (free < count * WIDE_GAP) return Array.from({ length: count }, () => NARROW_GAP);

  const base = Math.floor(free / count);

  return Array.from({ length: count }, (_, index) => base + (index < free % count ? 1 : 0));
}

/**
 * Tabla en columnas a todo el ancho: encabezado y una fila por categoria, con la propia marcada. `undefined` si no
 * entra en `width`.
 */
function renderColumns(
  columns: readonly Column[],
  categories: readonly MonotributoCategory[],
  ownCategory: MonotributoCategoryLetter | null,
  width: number,
): string[] | undefined {
  const widths = columns.map((column) => columnWidth(column, categories));
  const gaps = columnGaps(widths, width);

  if (!gaps) return undefined;

  const join = (cells: readonly string[]) =>
    cells
      .map(
        (cell, index) =>
          `${index > 0 ? ' '.repeat(gaps[index - 1] ?? NARROW_GAP) : ''}${pad(cell, widths[index] ?? 0, columns[index]?.align ?? 'left')}`,
      )
      .join('');
  const header = `${' '.repeat(ROW_PREFIX_WIDTH)}${join(columns.map((column) => column.header))}`;
  const rows = categories.map((category) => {
    const isOwn = category.letter === ownCategory;

    return emphasize(`${rowPrefix(isOwn)}${join(columns.map((column) => column.value(category)))}`, isOwn, width);
  });

  return [bold(header.trimEnd()), ...rows];
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

/**
 * Terminal angosta: cada categoria en dos lineas, el tope arriba y "cuota serv. · cuota ventas" abajo. La propia, con
 * el fondo en las dos.
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

    lines.push(...pair.map((line) => emphasize(line, isOwn, width)));
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
  const table =
    renderColumns(SUMMARY_COLUMNS, report.table.categories, report.ownCategory, width) ?? summaryNarrow(report, width);
  const example = report.ownCategory ?? 'E';
  const notes = [
    ...ownCategoryLegend(report),
    'La cuota es mensual: impuesto integrado, aporte jubilatorio (SIPA) y obra social.',
    formatMonotributoSource(report),
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

  return listingPanel(title, table, { legend: [...notes, ...hints] });
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

/**
 * La linea de arriba de cada bloque: en cual estas y donde esta el otro.
 *
 * @internal Exportado para los tests.
 */
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
function stackedBlock(columns: readonly Column[], report: MonotributoReport, width: number): string[] {
  const [, ...data] = columns;

  return report.table.categories.flatMap((category, index) => {
    const isOwn = category.letter === report.ownCategory;
    const rows = data.map((column) => [column.header.toLowerCase(), column.value(category)] as const);

    return [
      ...(index > 0 ? [''] : []),
      emphasize(`${rowPrefix(isOwn)}${category.letter}`, isOwn, width),
      ...renderKeyValueRows(rows, { indent: 4, labelTone: 'muted' }),
    ];
  });
}

/**
 * Las columnas de un bloque que se ven a la vez en el asistente cuando no entran todas: de `first` a `last` de
 * `total`, contadas desde 1 y sin CAT., que va siempre.
 */
export interface MonotributoColumnWindow {
  readonly first: number;
  readonly last: number;
  readonly total: number;
}

/** Las columnas de datos de `first` a `last` (desde 1), con CAT. adelante. */
function windowColumns(columns: readonly Column[], first: number, last: number): Column[] {
  const [category = CATEGORY_COLUMN, ...data] = columns;

  return [category, ...data.slice(first - 1, last)];
}

/** Si las columnas de `first` a `last` de `block` entran en `width`, con `minimumGap` entre cada una. */
function windowFits(
  report: MonotributoReport,
  block: MonotributoBlock,
  [first, last]: readonly [number, number],
  width: number,
  minimumGap: number,
): boolean {
  const widths = windowColumns(BLOCK_COLUMNS[block], first, last).map((column) =>
    columnWidth(column, report.table.categories),
  );

  return columnGaps(widths, width, minimumGap) !== undefined;
}

/**
 * La ventana con la que se entra a `block` en el asistente: desde la primera columna (`side` `left`, entrando desde
 * el bloque de la izquierda) o hasta la ultima (`right`), con todas las que entran con 3 espacios entre cada una.
 * `undefined` si el bloque entra entero (no hace falta ventana) o si no entra ni una columna (va apilado).
 */
export function enterMonotributoColumnWindow(
  report: MonotributoReport,
  block: MonotributoBlock,
  side: 'left' | 'right',
  options: ViewOptions = {},
): MonotributoColumnWindow | undefined {
  const width = options.width ?? panelContentWidth('wide');
  const total = BLOCK_COLUMNS[block].length - 1;
  const fits = (first: number, last: number) => windowFits(report, block, [first, last], width, WIDE_GAP);

  if (windowFits(report, block, [1, total], width, NARROW_GAP)) return undefined;

  if (side === 'left') {
    let last = 1;

    if (!fits(1, last)) return undefined;
    while (last < total && fits(1, last + 1)) last += 1;

    return { first: 1, last, total };
  }

  let first = total;

  if (!fits(first, total)) return undefined;
  while (first > 1 && fits(first - 1, total)) first -= 1;

  return { first, last: total, total };
}

/**
 * La ventana corrida una columna hacia `direction`: la nueva entra pegada a ese lado y del otro sale una (o las que
 * hagan falta para que entre). `undefined` si ya no hay columnas de ese lado.
 */
export function moveMonotributoColumnWindow(
  report: MonotributoReport,
  block: MonotributoBlock,
  window: MonotributoColumnWindow,
  direction: 'left' | 'right',
  options: ViewOptions = {},
): MonotributoColumnWindow | undefined {
  const width = options.width ?? panelContentWidth('wide');
  const fits = (first: number, last: number) => windowFits(report, block, [first, last], width, WIDE_GAP);

  if (direction === 'right') {
    if (window.last >= window.total) return undefined;

    const last = window.last + 1;
    let first = Math.min(window.first + 1, last);

    while (first < last && !fits(first, last)) first += 1;

    return { first, last, total: window.total };
  }

  if (window.first <= 1) return undefined;

  const first = window.first - 1;
  let last = Math.max(window.last - 1, first);

  while (last > first && !fits(first, last)) last -= 1;

  return { first, last, total: window.total };
}

/** "columnas 2 a 4 de 5", con ← si hay columnas a la izquierda y → si hay a la derecha. */
function formatColumnWindow({ first, last, total }: MonotributoColumnWindow): string {
  return [
    first > 1 ? `${uiSymbol('moreLeft')}  ` : '',
    `columnas ${first} a ${last} de ${total}`,
    last < total ? `  ${uiSymbol('moreRight')}` : '',
  ].join('');
}

/**
 * Un bloque de `--completa` o de "Ver todas las columnas", con la columna de categoria, la propia marcada y su linea
 * de posicion arriba. Con `window` (solo en el asistente), las columnas de esa ventana y cuales son, abajo; sin
 * ventana, si no entra va apilado. La fuente de la tabla va una vez, en la leyenda del bloque de la cuota.
 */
export function formatMonotributoBlockAsText(
  report: MonotributoReport,
  block: MonotributoBlock,
  options: ViewOptions & {
    readonly navigation: MonotributoBlockNavigation;
    readonly window?: MonotributoColumnWindow;
  },
): string {
  const width = options.width ?? panelContentWidth('wide');
  const { window } = options;
  const columns = window ? windowColumns(BLOCK_COLUMNS[block], window.first, window.last) : BLOCK_COLUMNS[block];
  const lines =
    renderColumns(columns, report.table.categories, report.ownCategory, width) ??
    stackedBlock(BLOCK_COLUMNS[block], report, width);

  const separator = uiSymbol('separator');
  const title = panelTitle(
    width,
    `${BLOCK_TITLES[block]} ${separator} ${sinceLabel(report)}`,
    `${BLOCK_TITLES[block]} ${separator} ${formatArcaDateAsArgentineDate(report.table.validFrom)}`,
  );

  return listingPanel(
    title,
    [
      colorize(formatMonotributoBlockPosition(block, options.navigation), 'muted'),
      '',
      ...lines,
      ...(window ? ['', colorize(formatColumnWindow(window), 'muted')] : []),
    ],
    { legend: block === 'cuota' ? [formatMonotributoSource(report)] : [] },
  );
}

/** `--completa`: los dos bloques, uno debajo del otro. */
export function formatMonotributoFullAsText(report: MonotributoReport, options: ViewOptions = {}): string {
  return MONOTRIBUTO_BLOCKS.map((block) =>
    formatMonotributoBlockAsText(report, block, { ...options, navigation: 'apilados' }),
  ).join('\n\n');
}
