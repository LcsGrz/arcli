import type { Options as BoxenOptions, Spacing as BoxenSpacing } from 'boxen';

export type UiBorderType = 'arrow' | 'common' | 'debug' | 'note';
export type UiColorToken = 'danger' | 'debug' | 'info' | 'muted' | 'neutral' | 'success' | 'warning';
export type UiWidthPreset = 'compact' | 'standard' | 'wide';
export interface UiWidthRange {
  readonly max: number;
  readonly min: number;
}

export interface UiTheme {
  readonly badgeBrackets: readonly [left: string, right: string];
  readonly borderStyles: Readonly<Record<UiBorderType, BoxenOptions['borderStyle']>>;
  readonly colors: Readonly<Record<UiColorToken, string>>;
  readonly headingLineMinWidth: number;
  readonly spacing: {
    readonly gaps: {
      readonly section: number;
      readonly block: number;
    };
    readonly panelPadding: BoxenSpacing;
  };
  readonly table: {
    readonly gap: number;
    readonly labelWidth: number;
  };
  readonly widths: Readonly<Record<UiWidthPreset, UiWidthRange>>;
}

export const UI_THEME: UiTheme = {
  badgeBrackets: ['[', ']'],
  borderStyles: {
    arrow: 'arrow',
    common: 'doubleSingle',
    debug: 'single',
    note: 'classic',
  },
  colors: {
    danger: '\u001B[31m',
    debug: '\u001B[95m',
    info: '\u001B[36m',
    muted: '\u001B[2m',
    neutral: '\u001B[37m',
    success: '\u001B[32m',
    warning: '\u001B[33m',
  },
  headingLineMinWidth: 18,
  spacing: {
    gaps: {
      block: 1,
      section: 2,
    },
    panelPadding: {
      top: 1,
      right: 2,
      bottom: 1,
      left: 2,
    },
  },
  table: {
    gap: 2,
    labelWidth: 30,
  },
  widths: {
    compact: { min: 68, max: 80 },
    standard: { min: 80, max: 100 },
    wide: { min: 92, max: 116 },
  },
};
