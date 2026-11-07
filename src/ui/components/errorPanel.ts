import { toneText } from '../primitives/text';

import { contentPanel } from './contentPanel';

export function errorPanel(title: string, message: string, details: readonly string[] = [], hint?: string): string {
  // El titulo ya dice que es un error: arriba de todo va el mensaje.
  const lines = [message];

  if (details.length > 0) {
    lines.push('', toneText('Detalles', 'info'), ...details);
  }

  if (hint) {
    lines.push('', toneText('Sugerencia', 'warning'), hint);
  }

  return contentPanel(title, lines.join('\n'), 'standard', 'danger', 'left', 'error');
}
