import { usesAsciiBorders } from '../primitives/renderPanel';
import { fitToTerminal } from '../primitives/terminalWidth';
import { bold, colorize, stripAnsi, type UiTextColor } from '../primitives/text';
import { UI_THEME } from '../theme/theme';

/**
 * Barra de una linea con el contexto de la sesion, como la barra de estado de un editor:
 * `━━ TITULO ━━━━━━━━━━━━ estado ━━`. No es una caja: no compite con los paneles de contenido.
 */
/** Ancho de la barra de estado: el preset `wide`, o menos si la terminal es mas angosta. */
export function statusBarWidth(): number {
  return fitToTerminal(UI_THEME.widths.wide.min);
}

export function statusBar(title: string, status: string, statusColor: UiTextColor = 'info'): string {
  const fill = usesAsciiBorders() ? '=' : '━';
  const width = statusBarWidth();
  const left = ` ${bold(title.toUpperCase())} `;
  const right = ` ${colorize(status, statusColor)} `;
  const used = 2 + stripAnsi(left).length + stripAnsi(right).length + 2;
  const middle = Math.max(2, width - used);

  return [
    colorize(fill.repeat(2), 'muted'),
    left,
    colorize(fill.repeat(middle), 'muted'),
    right,
    colorize(fill.repeat(2), 'muted'),
  ].join('');
}
