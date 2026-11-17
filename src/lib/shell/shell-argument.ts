/** Comillas solo cuando hacen falta, para que un comando armado se pueda pegar en bash, zsh o fish. */
export function quoteShellArgument(value: string): string {
  return /^[\w./:,-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}
