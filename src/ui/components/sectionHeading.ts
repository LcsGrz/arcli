import { usesAsciiBorders } from '../primitives/renderPanel';
import { fitToTerminal } from '../primitives/terminalWidth';
import { bold, colorize, stripAnsi, type UiTextColor } from '../primitives/text';
import { UI_THEME } from '../theme/theme';

/** Titulo de seccion de una linea (`── TITULO ─────`), para agrupar contenido sin encerrarlo en una caja. */
export function sectionHeading(title: string, color?: UiTextColor): string {
  const fill = usesAsciiBorders() ? '-' : '─';
  const width = fitToTerminal(UI_THEME.widths.standard.min);
  const label = ` ${bold(color ? colorize(title.toUpperCase(), color) : title.toUpperCase())} `;
  const rest = Math.max(2, width - 2 - stripAnsi(label).length);

  return `${colorize(fill.repeat(2), 'muted')}${label}${colorize(fill.repeat(rest), 'muted')}`;
}
