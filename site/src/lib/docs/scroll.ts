/**
 * Las tablas anchas se desplazan de costado en el celular (`styles/docs/contenido.css`). Mientras se desplazan entran
 * con Tab, así con teclado también se pueden mover con las flechas; si entran enteras, no.
 */
export function initScrollableTables() {
  const mark = () => {
    for (const table of document.querySelectorAll<HTMLElement>('.sl-markdown-content table')) {
      if (table.scrollWidth > table.clientWidth) table.tabIndex = 0;
      else table.removeAttribute('tabindex');
    }
  };

  mark();
  addEventListener('resize', mark);
}
