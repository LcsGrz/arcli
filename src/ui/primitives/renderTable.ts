import { UI_THEME } from '../theme/theme';

import { bold } from './text';

export interface RenderTableOptions {
  readonly labelWidth?: number;
}

export function renderTable(rows: ReadonlyArray<readonly [string, string]>, options: RenderTableOptions = {}): string {
  const widestLabel = Math.max(...rows.map(([label]) => label.length), 0);
  const labelWidth = options.labelWidth ?? Math.min(UI_THEME.table.labelWidth, widestLabel);
  const gap = ' '.repeat(UI_THEME.table.gap);

  return rows
    .map(([label, value]) => {
      return `${bold(label.padEnd(labelWidth))}${gap}${value}`;
    })
    .join('\n');
}
