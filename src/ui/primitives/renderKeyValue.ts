import { UI_THEME, type UiWidthPreset } from '../theme/theme';

import { toneText } from './text';

export interface RenderKeyValueOptions {
  readonly gap?: number;
  readonly labelWidth?: number;
}

const DEFAULT_COLUMN_WIDTHS: readonly number[] = [50, 50];

/**
 * Ancho de columna de etiqueta como porcentaje del panel (columnWidths[0]),
 * sin bajar de lo que necesita la etiqueta mas larga. Por defecto reparte
 * el ancho en partes iguales entre las columnas (50/50 para las 2 columnas
 * habituales de label/value).
 */
export function resolveKeyValueLabelWidth(
  preset: UiWidthPreset,
  rows: ReadonlyArray<readonly [string, ...unknown[]]>,
  columnWidths: readonly number[] = DEFAULT_COLUMN_WIDTHS,
): number {
  const innerWidth =
    UI_THEME.widths[preset].min -
    (UI_THEME.spacing.panelPadding.left ?? 0) -
    (UI_THEME.spacing.panelPadding.right ?? 0) -
    2;
  const labelPercentage = columnWidths[0] ?? 100 / columnWidths.length;
  const proportionalWidth = Math.round(innerWidth * (labelPercentage / 100));
  const naturalWidth = Math.max(...rows.map(([label]) => label.length), 0);

  return Math.max(naturalWidth, proportionalWidth);
}

function normalizeValue(value: string | number | null | undefined): string {
  const normalizedValue = value === null || value === undefined || value === '' ? 'N/D' : String(value);

  return normalizedValue;
}

export function renderKeyValue(
  label: string,
  value: string | number | null | undefined,
  options: RenderKeyValueOptions = {},
): string {
  const labelWidth = options.labelWidth ?? UI_THEME.table.labelWidth;
  const gap = ' '.repeat(options.gap ?? UI_THEME.table.gap);

  return `${toneText(label.padEnd(labelWidth), 'neutral')}${gap}${normalizeValue(value)}`;
}

export function renderKeyValueRows(
  rows: ReadonlyArray<readonly [string, string | number | null | undefined]>,
  options: RenderKeyValueOptions = {},
): string[] {
  const widestLabel = Math.max(...rows.map(([label]) => label.length), 0);
  const labelWidth = options.labelWidth ?? widestLabel;

  return rows.map(([label, value]) => renderKeyValue(label, value, { ...options, labelWidth }));
}
