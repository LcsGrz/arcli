import { inlineHtml } from '../lib/markdown.mjs';

/**
 * `<!-- arcli: muestra=error|vista -->` y un bloque de texto: un cartel chico, como el que se ve en la terminal. La
 * primera linea es el titulo; en las demas, dos o mas espacios separan etiqueta y valor.
 */
export function samples(text) {
  return text.replace(/<!-- arcli: muestra=(error|vista) -->\n+```text\n([\s\S]*?)\n```\n?/g, (_, kind, block) => {
    const [title, ...lines] = block.split('\n');
    const row = (line) => {
      const [label, value] = line.split(/\s{2,}/);

      return value
        ? `<span class="row"><span>${inlineHtml(label)}</span><i>${inlineHtml(value)}</i></span>`
        : `<span>${inlineHtml(line)}</span>`;
    };

    return `<div class="arcli-block"><div class="arcli-sample arcli-sample-${kind}"><b>${inlineHtml(title)}</b>${lines.map(row).join('')}</div></div>\n`;
  });
}
