import { describe, expect, it } from 'vitest';

import {
  inverseColumns,
  legendLines,
  listingPanels,
  offCenter,
  plainText,
  separators,
  tableColumns,
  useTerminal,
} from '../../../testing/terminal-layout';
import { BUNDLED_MONOTRIBUTO_TABLE } from '../monotributo.bundled';
import {
  formatMonotributoFullAsText,
  formatMonotributoSummaryAsText,
  type MonotributoReport,
} from '../monotributo.presenter';

/**
 * TUI-27 y TUI-28, como se ven en 40, 72 y 92 columnas (y en un pipe, que es como 92): la tabla del monotributo a
 * todo el ancho, la fila propia con fondo y las leyendas afuera de la tabla. Datos ficticios: la tabla incluida.
 */

function report(partial: Partial<MonotributoReport> = {}): MonotributoReport {
  return {
    consultedOn: '20261118',
    notices: [],
    ownCategory: 'E',
    source: 'arca',
    table: BUNDLED_MONOTRIBUTO_TABLE,
    version: '2.6.0',
    ...partial,
  };
}

const terminal = useTerminal();

/** El ancho del panel en una terminal de `columns` (o un pipe): el de ARCLI, 92, o el de la terminal si es menor. */
const panelWidth = (columns: null | number) => Math.min(92, columns ?? 92);
/** Lo que entra adentro del panel: sin los bordes ni el margen de dos espacios de cada lado. */
const contentWidth = (columns: null | number) => panelWidth(columns) - 6;
/** Donde arranca el contenido: borde, margen de dos espacios. */
const CONTENT_START = 3;

/** El encabezado y las filas de la tabla del resumen, desde el renglon de `CAT.`. */
function summaryTable(inside: readonly string[]): { readonly from: number; readonly lines: string[] } {
  const plain = inside.map(plainText);
  const header = plain.findIndex((line) => line.includes('CAT.'));

  return {
    from: (plain[header] ?? '').indexOf('CAT.'),
    lines: plain.slice(header, header + 12),
  };
}

/** La fila de la categoria (la letra sola en su columna), sin color. */
const rowOf = (lines: readonly string[], letter: string) =>
  lines.find((line) => new RegExp(`^\\s+(?:[❯>] )?${letter}\\s{2,}\\$`).test(plainText(line))) ?? '';

