import { centerText, colorize, type UiTextColor, wrapPlainText } from './text';

export interface RenderSubtitleProps {
  readonly text: string;
  readonly textColor?: UiTextColor;
  readonly width: number;
}

export function renderSubtitle(props: RenderSubtitleProps): string[] {
  const color = props.textColor ?? 'muted';

  return wrapPlainText(props.text, props.width).map((line) => centerText(colorize(line, color), props.width));
}
