import boxen, { type Options as BoxenOptions, type Spacing as BoxenSpacing } from 'boxen';

import { UI_THEME, type UiBorderType, type UiWidthPreset } from '../theme/theme';

import { renderDivider } from './renderDivider';
import { renderFooter } from './renderFooter';
import { renderSubtitle } from './renderSubtitle';
import {
  bold,
  centerLineBlock,
  centerLines,
  flattenVisibleLines,
  maxVisibleWidth,
  type UiTextColor,
  wrapIndentedPlainText,
} from './text';

type PanelAlignment = 'block-center' | 'center' | 'left';

export interface RenderPanelProps {
  readonly borderColor?: BoxenOptions['borderColor'];
  readonly borderType?: UiBorderType;
  readonly content: string | readonly string[];
  readonly contentAlign?: PanelAlignment;
  readonly footer?: string;
  readonly footerColor?: UiTextColor;
  readonly footerDivider?: boolean | string;
  readonly maxWidth?: UiWidthPreset | number;
  readonly padding?: Partial<BoxenSpacing>;
  readonly subtitle?: string;
  readonly subtitleColor?: UiTextColor;
  readonly title?: string;
  readonly titleAlignment?: BoxenOptions['titleAlignment'];
  readonly titleColor?: UiTextColor;
  readonly width?: UiWidthPreset | number;
}

function resolvePadding(padding?: Partial<BoxenSpacing>): BoxenSpacing {
  const base = UI_THEME.spacing.panelPadding;

  return {
    bottom: padding?.bottom ?? base.bottom ?? 0,
    left: padding?.left ?? base.left ?? 0,
    right: padding?.right ?? base.right ?? 0,
    top: padding?.top ?? base.top ?? 0,
  };
}

function resolveWidth(width: RenderPanelProps['width']): number {
  if (typeof width === 'number') {
    return width;
  }

  return UI_THEME.widths[width ?? 'standard'].min;
}

function resolveMaxWidth(width: RenderPanelProps['maxWidth']): number | null {
  if (width === undefined) {
    return null;
  }

  if (typeof width === 'number') {
    return width;
  }

  return UI_THEME.widths[width].max;
}

function alignLines(lines: readonly string[], width: number, align: PanelAlignment): string[] {
  if (align === 'left') {
    return flattenVisibleLines(lines);
  }

  if (align === 'block-center') {
    return centerLineBlock(lines, width);
  }

  return centerLines(lines, width);
}

function formatTitle(title: string | undefined, color: UiTextColor | undefined): string | undefined {
  if (!title) {
    return undefined;
  }

  const normalizedTitle = bold(title.toUpperCase());

  if (!color) {
    return normalizedTitle;
  }

  return normalizedTitle;
}

export function renderPanel(props: RenderPanelProps): string {
  const padding = resolvePadding(props.padding);
  const paddingLeft = padding.left ?? 0;
  const paddingRight = padding.right ?? 0;
  const minimumWidth = resolveWidth(props.width);
  const configuredMaxWidth =
    props.maxWidth === undefined
      ? typeof props.width === 'number'
        ? null
        : UI_THEME.widths[props.width ?? 'standard'].max
      : resolveMaxWidth(props.maxWidth);
  const maximumWidth =
    configuredMaxWidth === null ? Number.POSITIVE_INFINITY : Math.max(minimumWidth, configuredMaxWidth);
  const contentLines = typeof props.content === 'string' ? props.content.split('\n') : [...props.content];
  const visibleLines = [...contentLines];
  const calculatedWidth = maxVisibleWidth(visibleLines) + paddingLeft + paddingRight + 2;
  const panelWidth = Math.min(maximumWidth, Math.max(minimumWidth, calculatedWidth));
  const innerWidth = Math.max(0, panelWidth - paddingLeft - paddingRight - 2);
  const footerDivider = props.footerDivider === undefined ? false : props.footerDivider;
  const footerDividerLine = footerDivider
    ? renderDivider({ character: typeof footerDivider === 'string' ? footerDivider : '═', width: innerWidth })
    : null;
  const footerLine = props.footer
    ? renderFooter({
        text: props.footer,
        textColor: props.footerColor,
        width: innerWidth,
      })
    : null;

  const wrappedContentLines = contentLines.flatMap((line) => wrapIndentedPlainText(line, innerWidth));
  const lines: string[] = [];
  const hasBodyContent = contentLines.length > 0;
  const hasFooter = Boolean(footerLine);
  const hasFooterDivider = Boolean(footerDividerLine);

  if (props.subtitle) {
    lines.push(
      ...renderSubtitle({
        text: props.subtitle,
        textColor: props.subtitleColor,
        width: innerWidth,
      }),
    );

    if (hasBodyContent || hasFooter || hasFooterDivider) {
      lines.push('');
    }
  }

  if (hasBodyContent) {
    lines.push(...alignLines(wrappedContentLines, innerWidth, props.contentAlign ?? 'left'));
  }

  if (footerDividerLine) {
    lines.push(
      '',
      renderDivider({ character: typeof footerDivider === 'string' ? footerDivider : '═', width: innerWidth }),
    );
  }

  if (footerLine) {
    lines.push(
      '',
      renderFooter({
        text: props.footer ?? '',
        textColor: props.footerColor,
        width: innerWidth,
      }),
    );
  }

  return boxen(lines.join('\n'), {
    borderColor: props.borderColor,
    borderStyle: UI_THEME.borderStyles[props.borderType ?? 'common'],
    padding,
    title: formatTitle(props.title, props.titleColor),
    titleAlignment: props.titleAlignment ?? 'center',
    width: panelWidth,
  });
}
