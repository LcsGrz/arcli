/**
 * Las imagenes llevan su ancho y alto, asi el navegador les reserva el lugar antes de cargarlas y el texto no salta.
 * Mientras cargan se ve un fondo gris (styles/docs/contenido.css). `imageSize(url)` devuelve `{ width, height }` o `null`.
 */
export function sizedImages(text, { imageSize }) {
  return text
    .replace(/!\[([^\]]*)\]\(([^)\s]+\.(?:png|gif))\)/g, (match, alt, src) => {
      const size = imageSize(src);

      return size
        ? `<img src="${src}" alt="${alt}" width="${size.width}" height="${size.height}" loading="lazy" decoding="async">`
        : match;
    })
    .replace(/<img src="([^"]+\.(?:png|gif))"([^>]*)>/g, (match, src, rest) => {
      if (/\bheight=/.test(rest)) return match;
      const size = imageSize(src);
      if (!size) return match;
      const width = Number(rest.match(/\bwidth="(\d+)"/)?.[1] ?? size.width);
      const sized = /\bwidth=/.test(rest) ? rest : `${rest} width="${width}"`;

      return `<img src="${src}"${sized} height="${Math.round((width * size.height) / size.width)}">`;
    });
}
