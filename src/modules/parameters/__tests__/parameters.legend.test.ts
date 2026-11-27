import { describe, expect, it } from 'vitest';

import {
  legendLines,
  listingPanels,
  offCenter,
  plainText,
  separators,
  tableColumns,
  useTerminal,
} from '../../../testing/terminal-layout';
import type { ParameterEntry, ParameterTable } from '../parameters';
import { formatParameterEntriesAsText } from '../parameters.presenter';

/**
 * TUI-28 en las 9 tablas de `arcli parametros <tabla>`: lo que explica la tabla va afuera, debajo del borde, centrado
 * y atenuado, sin el divisor `═` corto de adentro. Las columnas no se estiran. Valores ficticios.
 */

const terminal = useTerminal();

const panelWidth = (columns: null | number) => Math.min(92, columns ?? 92);

/** Lo que dice cada tabla abajo, una idea por línea. */
const LEGENDS: Record<ParameterTable, readonly string[]> = {
  alicuotas: ['`--alicuota` va con la tasa (`21`, `10.5`), no con el código.'],
  comprobantes: ['ARCLI los elige por atajo (`fc`, `nca`); el código es el de `--at`, el tipo del asociado.'],
  conceptos: ['`--concepto` va con el nombre: `productos`, `servicios` o `productos-servicios`.'],
  documentos: ['El documento del receptor: en ARCLI va con `--cuit`, `--cuil`, `--dni` o `--cfinal`.'],
  // La ayuda larga se parte en dos frases.
  'iva-receptor': [
    '`--ir` va con el nombre (`responsable-inscripto`) o un atajo (`--ir-ri`).',
    'Comprobantes: las letras que la admiten.',
  ],
  monedas: ['`--moneda` acepta este código o el ISO: `060` o `EUR`.'],
  opcionales: ['Datos que ARCA acepta además de los básicos. ARCLI completa solo los que usa, como el CBU de la FCE.'],
  'puntos-venta': ['El número va en `--pv` o en la config (`puntoVenta`).', 'Solo sirven los de web service.'],
  tributos: ['ARCLI todavía no informa tributos, como las percepciones de IIBB.'],
};

const ENTRIES: Record<ParameterTable, readonly ParameterEntry[]> = {
  alicuotas: [
    { description: '21%', id: '5' },
    { description: '10.5%', id: '4' },
  ],
  comprobantes: [
    { description: 'Factura A', id: '1' },
    { description: 'Factura B', id: '6' },
  ],
  conceptos: [
    { description: 'Productos', id: '1' },
    { description: 'Servicios', id: '2' },
  ],
  documentos: [
    { description: 'CUIT', id: '80' },
    { description: 'DNI', id: '96' },
  ],
  'iva-receptor': [
    { description: 'IVA Responsable Inscripto', detail: 'A/M/C', id: '1' },
    { description: 'Consumidor Final', detail: 'B/C', id: '5' },
  ],
  monedas: [
    { description: 'Dólar Estadounidense', id: 'DOL' },
    { description: 'Euro', id: '060' },
  ],
  opcionales: [{ description: 'CBU del emisor', id: '2101' }],
  'puntos-venta': [
    { description: 'CAE', detail: 'habilitado', id: '3' },
    { description: 'CAEA', detail: 'bloqueado', id: '4' },
  ],
  tributos: [{ description: 'Percepción de IIBB', id: '2' }],
};

const TABLES = Object.keys(LEGENDS) as ParameterTable[];

/** Las líneas de la leyenda, sin color ni espacios de las puntas. */
const trimmed = (lines: readonly string[]) => lines.map((line) => plainText(line).trim());

