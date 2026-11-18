/**
 * `<!-- arcli: familia="…" icono="…" orden="…" -->`: la familia ("Monotributo · C") va al frontmatter, para el chip
 * arriba del titulo, y la marca se saca del cuerpo.
 */
export function voucherMeta(text) {
  const meta = text.match(/<!-- arcli: familia="([^"]+)"[^>]*-->\n*/);

  return meta ? { body: text.replace(meta[0], ''), familia: meta[1] } : { body: text, familia: null };
}
