/**
 * Pestañas de las docs (Windows, macOS, Linux...), que arma `scripts/transforms/tabs.mjs`. El clic y el teclado son
 * los de la portada (`lib/tabs.ts`); además, la elección se recuerda por grupo (`data-sync`) en todas las páginas, y
 * en el grupo `so` la primera vez se elige el sistema de quien mira.
 */
import { connectTabs, markSelected, tabsOf } from '../tabs';

const storageKey = (group: string) => `arcli-tab-${group}`;

/** Elige la pestaña `id` en cada bloque del grupo que la tenga. */
function selectTab(group: string, id: string) {
  for (const box of document.querySelectorAll<HTMLElement>(`.arcli-tabs[data-sync="${group}"]`)) {
    const tabs = tabsOf(box);
    const tab = tabs.find((item) => item.dataset.tab === id);
    if (!tab) continue;
    markSelected(tabs, tab);
    for (const panel of box.querySelectorAll<HTMLElement>(':scope > [data-panel]'))
      panel.hidden = panel.dataset.panel !== id;
  }
}

/** El sistema de quien mira, para el grupo `so`. */
function platformTab(): string | null {
  const { platform } = navigator;

  if (/Mac/.test(platform)) return 'macos';
  if (/Win/.test(platform)) return 'windows';

  return /Linux/.test(platform) ? 'linux' : null;
}

export function initTabs() {
  for (const box of document.querySelectorAll<HTMLElement>('.arcli-tabs')) {
    const group = box.dataset.sync ?? '';
    const list = box.querySelector<HTMLElement>(':scope > [role="tablist"]');

    if (list) {
      connectTabs(list, (tab) => {
        const id = tab.dataset.tab ?? '';
        selectTab(group, id);
        try {
          localStorage.setItem(storageKey(group), id);
        } catch {
          // Sin almacenamiento (modo privado): la elección vale solo en esta página.
        }
      });
    }

    let saved: string | null = null;
    try {
      saved = localStorage.getItem(storageKey(group));
    } catch {
      // Sin almacenamiento: queda la primera, o la del sistema.
    }
    saved ??= group === 'so' ? platformTab() : null;
    if (saved) selectTab(group, saved);
  }
}
