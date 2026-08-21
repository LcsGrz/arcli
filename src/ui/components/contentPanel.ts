import { renderPanel } from '../primitives/renderPanel';
import type { UiTextColor } from '../primitives/text';
import type { UiWidthPreset } from '../theme/theme';

type ContentPanelAlignment = 'block-center' | 'center' | 'left';

export function contentPanel(
  title: string,
  content: string,
  width: UiWidthPreset = 'wide',
  titleColor?: UiTextColor,
  contentAlign: ContentPanelAlignment = 'left',
): string {
  return renderPanel({
    content,
    contentAlign,
    title,
    titleColor,
    width,
  });
}
