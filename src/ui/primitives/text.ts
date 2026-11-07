import { UI_THEME, type UiColorToken } from '../theme/theme';

const BOLD = '\u001B[1m';
// Cierres puntuales (no un reset total) para no cortar un color ambiental en
// el que este texto quede anidado, por ejemplo un titulo dentro del borde
// coloreado que dibuja boxen.
const BOLD_OFF = '\u001B[22m';
const COLOR_OFF = '\u001B[39m';
const DIM = '\u001B[2m';

export type OutputTarget = 'stderr' | 'stdout';
export type UiTextColor = UiColorToken | string;

// A donde va lo que se esta armando. Un panel no conoce su destino y adentro hay muchas llamadas a `colorize`:
// mientras dura `renderForTarget`, todas miran esa salida en lugar de stdout.
let defaultTarget: OutputTarget = 'stdout';

/** Corre `render` decidiendo los colores y links segun `target`. `render` tiene que ser sincrono. */
export function renderForTarget<T>(target: OutputTarget, render: () => T): T {
  const previous = defaultTarget;

  defaultTarget = target;

  try {
    return render();
  } finally {
    defaultTarget = previous;
  }
}

/**
 * Colores solo en una terminal real. Con la salida redirigida (pipe, archivo, `| jq`) `isTTY` es
 * `undefined`: antes se trataba como terminal y el JSON salia con codigos ANSI que lo rompian.
 * `NO_COLOR` los apaga siempre; `FORCE_COLOR` los fuerza aunque no haya terminal.
 */
export function shouldUseColor(target: OutputTarget = defaultTarget): boolean {
  if (process.env.NO_COLOR) {
    return false;
  }

  const forceColor = process.env.FORCE_COLOR;

  if (forceColor !== undefined && forceColor !== '') {
    return forceColor !== '0' && forceColor.toLowerCase() !== 'false';
  }

  const stream = target === 'stderr' ? process.stderr : process.stdout;

  return stream.isTTY === true;
}

function resolveTextColor(color: UiTextColor): string {
  return UI_THEME.colors[color as UiColorToken] ?? color;
}

// Envuelve cada linea por separado (en vez de todo el bloque de una vez) para
// que, si el contenido tiene varias lineas, el estilo no quede "abierto" en
// el salto de linea. Un panel que dibuja un borde entre cada linea de
// contenido insertaria ese borde dentro de un estilo todavia sin cerrar.
function wrapLines(value: string, open: string, close: string): string {
  return value
    .split('\n')
    .map((line) => `${open}${line}${close}`)
    .join('\n');
}

export function colorize(value: string, color: UiTextColor, target: OutputTarget = defaultTarget): string {
  if (!shouldUseColor(target)) {
    return value;
  }

  const open = resolveTextColor(color);

  // El atenuado (muted) no se apaga con COLOR_OFF: si se cerrara asi quedaria prendido y
  // apagaria todo lo que se imprime despues. Se cierra igual que la negrita.
  return wrapLines(value, open, open === DIM ? BOLD_OFF : COLOR_OFF);
}

export function bold(value: string, target: OutputTarget = defaultTarget): string {
  if (!shouldUseColor(target)) {
    return value;
  }

  return wrapLines(value, BOLD, BOLD_OFF);
}

export function badge(label: string, color: UiTextColor): string {
  return bold(colorize(`${UI_THEME.badgeBrackets[0]}${label}${UI_THEME.badgeBrackets[1]}`, color));
}

export function toneText(value: string, color: UiTextColor): string {
  return bold(colorize(value, color));
}

export function stripAnsi(value: string): string {
  // Colores (SGR) y links (OSC 8): ninguno ocupa columnas.
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001B\[[0-9;]*m|\u001B\]8;[^;]*;.*?(?:\u0007|\u001B\\)/g, '');
}

export function flattenVisibleLines(lines: readonly string[]): string[] {
  return lines.flatMap((line) => line.split('\n'));
}

export function wrapPlainText(value: string, width: number): string[] {
  if (width <= 0) {
    return [value];
  }

  return value.split('\n').flatMap((line) => {
    if (line.length <= width) {
      return [line];
    }

    const words = line.split(/\s+/);
    const wrapped: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;

      if (stripAnsi(candidate).length <= width) {
        currentLine = candidate;
        continue;
      }

      if (currentLine) {
        wrapped.push(currentLine);
      }

      if (stripAnsi(word).length <= width) {
        currentLine = word;
        continue;
      }

      let remaining = word;

      while (stripAnsi(remaining).length > width) {
        wrapped.push(remaining.slice(0, width));
        remaining = remaining.slice(width);
      }

      currentLine = remaining;
    }

    if (currentLine) {
      wrapped.push(currentLine);
    }

    return wrapped.length > 0 ? wrapped : [''];
  });
}

