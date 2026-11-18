import { inlineHtml, tableCells } from '../lib/markdown.mjs';

/**
 * En `docs/comprobantes/`, cada `### Opción` (texto, tabla Largo | Corto | Qué es y `Ej.:`) despues de
 * `<!-- arcli: opciones=req|opt|run -->` pasa a una tarjeta: barra celeste lo obligatorio, lavanda lo opcional y gris lo
 * de ejecucion. Mas de 5 filas: se ven 4 y "Ver las N" muestra el resto.
 */
export function optionCards(text) {
  return text.replace(/<!-- arcli: opciones=(req|opt|run) -->\n([\s\S]*?)(?=\n## |$)/g, (_, kind, block) => {
    const cards = block
      .split(/^### /m)
      .slice(1)
      .map((chunk) => {
        const lines = chunk.trim().split('\n');
        const name = lines.shift();
        const prose = lines.filter((line) => line && !line.startsWith('|') && !line.startsWith('Ej.:')).join(' ');
        const rows = lines
          .filter((line) => line.startsWith('|'))
          .slice(2)
          .map(tableCells);
        const ej = lines.find((line) => line.startsWith('Ej.:'))?.replace(/^Ej\.:\s*/, '') ?? '';
        const row = ([long, short, what]) =>
          `<div class="arcli-opt-row"><span class="l">${inlineHtml(long)}</span><span class="s">${inlineHtml(short)}</span><span class="w">${inlineHtml(what)}</span></div>`;
        const shown = rows.length > 5 ? rows.slice(0, 4) : rows;
        const rest =
          rows.length > 5
            ? `<details class="arcli-more"><summary>Ver las ${rows.length}</summary>${rows.slice(4).map(row).join('')}</details>`
            : '';

        return `<div class="arcli-opt arcli-opt-${kind}"><div class="arcli-opt-top"><b>${inlineHtml(name)}</b>${ej ? `<span class="arcli-ej">Ej.: ${inlineHtml(ej)}</span>` : ''}</div>${prose ? `<p>${inlineHtml(prose)}</p>` : ''}<div class="arcli-opt-rows">${shown.map(row).join('')}${rest}</div></div>`;
      });

    return `<div class="arcli-opts">${cards.join('')}</div>\n`;
  });
}
