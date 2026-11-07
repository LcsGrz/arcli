import { UI_THEME, type UiWidthPreset } from '../theme/theme';

import { colorize, toneText } from './text';

export interface RenderKeyValueOptions {
  /** Espacios antes de la etiqueta, para filas que van bajo un subtitulo dentro del panel. */
  readonly indent?: number;
  /** Etiquetas atenuadas, como las de la config; por defecto, en negrita. */
  readonly labelTone?: 'muted' | 'neutral';
  readonly labelWidth?: number;
}

/**
 * Ancho de la columna de etiquetas en un panel de `preset`: la proporcion del tema para ese ancho
 * (`table.labelColumn`), sin bajar de lo que necesita la etiqueta mas larga. Asi los valores arrancan en la misma
 * columna en todos los paneles del mismo ancho.
 */
export function resolveKeyValueLabelWidth(
  preset: UiWidthPreset,
  rows: ReadonlyArray<readonly [string, ...unknown[]]>,
): number {
  const innerWidth =
    UI_THEME.widths[preset].min -
    (UI_THEME.spacing.panelPadding.left ?? 0) -
    (UI_THEME.spacing.panelPadding.right ?? 0) -
    2;
  const proportionalWidth = Math.round(innerWidth * (UI_THEME.table.labelColumn[preset] / 100));
  const naturalWidth = Math.max(...rows.map(([label]) => label.length), 0);

  return Math.max(naturalWidth, proportionalWidth);
}

function normalizeValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? 'N/D' : String(value);
}

/** Filas "etiqueta  valor" con el valor en una columna alineada. Sin `labelWidth`, la etiqueta mas larga. */
export function renderKeyValueRows(
  rows: ReadonlyArray<readonly [string, string | number | null | undefined]>,
  options: RenderKeyValueOptions = {},
): string[] {
  const labelWidth = options.labelWidth ?? Math.max(...rows.map(([label]) => label.length), 0);
  const indent = ' '.repeat(options.indent ?? 0);
  const gap = ' '.repeat(UI_THEME.table.gap);

  return rows.map(([label, value]) => {
    const paddedLabel = label.padEnd(labelWidth);
    const styledLabel =
      options.labelTone === 'muted' ? colorize(paddedLabel, 'muted') : toneText(paddedLabel, 'neutral');

    return `${indent}${styledLabel}${gap}${normalizeValue(value)}`;
  });
}
