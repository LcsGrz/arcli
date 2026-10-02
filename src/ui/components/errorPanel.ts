import { toneText } from '../primitives/text';

import { contentPanel } from './contentPanel';

export function errorPanel(title: string, message: string, details: readonly string[] = [], hint?: string): string {
  const lines = [toneText('Error', 'danger'), message];

  if (details.length > 0) {
    lines.push('', toneText('Detalles', 'info'), ...details);
  }

  if (hint) {
    lines.push('', toneText('Sugerencia', 'warning'), hint);
  }

  return contentPanel(title, lines.join('\n'), 'standard', 'danger', 'left', 'error');
}
