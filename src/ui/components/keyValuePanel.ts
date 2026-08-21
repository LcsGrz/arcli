import { renderPanel } from '../primitives/renderPanel';
import type { UiTextColor } from '../primitives/text';
import type { UiWidthPreset } from '../theme/theme';

export function keyValuePanel(
  title: string,
  rows: readonly string[],
  footer?: string,
  width: UiWidthPreset = 'standard',
  titleColor?: UiTextColor,
): string {
  return renderPanel({
    content: rows,
    contentAlign: 'left',
    footer,
    footerColor: titleColor,
    footerDivider: Boolean(footer),
    title,
    titleColor,
    width,
  });
}
