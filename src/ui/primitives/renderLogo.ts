import { colorize } from './text';

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

// Columna donde termina "AR" (con el espacio entre letras) y arranca "CLI",
// segun las columnas en blanco de ARCLI_ASCII_BANNER (letras separadas por
// una columna vacia en las 8 filas: 12, 23, 34, 43).
const ARCLI_BANNER_AR_CLI_SPLIT_COLUMN = 23;

function renderLogoWidth(): number {
  return ARCLI_ASCII_BANNER.split('\n')[0]?.length ?? 0;
}

export function renderLogo(): string {
  const logo = ARCLI_ASCII_BANNER.split('\n').map((line) => {
    const ar = line.slice(0, ARCLI_BANNER_AR_CLI_SPLIT_COLUMN);
    const cli = line.slice(ARCLI_BANNER_AR_CLI_SPLIT_COLUMN);

    return `${colorize(ar, 'info')}${colorize(cli, 'neutral')}`;
  });

  const credit = '-LcsGrz'.padStart(renderLogoWidth() - 1);

  return `\n\n${[...logo, credit].join('\n')}\n\n`;
}
