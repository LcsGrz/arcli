import { centerText, colorize, type UiTextColor } from './text';

export interface RenderFooterProps {
  readonly text: string;
  readonly textColor?: UiTextColor;
  readonly width: number;
}

export function renderFooter(props: RenderFooterProps): string {
  const color = props.textColor ?? 'neutral';

  return centerText(colorize(props.text, color), props.width);
}
