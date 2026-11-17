import { plainText } from '../lib/markdown.mjs';

/** Largo maximo de la descripcion: lo que muestran los buscadores sin cortarla. */
export const DESCRIPTION_MAX = 160;

/**
 * La descripcion de la pagina (`<meta name="description">` y `og:description`): la de `PAGES` o, si no tiene, las
 * oraciones enteras del primer parrafo de la introduccion que entran en DESCRIPTION_MAX. En un comprobante, antes va
 * "Cómo emitir una Factura A con ARCLI.", porque su introduccion no lo nombra. Falla si queda vacia o larga.
 */
export function pageDescription(page, title, body) {
  const intro = body.split(/\n{2,}/).find((part) => /^[\p{L}¿¡`*[]/u.test(part.trim()) && !/^\*\s/.test(part));
  const article = /^Recibo/.test(title) ? 'un' : 'una';
  const lead = page.voucher ? `Cómo emitir ${article} ${title} con ARCLI. ` : '';
  let description = plainText(page.description ?? '');

  if (!description && intro) {
    for (const sentence of plainText(intro).split(/(?<=[.!?])\s+/)) {
      const next = `${description} ${sentence}`.trim();

      if (`${lead}${next}`.length > DESCRIPTION_MAX) break;
      description = next;
    }

    description = `${lead}${description}`.trim();
  }

  if (!description || description === lead.trim()) {
    throw new Error(`${page.src}: la página queda sin descripción. Declarala en PAGES (site/scripts/pages.mjs).`);
  }

  if (description.length > DESCRIPTION_MAX) {
    throw new Error(`${page.src}: la descripción pasa de ${DESCRIPTION_MAX} caracteres (${description.length}).`);
  }

  return description;
}
