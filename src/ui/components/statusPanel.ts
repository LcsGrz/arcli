import { renderPanel } from '../primitives/renderPanel';
import type { UiTextColor } from '../primitives/text';
import type { UiBorderType, UiWidthPreset } from '../theme/theme';

export function statusPanel(
  title: string,
  rows: readonly string[],
  footer: string,
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
    footerDivider: true,
    padding: {
      bottom: 1,
      left: 2,
      right: 2,
      top: 1,
    },
    title,
    titleColor,
    width,
  });
}
