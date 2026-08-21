import { centerText } from './text';

export interface RenderDividerProps {
  readonly character?: string;
  readonly width: number;
}

export function renderDivider(props: RenderDividerProps): string {
  return centerText((props.character ?? '═').repeat(props.width), props.width);
}
