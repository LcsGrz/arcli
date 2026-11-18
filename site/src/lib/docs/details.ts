/**
 * Los desplegables de las docs: "Ver las N" de las tarjetas de opciones (`scripts/transforms/option-cards.mjs`) y abrir
 * el problema o la versión a la que lleva un link (`#ancla`).
 */

/** "Ver las N": al tocarlo se muestran todas y el botón desaparece. */
export function initShowMore() {
  document.addEventListener('click', (event) => {
    const summary = (event.target as Element | null)?.closest('details.arcli-more > summary');
    const details = summary?.parentElement;
    if (!summary || !details) return;
    event.preventDefault();
    summary.remove();
    details.replaceWith(...details.childNodes);
  });
}

/** Un link a un problema o a una versión plegada lo abre. */
function openTarget() {
  const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target instanceof HTMLDetailsElement) {
    target.open = true;
    target.scrollIntoView();
  }
}

export function initOpenTarget() {
  addEventListener('hashchange', openTarget);
  openTarget();
}
