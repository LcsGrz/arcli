/**
 * Problemas frecuentes (`scripts/transforms/problems.mjs`): el buscador filtra mientras escribís y abre los que
 * coinciden. Cuántos quedan se avisa en `.arcli-faq-status` (`role="status"`), que el lector de pantalla lee sin mover
 * el foco del buscador.
 */
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

    const status = document.querySelector<HTMLElement>('.arcli-faq-status');
    if (status) status.textContent = problemsStatus(query, shown, empty?.textContent ?? '');
  });
}

/** Lo que lee el lector de pantalla después de cada búsqueda; sin búsqueda, nada. */
export function problemsStatus(query: string, shown: number, emptyText: string): string {
  if (!query) return '';
  if (shown === 0) return emptyText;

  return shown === 1 ? '1 problema encontrado.' : `${shown} problemas encontrados.`;
}
