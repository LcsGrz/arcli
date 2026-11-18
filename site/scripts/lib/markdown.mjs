/** Utilidades de Markdown y HTML que comparten las transformaciones. Funciones puras. */

export const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Markdown en linea (codigo y negrita) a HTML, para lo que va adentro de una tarjeta. */
export const inlineHtml = (text) =>
  escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

/** Celdas de una fila de tabla, con `\|` adentro de una celda. */
export const tableCells = (line) =>
  line
    .replace(/^\|\s*|\s*\|$/g, '')
    .split(/\s*(?<!\\)\|\s*/)
    .map((value) => value.replace(/\\\|/g, '|'));

/** Markdown en linea a texto plano: links, codigo y negrita. */
export const plainText = (text) =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** El ancla de GitHub (y de Astro) de un titulo. */
export const headingSlug = (heading) =>
  heading
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
