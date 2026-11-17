/**
 * En el texto corrido, "ARCLI" va en negrita (como en la maqueta); no en titulos, codigo, links ni lineas de HTML.
 * Los bloques de comandos llevan el titulo "Terminal" (expressive-code lo muestra arriba, con "Copiar").
 */
export function markdownTouches(text) {
  return text
    .split(/(^ *```[\s\S]*?^ *```)/m)
    .map((part, index) => {
      if (index % 2 === 1)
        return part.replace(
          /^( *)```(bash|sh|shell|powershell)\n/,
          (_, indent, lang) => `${indent}\`\`\`${lang} title="${lang === 'powershell' ? 'PowerShell' : 'Terminal'}"\n`,
        );

      return part
        .split('\n')
        .map((line) => {
          if (/^\s*(#|<)/.test(line)) return line;

          return line
            .split(/(`[^`]*`|\[[^\]]*\]\([^)]*\))/)
            .map((piece, i) => (i % 2 === 1 ? piece : piece.replace(/(?<![\w*])ARCLI(?![\w*])/g, '**ARCLI**')))
            .join('');
        })
        .join('\n');
    })
    .join('');
}