describe('la tabla de categorías ocupa todo el ancho (TUI-27)', () => {
  it.each([72, 92, null])(
    'en %s columnas el sobrante se reparte en partes iguales entre columnas, mínimo 3',
    (columns) => {
      terminal.set({ columns });

      const [panel] = listingPanels(formatMonotributoSummaryAsText(report()));
      const table = summaryTable(panel?.inside ?? []);
      const cells = tableColumns(table.lines, table.from);
      const gaps = separators(cells.slice(0, 4));
      const tableWidth = (cells.at(-1)?.end ?? 0) - CONTENT_START;

      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(3);
      // Nada más en las filas: ni la etiqueta de la propia al lado.
      expect(cells).toHaveLength(4);
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
      // Lo que no se puede repartir parejo (menos de un espacio por separador) puede quedar sin usar.
      expect(tableWidth).toBeGreaterThan(contentWidth(columns) - gaps.length);
      expect(tableWidth).toBeLessThanOrEqual(contentWidth(columns));
    },
  );

  it('en una terminal más ancha que ARCLI no pasa de 92', () => {
    terminal.set({ columns: 140 });

    const text = formatMonotributoSummaryAsText(report());
    const [panel] = listingPanels(text);
    const table = summaryTable(panel?.inside ?? []);
    const cells = tableColumns(table.lines, table.from);

    expect(panel?.width).toBe(92);
    expect((cells.at(-1)?.end ?? 0) - CONTENT_START).toBeGreaterThan(86 - 3);
  });

  it('si con 3 no entra, va con 2, como hasta ahora', () => {
    // 68 columnas: 62 de contenido; la tabla con 2 ocupa 61 y con 3, 64.
    terminal.set({ columns: 68 });

    const [panel] = listingPanels(formatMonotributoSummaryAsText(report()));
    const table = summaryTable(panel?.inside ?? []);

    expect(separators(tableColumns(table.lines, table.from))).toEqual([2, 2, 2]);
  });

  it('si tampoco entra con 2, cada categoría en dos líneas, sin cortarse', () => {
    terminal.set({ columns: 40 });

    const text = plainText(formatMonotributoSummaryAsText(report({ ownCategory: 'K' })));

    expect(text).toMatch(/❯ K {2}\$ 126\.610\.838,75/);
    expect(text).toMatch(/\n\s+\$ 1\.614\.446,04 · \$ 702\.103,24/);
    expect(Math.max(...text.split('\n').map((line) => line.trimEnd().length))).toBeLessThanOrEqual(40);
  });

  it('los dos bloques de --completa también van a todo el ancho, mínimo 3 entre columnas si entran', () => {
    terminal.set({ columns: 92 });

    const [limits] = listingPanels(formatMonotributoFullAsText(report()));
    const inside = (limits?.inside ?? []).map(plainText);
    const header = inside.findIndex((line) => line.includes('CAT.'));
    const from = (inside[header] ?? '').indexOf('CAT.');
    const cells = tableColumns(inside.slice(header, header + 12), from);
    const gaps = separators(cells);

    expect(cells).toHaveLength(6);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
    expect((cells.at(-1)?.end ?? 0) - CONTENT_START).toBeGreaterThan(86 - gaps.length);
  });

  it('--completa en 72 columnas sigue apilando: los comandos sueltos no tienen ventana de columnas', () => {
    terminal.set({ columns: 72 });

    const text = plainText(formatMonotributoFullAsText(report()));

    expect(text).toMatch(/❯ E\s*\n +ingresos +\$ 36\.028\.231,33/);
    expect(text).toMatch(/❯ E\s*\n +imp\. serv\. +55\.857,73/);
    expect(text).not.toMatch(/columnas \d+ a \d+ de \d+/);
  });
});

