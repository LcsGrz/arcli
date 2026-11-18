/**
 * La familia de los comprobantes ("Monotributo · C"): sale del `familia` de cada página y del nombre de los grupos del
 * menú (los arma scripts/sync-docs.mjs). La letra lleva siempre el mismo color, en el título y en el menú.
 */

const FAMILY_LABEL = /^(.+) · ([A-Z])$/;

/** El color de cada letra, para el `--chip` de `Chip.astro`. */
const LETTER_COLORS: Record<string, string> = {
  A: 'var(--arcli-celeste)',
  B: 'var(--arcli-lavanda)',
  C: 'var(--arcli-verde)',
  E: 'var(--arcli-sol)',
};

/** "Monotributo · C" -> { color, letter: "C", name: "Monotributo" }; sin letra, `null`. */
export function parseFamily(label: string | undefined) {
  const match = label?.match(FAMILY_LABEL);

  return match ? { color: LETTER_COLORS[match[2]], letter: match[2], name: match[1] } : null;
}
