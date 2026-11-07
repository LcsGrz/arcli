import { UI_THEME, type UiSymbolName } from '../theme/theme';

/** ARCLI_ASCII=1 cambia bordes y simbolos por ASCII puro, para terminales sin esos caracteres. */
export function usesAsciiBorders(): boolean {
  const value = process.env.ARCLI_ASCII?.trim().toLowerCase();

  return value === '1' || value === 'true' || value === 'si';
}

/** El simbolo del tema: nunca a mano en un presenter, para que ARCLI_ASCII=1 lo pueda cambiar. */
export function uiSymbol(name: UiSymbolName): string {
  const { ascii, unicode } = UI_THEME.symbols[name];

  return usesAsciiBorders() ? ascii : unicode;
}
