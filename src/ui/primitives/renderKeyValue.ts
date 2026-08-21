import { UI_THEME, type UiWidthPreset } from '../theme/theme';

import { toneText } from './text';

export interface RenderKeyValueOptions {
  readonly gap?: number;
  readonly labelWidth?: number;
}

export function resolveBalancedKeyValueLabelWidth(widthPreset: UiWidthPreset): number {
  const panelWidth = UI_THEME.widths[widthPreset].max;
  const innerWidth =
    panelWidth - (UI_THEME.spacing.panelPadding.left ?? 0) - (UI_THEME.spacing.panelPadding.right ?? 0) - 2;

  return Math.max(0, Math.floor((innerWidth - UI_THEME.table.gap) / 2));
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
