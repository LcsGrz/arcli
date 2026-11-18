/** Sin comillas: lo que ninguna shell interpreta. `\w` es solo ASCII, así que `ñ` o `é` van entre comillas. */
const POSIX_SAFE_ARGUMENT = /^[\w./:,-]+$/;
// En PowerShell una coma sin comillas arma un array: `1500,50` le llegaría al CLI partido.
const POWERSHELL_SAFE_ARGUMENT = /^[\w./:-]+$/;
// PowerShell toma también las comillas tipográficas como simples: se duplican igual que `'`.
const POWERSHELL_SINGLE_QUOTES = /['‘’‚‛]/g;

/**
 * Comillas solo cuando hacen falta, para que un comando armado se pueda pegar tal cual. Son simples porque adentro
 * nada se expande (`!`, `$`, backtick): en bash, zsh y fish la `'` se escribe `'\''`; en Windows (PowerShell), `''`.
 * La plataforma se puede pasar para probar las dos sin depender del SO.
 */
export function quoteShellArgument(value: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    return POWERSHELL_SAFE_ARGUMENT.test(value) ? value : `'${value.replace(POWERSHELL_SINGLE_QUOTES, '$&$&')}'`;
  }

  return POSIX_SAFE_ARGUMENT.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Une los argumentos en un comando para pegar en la terminal, con comillas solo donde hacen falta. */
export function formatShellCommand(args: readonly string[], platform: NodeJS.Platform = process.platform): string {
  return args.map((arg) => quoteShellArgument(arg, platform)).join(' ');
}
