import { toWebp } from '../lib/images.mjs';

/**
 * Las imagenes llevan su ancho y alto, asi el navegador les reserva el lugar antes de cargarlas y el texto no salta.
 * Mientras cargan se ve un fondo gris (styles/docs/contenido.css). `imageSize(url)` devuelve `{ width, height }` o `null`.
 * Las que se pueden medir son de `docs/assets` y pasan a su WebP (ver `toWebp`).
 */
export function sizedImages(text, { imageSize }) {
  return text
    .replace(/!\[([^\]]*)\]\(([^)\s]+\.(?:png|gif|webp))\)/g, (match, alt, src) => {
      const size = imageSize(src);

      return size
        ? `<img src="${toWebp(src)}" alt="${alt}" width="${size.width}" height="${size.height}" loading="lazy" decoding="async">`
        : match;
    })
    .replace(/<img src="([^"]+\.(?:png|gif|webp))"([^>]*)>/g, (match, src, rest) => {
      const size = imageSize(src);
      if (!size) return match;
      if (/\bheight=/.test(rest)) return `<img src="${toWebp(src)}"${rest}>`;
      const width = Number(rest.match(/\bwidth="(\d+)"/)?.[1] ?? size.width);
      const sized = /\bwidth=/.test(rest) ? rest : `${rest} width="${width}"`;

      return `<img src="${toWebp(src)}"${sized} height="${Math.round((width * size.height) / size.width)}">`;
    });
}
