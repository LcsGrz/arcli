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
