/** Problemas frecuentes (`scripts/transforms/problems.mjs`): el buscador filtra mientras escribís y abre los que coinciden. */
export function initProblemSearch() {
  document.addEventListener('input', (event) => {
    const input = (event.target as Element | null)?.closest<HTMLInputElement>('.arcli-faq-search input');
    if (!input) return;
    const query = input.value.trim().toLowerCase();
    let shown = 0;

    for (const details of document.querySelectorAll<HTMLDetailsElement>('details.arcli-faq')) {
      const hit = !query || (details.textContent ?? '').toLowerCase().includes(query);
      details.hidden = !hit;
      details.open = Boolean(query) && hit;
      if (hit) shown += 1;
    }

    for (const section of document.querySelectorAll<HTMLElement>('.arcli-faq-section')) {
      section.hidden = Boolean(query) && !section.querySelector('details.arcli-faq:not([hidden])');
    }

    const empty = document.querySelector<HTMLElement>('.arcli-faq-empty');
    if (empty) empty.hidden = shown > 0;
  });
}
