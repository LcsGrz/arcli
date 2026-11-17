import { inlineHtml } from '../lib/markdown.mjs';

/** Un GIF solo en su linea pasa a una figura con marco y, abajo, su texto alternativo como leyenda. */
export function gifs(text) {
  return text.replace(
    /^!\[([^\]]+)\]\(([^)\s]+\.gif)\)$/gm,
    (_, alt, src) =>
      `<figure class="arcli-gif"><img src="${src}" alt="${alt}" loading="lazy"><figcaption>${inlineHtml(alt)}</figcaption></figure>`,
  );
}
