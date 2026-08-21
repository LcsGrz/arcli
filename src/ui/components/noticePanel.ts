import { renderPanel } from '../primitives/renderPanel';
import { toneText, type UiTextColor } from '../primitives/text';
import type { UiBorderType } from '../theme/theme';

export function noticePanel(message: string, color: UiTextColor = 'info', borderType: UiBorderType = 'note'): string {
  return renderPanel({
    borderType,
    content: toneText(message, color),
    contentAlign: 'center',
    width: 'compact',
  });
}
