/**
 * Texto con formato de la portada (`data/landing.ts`), sin HTML: `Rich.astro` lo dibuja.
 *
 * - `ARCLI` suelto: la marca (`<strong class="brand-word">`).
 * - `**texto**`: negrita (`<strong>`), sin marca adentro.
 * - `[texto](ruta/)`: link a una página del sitio.
 * - `{ia}`: el nombre de la IA que va rotando (Claude, ChatGPT...).
 */
export type RichPart =
  | { readonly href: string; readonly kind: 'link'; readonly text: string }
  | { readonly kind: 'ai' }
  | { readonly kind: 'brand' }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'text'; readonly text: string };

const TOKEN = /\*\*(.+?)\*\*|\[(.+?)\]\((.+?)\)|\{ia\}|\bARCLI\b/g;

export function parseRich(source: string): RichPart[] {
  const parts: RichPart[] = [];
  let last = 0;

  for (const match of source.matchAll(TOKEN)) {
    if (match.index > last) parts.push({ kind: 'text', text: source.slice(last, match.index) });
    const [token, strong, linkText, href] = match;
    if (strong !== undefined) parts.push({ kind: 'strong', text: strong });
    else if (linkText !== undefined && href !== undefined) parts.push({ href, kind: 'link', text: linkText });
    else parts.push(token === '{ia}' ? { kind: 'ai' } : { kind: 'brand' });
    last = match.index + token.length;
  }

  if (last < source.length) parts.push({ kind: 'text', text: source.slice(last) });

  return parts;
}

/** Un comando de `Snippet.astro` en partes: las flags (`-m`, `--cs`) seguidas van juntas, el resto es texto. */
export function commandParts(cmd: string): { flag: boolean; text: string }[] {
  const parts: { flag: boolean; text: string }[] = [];

  for (const [index, word] of cmd.split(' ').entries()) {
    const flag = word.startsWith('-');
    const previous = parts.at(-1);
    const separator = index === 0 ? '' : ' ';
    if (previous && previous.flag === flag) previous.text += separator + word;
    else if (previous) {
      // El espacio entre una parte y la otra va en la que no es flag, como en el HTML original.
      if (flag) previous.text += separator;
      parts.push({ flag, text: flag ? word : separator + word });
    } else parts.push({ flag, text: word });
  }

  return parts;
}