// Reparte palabras en lineas de `width` columnas visibles. La primera linea arranca con `firstPrefix`
// y las siguientes con `continuationPrefix`; las palabras mas largas que el espacio se cortan.
function wrapWords(words: readonly string[], firstPrefix: string, continuationPrefix: string, width: number): string[] {
  const wrapped: string[] = [];
  let currentLine = firstPrefix;
  let currentHasWords = false;

  for (const word of words) {
    const candidate = currentHasWords ? `${currentLine} ${word}` : `${currentLine}${word}`;

    if (stripAnsi(candidate).length <= width) {
      currentLine = candidate;
      currentHasWords = true;
      continue;
    }

    // La primera palabra que no entra se corta desde la primera linea: si no, se perderia `firstPrefix` (la
    // etiqueta de una fila "etiqueta  valor").
    let prefix = continuationPrefix;

    if (currentHasWords) {
      wrapped.push(currentLine);
    } else {
      prefix = currentLine;
    }

    let remaining = word;

    while (stripAnsi(remaining).length > Math.max(1, width - stripAnsi(prefix).length)) {
      const room = Math.max(1, width - stripAnsi(prefix).length);

      wrapped.push(`${prefix}${remaining.slice(0, room)}`);
      remaining = remaining.slice(room);
      prefix = continuationPrefix;
    }

    currentLine = `${prefix}${remaining}`;
    currentHasWords = true;
  }

  if (currentHasWords) {
    wrapped.push(currentLine);
  }

  return wrapped;
}

// eslint-disable-next-line no-control-regex
const ANSI_SEQUENCE = /^(?:\u001B\[[0-9;]*m|\u001B\]8;[^;]*;.*?(?:\u0007|\u001B\\))/;

// Corta `line` en la columna visible `column`, sin partir secuencias ANSI: los codigos que caen
// antes de esa columna (por ejemplo el cierre de una etiqueta en negrita) quedan en la primera parte.
function splitAtVisibleColumn(line: string, column: number): [string, string] {
  let visible = 0;
  let index = 0;

  while (index < line.length && visible < column) {
    const ansi = ANSI_SEQUENCE.exec(line.slice(index));

    if (ansi) {
      index += ansi[0].length;
      continue;
    }

    visible += 1;
    index += 1;
  }

  // Los codigos ANSI pegados al corte tambien van con la primera parte.
  for (let ansi = ANSI_SEQUENCE.exec(line.slice(index)); ansi; ansi = ANSI_SEQUENCE.exec(line.slice(index))) {
    index += ansi[0].length;
  }

  return [line.slice(0, index), line.slice(index)];
}

