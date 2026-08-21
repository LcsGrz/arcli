import { centerLines, colorize, type UiTextColor } from './text';

export const ARCLI_ASCII_BANNER = [
  '       d8888 8888888b.   .d8888b.  888      8888888 ',
  '      d88888 888   Y88b d88P  Y88b 888        888   ',
  '     d88P888 888    888 888    888 888        888   ',
  '    d88P 888 888   d88P 888        888        888   ',
  '   d88P  888 8888888P"  888        888        888   ',
  '  d88P   888 888 T88b   888    888 888        888   ',
  ' d8888888888 888  T88b  Y88b  d88P 888        888   ',
  'd88P     888 888   T88b  "Y8888P"  88888888 8888888 ',
].join('\n');

export interface RenderLogoOptions {
  readonly align?: 'center' | 'left';
  readonly color?: UiTextColor;
  readonly width?: number;
}

export function renderLogo(options: RenderLogoOptions = {}): string {
  const lines = ARCLI_ASCII_BANNER.split('\n').map((line) => (options.color ? colorize(line, options.color) : line));

  if (options.align === 'center' && options.width) {
    return centerLines(lines, options.width).join('\n');
  }

  return lines.join('\n');
}
