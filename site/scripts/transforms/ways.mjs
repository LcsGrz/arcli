import { inlineHtml, tableCells } from '../lib/markdown.mjs';

/**
 * `<!-- arcli: formas -->` y una tabla "Si querés | Escribís | Forma": filas que llevan a cada forma de uso, como en
 * la portada. Va despues de reescribir los links, asi el link de la tercera columna ya apunta al sitio.
 */
export function ways(text) {
  return text.replace(/<!-- arcli: formas -->\n+((?:\|.*\n?)+)/g, (_, table) => {
    const rows = table
      .trim()
      .split('\n')
      .slice(2)
      .map(tableCells)
      .map(([wish, write, way]) => {
        const link = way.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        const said = write.startsWith('"');
        const what = said ? `<q>${inlineHtml(write.replace(/^"|"$/g, ''))}</q>` : inlineHtml(write);

        return `<a class="arcli-way" href="${link?.[2] ?? '#'}"><span class="q">${inlineHtml(wish)}</span><span class="do"><small>${said ? 'Le pedís' : 'Escribís'}</small>${what}</span><span class="go">${inlineHtml(link?.[1] ?? way)} →</span></a>`;
      });

    return `<div class="arcli-ways">${rows.join('')}</div>\n`;
  });
}