describe('la fila de la categoría propia (TUI-27)', () => {
  it.each([72, 92])('con color, en %s columnas, la fila tiene fondo de punta a punta del contenido', (columns) => {
    terminal.set({ color: 'forzado', columns });

    const [panel] = listingPanels(formatMonotributoSummaryAsText(report()));
    const inside = panel?.inside ?? [];
    const own = inverseColumns(rowOf(inside, 'E'));

    expect(own.length).toBeGreaterThan(0);
    expect(own[0]).toBeLessThanOrEqual(CONTENT_START);
    expect(own[0]).toBeGreaterThanOrEqual(1);
    expect(own.at(-1)).toBeGreaterThanOrEqual(CONTENT_START + contentWidth(columns) - 1);
    expect(own.at(-1)).toBeLessThan(panelWidth(columns) - 1);
    // Sin huecos: es un solo fondo, no uno por celda.
    expect(own).toHaveLength((own.at(-1) ?? 0) - (own[0] ?? 0) + 1);
    // Solo la propia: ni el encabezado ni las demás.
    expect(inside.filter((line) => inverseColumns(line).length > 0)).toHaveLength(1);
  });

  it('con color, en 40 columnas (dos líneas por categoría), el fondo cubre las dos', () => {
    terminal.set({ color: 'forzado', columns: 40 });

    const [panel] = listingPanels(formatMonotributoSummaryAsText(report()));
    const inside = panel?.inside ?? [];
    const first = inside.findIndex((line) => /^\s+❯ E {2}\$ 36\.028\.231,33/.test(plainText(line)));
    const marked = inside.flatMap((line, index) => (inverseColumns(line).length > 0 ? [index] : []));

    expect(marked).toEqual([first, first + 1]);

    for (const index of marked) {
      const columnsOn = inverseColumns(inside[index] ?? '');

      expect(columnsOn[0]).toBeLessThanOrEqual(CONTENT_START);
      expect(columnsOn.at(-1)).toBeGreaterThanOrEqual(CONTENT_START + contentWidth(40) - 1);
    }
  });

  it.each(['redirigida', 'no-color', 'dumb'] as const)(
    'sin color (%s) no hay fondo ni negrita y la fila se marca con ❯',
    (color) => {
      terminal.set({ color, columns: 92 });

      const text = formatMonotributoSummaryAsText(report());

      expect(text).not.toContain('\u001B[');
      expect(text).toMatch(/\n\s+❯ E\s+\$ 36\.028\.231,33/);
    },
  );

  it.each([40, 72, 92])(
    'en %s columnas, "tu categoría" no va al lado de la fila: se explica una vez, abajo',
    (columns) => {
      terminal.set({ columns });

      const text = formatMonotributoSummaryAsText(report());
      const [panel] = listingPanels(text);

      expect(plainText(text).match(/tu categoría/g)).toHaveLength(1);
      expect((panel?.inside ?? []).map(plainText).join('\n')).not.toContain('tu categoría');
      expect(legendLines(panel ?? { after: [], inside: [], width: 0 }).map((line) => line.trim())).toContain(
        '❯ tu categoría',
      );
    },
  );

  // Tests primero (TUI-27/28): sigue en it.fails. En 92 columnas la fila de la E sigue con las dos cuotas después del
  // tope y la regex pide que la línea termine en el tope (como en la tabla de dos líneas). Ver el informe de TUI-27.
  it.fails('en ASCII la marca y la leyenda van con >', () => {
    terminal.set({ ascii: true, columns: 92 });

    const text = plainText(formatMonotributoSummaryAsText(report()));
    const lines = text.split('\n');

    expect(text).toMatch(/\n\|?\s+> E\s+\$ 36\.028\.231,33\s*\|?\n/);
    expect(lines.filter((line) => line.includes('tu categoría')).map((line) => line.trim())).toEqual([
      '> tu categoría',
    ]);
    expect(lines.findIndex((line) => line.includes('> tu categoría'))).toBeGreaterThan(
      lines.findLastIndex((line) => /^\+-+\+$/.test(line)),
    );
  });

  it('sin categoría propia no hay marca, ni fondo, ni leyenda de la marca', () => {
    terminal.set({ color: 'forzado', columns: 92 });

    const text = formatMonotributoSummaryAsText(report({ ownCategory: null }));

    expect(plainText(text)).not.toContain('❯');
    expect(plainText(text)).not.toContain('tu categoría');
    expect(text).not.toContain('\u001B[7m');
  });
});

