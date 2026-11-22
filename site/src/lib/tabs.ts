/**
 * Pestañas accesibles, las mismas en la portada (`components/landing/Tabs.astro`) y en las docs (`lib/docs/tabs.ts`):
 * botones `role="tab"` en un `role="tablist"`, con la elegida en `aria-selected` y como la única que entra con Tab
 * (`tabindex`). Con el teclado, como en cualquier tablist, las flechas, Inicio y Fin cambian de pestaña y le pasan el
 * foco. El foco visible es el del CSS de cada lado.
 */

/** Las flechas, Inicio y Fin: el índice de la pestaña a la que se pasa. */
const KEYS: Record<string, (index: number, count: number) => number> = {
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  ArrowRight: (index, count) => (index + 1) % count,
  End: (_index, count) => count - 1,
  Home: () => 0,
};

/** La pestaña a la que lleva una tecla desde `index`, o `null` si la tecla no mueve. */
export function tabForKey(key: string, index: number, count: number): number | null {
  const move = KEYS[key];

  return move ? move(index, count) : null;
}

/** Las pestañas de una lista. */
export const tabsOf = (list: ParentNode) => [...list.querySelectorAll<HTMLElement>('[role="tab"]')];

/** Marca `tab` como la elegida de su lista: `aria-selected` y la única con `tabindex` 0. */
export function markSelected(tabs: readonly HTMLElement[], tab: HTMLElement) {
  for (const other of tabs) {
    other.setAttribute('aria-selected', String(other === tab));
    other.tabIndex = other === tab ? 0 : -1;
  }
}

/** Conecta el clic y el teclado de una lista: `select` recibe la pestaña elegida (ya pasó el foco si fue con teclas). */
export function connectTabs(list: ParentNode, select: (tab: HTMLElement) => void) {
  const tabs = tabsOf(list);

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      const target = tabForKey(event.key, index, tabs.length);
      const next = target === null ? undefined : tabs[target];
      if (!next) return;
      event.preventDefault();
      select(next);
      next.focus();
    });
  }
}
