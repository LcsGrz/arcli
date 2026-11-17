/** `<!-- arcli: atajos -->` y la tabla siguiente: la grilla de atajos por letra, con las letras centradas. */
export function shortcutGrids(text) {
  return text.replace(
    /<!-- arcli: atajos -->\n+((?:\|.*\n?)+)/g,
    (_, table) => `<div class="arcli-atajos">\n\n${table.trim()}\n\n</div>\n`,
  );
}
