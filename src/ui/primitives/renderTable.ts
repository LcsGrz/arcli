import { UI_THEME } from '../theme/theme';

import { bold } from './text';

export interface RenderTableOptions {
  readonly emphasizeKeys?: boolean;
  readonly gap?: number;
  readonly labelWidth?: number;
}

export function renderTable(rows: ReadonlyArray<readonly [string, string]>, options: RenderTableOptions = {}): string {
  const widestLabel = Math.max(...rows.map(([label]) => label.length), 0);
  const labelWidth = options.labelWidth ?? Math.min(UI_THEME.table.labelWidth, widestLabel);
  const gap = ' '.repeat(options.gap ?? UI_THEME.table.gap);

  return rows
    .map(([label, value]) => {
      const renderedLabel = options.emphasizeKeys === false ? label.padEnd(labelWidth) : bold(label.padEnd(labelWidth));

      return `${renderedLabel}${gap}${value}`;
    })
    .join('\n');
}