// Saca los espacios del final sin perder los codigos ANSI que haya entre ellos (el cierre de una negrita).
function trimTrailingSpaces(value: string): string {
  // eslint-disable-next-line no-control-regex
  const codes = value.match(/(?:\u001B\[[0-9;]*m)+\s*$/)?.[0]?.replace(/\s/g, '') ?? '';

  // eslint-disable-next-line no-control-regex
  return `${value.replace(/(?:\s|\u001B\[[0-9;]*m)+$/, '')}${codes}`;
}

// Filas "etiqueta + 2 o mas espacios + valor", como las de las tablas de los paneles.
const LABEL_VALUE_LINE = /^(\s*\S(?:.*?\S)?\s{2,})(\S.*)$/;
// Espacio minimo para el valor; con menos, conviene partir la linea entera.
const MIN_VALUE_COLUMN_WIDTH = 12;
// Item de una lista ("• texto", "- texto", "1. texto"): al partirse, el texto sigue debajo del texto.
const LIST_ITEM_MARKER = /^(?:[•*-]|\d+\.)\s+/;
const NO_COLUMNS: ReadonlySet<number> = new Set();

function labelColumnWidth(line: string): number | null {
  return LABEL_VALUE_LINE.exec(stripAnsi(line))?.[1]?.length ?? null;
}

// La etiqueta de una fila apilada, por palabras. Si se parte, cada linea abre y cierra su estilo: un panel dibuja
// un borde entre ellas, que no puede quedar adentro de un estilo sin cerrar.
function wrapLabel(label: string, indent: string, width: number): string[] {
  const visible = stripAnsi(label).trim();

  if (indent.length + visible.length <= width) {
    return [label];
  }

  // eslint-disable-next-line no-control-regex
  const open = label.match(/^\s*((?:\u001B\[[0-9;]*m)*)/)?.[1] ?? '';
  // eslint-disable-next-line no-control-regex
  const close = label.match(/((?:\u001B\[[0-9;]*m)*)$/)?.[1] ?? '';

  return wrapWords(visible.split(/\s+/), '', '', width - indent.length).map(
    (line) => `${indent}${open}${line}${close}`,
  );
}

/**
 * Parte lineas que no entran en `width` respetando su sangria.
 * Si la linea es una fila etiqueta/valor, el valor sigue debajo de su propia columna en vez de
 * pegarse a la etiqueta, asi la tabla no se desarma en terminales angostas. Las columnas de `stackedColumns` van
 * con la etiqueta en una linea y el valor debajo, aunque la fila entre (ver `wrapPanelLines`).
 */
export function wrapIndentedPlainText(
  value: string,
  width: number,
  stackedColumns: ReadonlySet<number> = NO_COLUMNS,
): string[] {
  if (width <= 0) {
    return [value];
  }

  return value.split('\n').flatMap((line) => {
    // La columna se busca sobre el texto visible: con ANSI (etiquetas en negrita) la regex cortaria mal.
    const columnMatch = LABEL_VALUE_LINE.exec(stripAnsi(line));
    const prefixWidth = columnMatch?.[1]?.length ?? 0;
    const stacked = columnMatch !== null && stackedColumns.has(prefixWidth);

    if (stripAnsi(line).length <= width && !stacked) {
      return [line];
    }

    if (columnMatch) {
      const [prefix, rest] = splitAtVisibleColumn(line, prefixWidth);
      const values = rest.split(/\s+/);

      if (width - prefixWidth >= MIN_VALUE_COLUMN_WIDTH && !stacked) {
        return wrapWords(values, prefix, ' '.repeat(prefixWidth), width);
      }

      // Sin lugar para la columna: etiqueta en una linea y el valor debajo, con sangria.
      const indent = columnMatch[1]?.match(/^\s*/)?.[0] ?? '';
      const valueIndent = `${indent}  `;

      return [
        ...wrapLabel(trimTrailingSpaces(prefix), indent, width),
        ...wrapWords(values, valueIndent, valueIndent, width),
      ];
    }

    const indent = line.match(/^\s*/)?.[0] ?? '';
    const content = line.slice(indent.length).trimStart();

    if (!content) {
      return [line];
    }

    const marker = LIST_ITEM_MARKER.exec(content)?.[0] ?? '';
    const wrapped = wrapWords(
      content.slice(marker.length).split(/\s+/),
      `${indent}${marker}`,
      `${indent}${' '.repeat(marker.length)}`,
      width,
    );

    return wrapped.length > 0 ? wrapped : [line];
  });
}

/**
 * Las lineas de un panel. Si una fila no entra y su columna no deja lugar para el valor, se apilan todas las de esa
 * columna: mezcladas con filas en columnas, la tabla se lee mal.
 */
export function wrapPanelLines(lines: readonly string[], width: number): string[] {
  const flattened = flattenVisibleLines(lines);
  const stackedColumns = new Set<number>();

  for (const line of flattened) {
    const column = labelColumnWidth(line);

    if (column !== null && stripAnsi(line).length > width && width - column < MIN_VALUE_COLUMN_WIDTH) {
      stackedColumns.add(column);
    }
  }

  return flattened.flatMap((line) => wrapIndentedPlainText(line, width, stackedColumns));
}

export function maxVisibleWidth(lines: readonly string[]): number {
  return Math.max(...flattenVisibleLines(lines).map((line) => stripAnsi(line).length), 0);
}

export function centerText(value: string, width: number): string {
  const visibleWidth = stripAnsi(value).length;
  const leftPadding = Math.max(0, Math.floor((width - visibleWidth) / 2));

  return `${' '.repeat(leftPadding)}${value}`;
}

export function centerLines(lines: readonly string[], width: number): string[] {
  return flattenVisibleLines(lines).map((line) => centerText(line, width));
}
