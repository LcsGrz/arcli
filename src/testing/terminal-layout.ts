import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Como se ve una salida en una terminal de cierto ancho: los tests de tablas y leyendas (TUI-27/28) la miran como la
 * persona, por columnas y bordes, sin depender de como se arma por dentro.
 */

// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;?]*[A-Za-z]/g;

export const plainText = (text: string): string => text.replace(ANSI, '');

/**
 * La terminal de cada test: `columns` (null, como en un pipe), si es una TTY y las variables de color. Lo deja como
 * estaba al terminar.
 */
export function useTerminal(): {
  readonly set: (options: {
    readonly ascii?: boolean;
    readonly color?: 'dumb' | 'forzado' | 'no-color' | 'redirigida';
    readonly columns: null | number;
  }) => void;
} {
  let saved: { columns: number; isTTY: boolean | undefined; stderrColumns: number };

  beforeEach(() => {
    saved = { columns: process.stdout.columns, isTTY: process.stdout.isTTY, stderrColumns: process.stderr.columns };
  });

  afterEach(() => {
    process.stdout.columns = saved.columns;
    process.stderr.columns = saved.stderrColumns;
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: saved.isTTY, writable: true });
    vi.unstubAllEnvs();
  });

  return {
    set({ ascii = false, color = 'redirigida', columns }) {
      process.stdout.columns = columns ?? 0;
      process.stderr.columns = columns ?? 0;
      Object.defineProperty(process.stdout, 'isTTY', {
        configurable: true,
        value: color !== 'redirigida',
        writable: true,
      });

      if (ascii) vi.stubEnv('ARCLI_ASCII', '1');
      if (color === 'forzado') vi.stubEnv('FORCE_COLOR', '1');
      if (color === 'no-color') vi.stubEnv('NO_COLOR', '1');
      if (color === 'dumb') vi.stubEnv('TERM', 'dumb');
    },
  };
}

/** Un borde de arriba o de abajo de un panel `listing`: `═` en Unicode, `+---+` en ASCII. */
const isBorder = (line: string): boolean => /^(═|\+-)/.test(line);

export interface ListingPanelParts {
  /** Lo de afuera del panel, debajo del borde de abajo, hasta el panel siguiente (con sus lineas en blanco). */
  readonly after: readonly string[];
  /** Lo de adentro, entre los dos bordes, tal cual (con color si lo hay). */
  readonly inside: readonly string[];
  /** Ancho del panel: el del borde de abajo. */
  readonly width: number;
}

/**
 * Los paneles `listing` de una salida, en orden. Cada linea va como sale (con su color); los bordes se reconocen sin
 * color. Pensado para Unicode: en ASCII el divisor de adentro tambien es `+---+`.
 */
export function listingPanels(text: string): ListingPanelParts[] {
  const raw = text.split('\n');
  const borders = raw.map((line, index) => (isBorder(plainText(line)) ? index : -1)).filter((index) => index >= 0);
  const panels: ListingPanelParts[] = [];

  for (let pair = 0; pair + 1 < borders.length; pair += 2) {
    const top = borders[pair] ?? 0;
    const bottom = borders[pair + 1] ?? 0;
    const next = borders[pair + 2] ?? raw.length;

    panels.push({
      after: raw.slice(bottom + 1, next),
      inside: raw.slice(top + 1, bottom),
      width: plainText(raw[bottom] ?? '').length,
    });
  }

  return panels;
}

/** La leyenda de un panel: lo de abajo del borde, sin las lineas en blanco de las puntas. */
export function legendLines(panel: ListingPanelParts): string[] {
  const lines = [...panel.after];

  while (lines.length > 0 && plainText(lines[0] ?? '').trim() === '') lines.shift();
  while (lines.length > 0 && plainText(lines.at(-1) ?? '').trim() === '') lines.pop();

  return lines;
}

/** Cuanto se corre una linea del centro del ancho: 0 o 0,5 si esta centrada (con la mitad que sobra a un lado). */
export function offCenter(line: string, width: number): number {
  const text = plainText(line).trimEnd();
  const indent = text.length - text.trimStart().length;
  const length = text.trimStart().length;

  return Math.abs(indent - (width - length) / 2);
}

/** Las columnas de la terminal (de 0) que pinta el video inverso en una linea: `\u001B[7m` hasta `[27m` o `[0m`. */
export function inverseColumns(line: string): number[] {
  const columns: number[] = [];
  let column = 0;
  let inverse = false;

  // eslint-disable-next-line no-control-regex
  for (const [token] of line.matchAll(/\u001B\[[0-9;?]*[A-Za-z]|[\s\S]/gu)) {
    if (token.startsWith('\u001B')) {
      const codes = token.slice(2, -1).split(';');

      if (token.endsWith('m')) {
        if (codes.includes('7')) inverse = true;
        if (codes.includes('27') || codes.includes('0') || token === '\u001B[m') inverse = false;
      }
    } else {
      if (inverse) columns.push(column);
      column += 1;
    }
  }

  return columns;
}

export interface TableColumn {
  readonly end: number;
  readonly start: number;
}

/**
 * Las columnas de una tabla alineada, por donde empieza y termina el texto en el encabezado y las filas: las celdas
 * van separadas por dos espacios o mas, y adentro de una celda hay a lo sumo uno ("$ 12.009,45", "IMP. SERV.").
 * `from` es donde arranca la primera columna (lo de antes, como la `❯`, no cuenta).
 */
export function tableColumns(lines: readonly string[], from: number): TableColumn[] {
  const columns: Array<{ end: number; start: number }> = [];

  for (const line of lines) {
    const text = ' '.repeat(from) + plainText(line).slice(from);
    const cells = [...text.matchAll(/\S+(?: \S+)*/g)];

    cells.forEach((cell, index) => {
      const start = cell.index ?? 0;
      const end = start + cell[0].length;
      const current = columns[index];

      columns[index] = current
        ? { end: Math.max(current.end, end), start: Math.min(current.start, start) }
        : { end, start };
    });
  }

  return columns;
}

/** Los espacios entre una columna y la siguiente. */
export function separators(columns: readonly TableColumn[]): number[] {
  return columns.slice(1).map((column, index) => column.start - (columns[index]?.end ?? 0));
}