describe('arcli parametros: la leyenda va afuera de la tabla (TUI-28)', () => {
  it.each(TABLES)('%s, en 92 columnas: debajo del borde, tras una línea en blanco, centrada', (table) => {
    terminal.set({ columns: 92 });

    const text = formatParameterEntriesAsText(table, ENTRIES[table], 'testing');
    const [panel] = listingPanels(text);
    const legend = legendLines(panel ?? { after: [], inside: [], width: 0 });

    expect(trimmed(panel?.inside ?? []).join('\n')).not.toContain(LEGENDS[table][0]?.slice(0, 16));
    expect(plainText(panel?.after[0] ?? 'x').trim()).toBe('');
    // Una línea larga puede partirse; el texto es el mismo.
    expect(trimmed(legend).join(' ')).toBe(LEGENDS[table].join(' '));

    for (const line of legend) {
      expect(offCenter(line, 92)).toBeLessThanOrEqual(0.5);
    }
  });

  it.each(TABLES)('%s, en 92 columnas: una idea por línea', (table) => {
    terminal.set({ columns: 92 });

    const [panel] = listingPanels(formatParameterEntriesAsText(table, ENTRIES[table], 'testing'));

    // Ninguna línea junta el final de una frase con el comienzo de otra.
    for (const line of trimmed(legendLines(panel ?? { after: [], inside: [], width: 0 }))) {
      expect(line).not.toMatch(/\.\s+\S/);
    }
  });

  it('la ayuda de iva-receptor va en dos frases, una por línea', () => {
    terminal.set({ columns: 92 });

    const [panel] = listingPanels(formatParameterEntriesAsText('iva-receptor', ENTRIES['iva-receptor'], 'testing'));

    expect(trimmed(legendLines(panel ?? { after: [], inside: [], width: 0 }))).toEqual(LEGENDS['iva-receptor']);
  });

  it.each(TABLES)('%s: adentro no queda el divisor ═ corto', (table) => {
    terminal.set({ columns: 92 });

    const [panel] = listingPanels(formatParameterEntriesAsText(table, ENTRIES[table], 'testing'));

    expect(trimmed(panel?.inside ?? []).filter((line) => line.includes('═'))).toEqual([]);
    // Y la leyenda está: no se la sacó junto con el divisor.
    expect(trimmed(legendLines(panel ?? { after: [], inside: [], width: 0 })).join(' ')).toContain(LEGENDS[table][0]);
  });

  it.each([40, 72])('en %s columnas lo que no entra se parte, y cada pedazo va centrado', (columns) => {
    terminal.set({ columns });

    const [panel] = listingPanels(formatParameterEntriesAsText('iva-receptor', ENTRIES['iva-receptor'], 'testing'));
    const legend = legendLines(panel ?? { after: [], inside: [], width: 0 });

    expect(legend.length).toBeGreaterThanOrEqual(2);
    expect(trimmed(legend).join(' ')).toBe(LEGENDS['iva-receptor'].join(' '));
    // La segunda frase arranca en su propia línea.
    expect(trimmed(legend)).toContain('Comprobantes: las letras que la admiten.');

    for (const line of legend) {
      expect(plainText(line).trimEnd().length).toBeLessThanOrEqual(columns);
      expect(offCenter(line, panelWidth(columns))).toBeLessThanOrEqual(0.5);
    }
  });

  it('con color, la leyenda va atenuada', () => {
    terminal.set({ color: 'forzado', columns: 92 });

    const [panel] = listingPanels(formatParameterEntriesAsText('monedas', ENTRIES.monedas, 'testing'));
    const legend = legendLines(panel ?? { after: [], inside: [], width: 0 });

    expect(legend).toHaveLength(1);
    expect(legend[0]).toContain('\u001B[2m');
  });

  it('sin color no hay secuencias de escape', () => {
    terminal.set({ color: 'no-color', columns: 92 });

    expect(formatParameterEntriesAsText('monedas', ENTRIES.monedas, 'testing')).not.toContain('\u001B[');
  });

  it('en ASCII la leyenda también va debajo del borde', () => {
    terminal.set({ ascii: true, columns: 92 });

    const lines = plainText(formatParameterEntriesAsText('monedas', ENTRIES.monedas, 'testing')).split('\n');
    const borders = lines.flatMap((line, index) => (/^\+-/.test(line) ? [index] : []));

    expect(borders).toHaveLength(2);
    expect(trimmed(lines.slice((borders[1] ?? 0) + 1)).filter(Boolean)).toEqual(LEGENDS.monedas);
  });

  it.each([72, 92, null])('en %s columnas la tabla no se estira: dos espacios entre columnas', (columns) => {
    terminal.set({ columns });

    const [panel] = listingPanels(formatParameterEntriesAsText('iva-receptor', ENTRIES['iva-receptor'], 'testing'));
    const inside = (panel?.inside ?? []).map(plainText);
    const header = inside.findIndex((line) => line.includes('CÓDIGO'));
    const from = (inside[header] ?? '').indexOf('CÓDIGO');

    expect(separators(tableColumns(inside.slice(header, header + 3), from))).toEqual([2, 2]);
  });
});