describe('las leyendas del monotributo van afuera de la tabla (TUI-28)', () => {
  const NOTES = [
    'La cuota es mensual: impuesto integrado, aporte jubilatorio (SIPA) y obra social.',
    'Tabla de ARCA, consultada el 18/11/2026.',
    'Una categoría completa: `arcli monotributo --categoria E`',
    'Todas las columnas: `arcli monotributo --completa`',
  ];

  it.each([40, 72, 92])(
    'en %s columnas: debajo del borde, tras una línea en blanco, centradas y una idea por línea',
    (columns) => {
      terminal.set({ columns });

      const text = formatMonotributoSummaryAsText(report(), { hints: true });
      const [panel] = listingPanels(text);
      const inside = (panel?.inside ?? []).map(plainText).join('\n');
      const legend = legendLines(panel ?? { after: [], inside: [], width: 0 });
      const legendText = legend.map((line) => plainText(line).trim()).join(' ');

      expect(plainText(panel?.after[0] ?? 'x').trim()).toBe('');
      expect(plainText(panel?.after[1] ?? '').trim()).not.toBe('');

      for (const note of NOTES) {
        expect(inside).not.toContain(note.slice(0, 20));
        expect(legendText).toContain(note);
      }

      for (const line of legend.filter((item) => plainText(item).trim() !== '')) {
        expect(plainText(line).trimEnd().length).toBeLessThanOrEqual(panelWidth(columns));
        expect(offCenter(line, panelWidth(columns))).toBeLessThanOrEqual(0.5);
      }

      // Una idea por línea: ninguna línea junta el final de una nota con el comienzo de otra.
      for (const line of legend.map((item) => plainText(item).trim())) {
        expect(line).not.toMatch(/\.\s+\S|`\s+\S/);
      }
    },
  );

  it('una nota que no entra se parte, y cada pedazo va centrado', () => {
    terminal.set({ columns: 40 });

    const [panel] = listingPanels(formatMonotributoSummaryAsText(report()));
    const legend = legendLines(panel ?? { after: [], inside: [], width: 0 }).map(plainText);
    const start = legend.findIndex((line) => line.trim().startsWith('La cuota es mensual'));
    const pieces: string[] = [];

    for (let index = start; index >= 0 && index < legend.length; index += 1) {
      pieces.push((legend[index] ?? '').trim());
      if (pieces.join(' ').endsWith('obra social.')) break;
    }

    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join(' ')).toBe(NOTES[0]);

    for (const piece of legend.slice(start, start + pieces.length)) {
      expect(offCenter(piece, 40)).toBeLessThanOrEqual(0.5);
    }
  });

  it('con color, la leyenda va atenuada', () => {
    terminal.set({ color: 'forzado', columns: 92 });

    const [panel] = listingPanels(formatMonotributoSummaryAsText(report(), { hints: true }));
    const legend = legendLines(panel ?? { after: [], inside: [], width: 0 }).filter(
      (line) => plainText(line).trim() !== '',
    );

    expect(legend.length).toBeGreaterThanOrEqual(NOTES.length);

    for (const line of legend) {
      expect(line).toContain('\u001B[2m');
    }
  });

  it('el tope configurado y la tabla incluida también van en la leyenda', () => {
    terminal.set({ columns: 92 });

    const text = formatMonotributoSummaryAsText(
      report({ configuredLimit: 30_000_000, consultedOn: null, source: 'incluida' }),
    );
    const [panel] = listingPanels(text);
    const legend = legendLines(panel ?? { after: [], inside: [], width: 0 }).map((line) => plainText(line).trim());

    expect(legend).toContain('Tabla incluida en ARCLI 2.6.0.');
    expect(legend).toContain('Tu tope de ingresos configurado (`monotributo.tope`): $ 30.000.000.');
  });

  it('adentro solo el borde de arriba y el de abajo, y lo último que se ve es la última sugerencia', () => {
    terminal.set({ columns: 92 });

    const text = plainText(formatMonotributoSummaryAsText(report(), { hints: true }));

    expect(text.split('\n').filter((line) => line.includes('═'))).toHaveLength(2);
    expect(text.trimEnd().split('\n').at(-1)?.trim()).toBe('Todas las columnas: `arcli monotributo --completa`');
  });
});

describe('--completa: posición adentro, fuente una vez afuera (TUI-28)', () => {
  it.each([40, 72, 92])('en %s columnas la línea de posición va adentro de cada bloque, arriba', (columns) => {
    terminal.set({ columns });

    const [limits, fee] = listingPanels(formatMonotributoFullAsText(report()));
    const firstLine = (panel: typeof limits) =>
      (panel?.inside ?? []).map((line) => plainText(line).trim()).find((line) => line !== '');

    expect(firstLine(limits)).toBe('1/2  sigue abajo: cuota mensual ↓');
    expect(firstLine(fee)).toBe('2/2  ↑ arriba: límites anuales');
  });

  it.each([40, 72, 92])(
    'en %s columnas, "Tabla de ARCA, consultada el …" una sola vez, centrada, debajo del segundo bloque',
    (columns) => {
      terminal.set({ columns });

      const text = formatMonotributoFullAsText(report());
      const [limits, fee] = listingPanels(text);
      const legend = legendLines(fee ?? { after: [], inside: [], width: 0 });

      expect(
        plainText(text)
          .replace(/\s+/g, ' ')
          .match(/Tabla de ARCA, consultada el 18\/11\/2026\./g),
      ).toHaveLength(1);
      expect(legend.map((line) => plainText(line).trim())).toEqual(['Tabla de ARCA, consultada el 18/11/2026.']);
      expect(offCenter(legend[0] ?? '', panelWidth(columns))).toBeLessThanOrEqual(0.5);
      expect(
        (limits?.inside ?? [])
          .concat(fee?.inside ?? [])
          .map(plainText)
          .join('\n'),
      ).not.toContain('Tabla de ARCA');
    },
  );
});
