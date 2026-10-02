import { renderPanel } from '../primitives/renderPanel';
import type { UiTextColor } from '../primitives/text';
import type { UiBorderType, UiWidthPreset } from '../theme/theme';

export function keyValuePanel(
  title: string,
  rows: readonly string[],
  footer?: string,
  width: UiWidthPreset = 'standard',
  titleColor?: UiTextColor,
  borderType: UiBorderType = 'common',
): string {
  return renderPanel({
    borderType,
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
