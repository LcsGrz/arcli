// Comportamiento de las páginas que arma scripts/sync-docs.mjs. Se carga en todas (astro.config.mjs, `head`).

// "Ver las N" en las tarjetas de opciones: al tocarlo se muestran todas y el botón desaparece.
document.addEventListener('click', (event) => {
  const summary = event.target.closest('details.arcli-more > summary');
  if (!summary) return;
  event.preventDefault();
  const details = summary.parentElement;
  summary.remove();
  details.replaceWith(...details.childNodes);
});

// Problemas frecuentes: el buscador filtra mientras escribís y abre los que coinciden.
document.addEventListener('input', (event) => {
  const input = event.target.closest('.arcli-faq-search input');
  if (!input) return;
  const query = input.value.trim().toLowerCase();
  let shown = 0;

  for (const details of document.querySelectorAll('details.arcli-faq')) {
    const hit = !query || details.textContent.toLowerCase().includes(query);
    details.hidden = !hit;
    details.open = Boolean(query) && hit;
    if (hit) shown += 1;
  }

  for (const section of document.querySelectorAll('.arcli-faq-section')) {
    section.hidden = Boolean(query) && !section.querySelector('details.arcli-faq:not([hidden])');
  }

  const empty = document.querySelector('.arcli-faq-empty');
  if (empty) empty.hidden = shown > 0;
});

// Un link a un problema o a una versión plegada lo abre.
function openTarget() {
  const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target instanceof HTMLDetailsElement) {
    target.open = true;
    target.scrollIntoView();
  }
}

addEventListener('hashchange', openTarget);
document.addEventListener('DOMContentLoaded', openTarget);

// Pestañas (Windows, macOS, Linux...): la elección se recuerda por grupo en todas las páginas.
function selectTab(group, id) {
  for (const tabs of document.querySelectorAll(`.arcli-tabs[data-sync="${group}"]`)) {
    if (!tabs.querySelector(`[data-tab="${id}"]`)) continue;
    for (const button of tabs.querySelectorAll('[data-tab]'))
      button.setAttribute('aria-selected', String(button.dataset.tab === id));
    for (const panel of tabs.querySelectorAll(':scope > [data-panel]')) panel.hidden = panel.dataset.panel !== id;
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('.arcli-tabs [data-tab]');
  if (!button) return;
  const group = button.closest('.arcli-tabs').dataset.sync;
  selectTab(group, button.dataset.tab);
  try {
    localStorage.setItem(`arcli-tab-${group}`, button.dataset.tab);
  } catch {}
});

document.addEventListener('DOMContentLoaded', () => {
  for (const tabs of document.querySelectorAll('.arcli-tabs')) {
    let saved = null;
    try {
      saved = localStorage.getItem(`arcli-tab-${tabs.dataset.sync}`);
    } catch {}
    if (!saved && tabs.dataset.sync === 'so')
      saved = /Mac/.test(navigator.platform)
        ? 'macos'
        : /Win/.test(navigator.platform)
          ? 'windows'
          : /Linux/.test(navigator.platform)
            ? 'linux'
            : null;
    if (saved) selectTab(tabs.dataset.sync, saved);
  }
});
