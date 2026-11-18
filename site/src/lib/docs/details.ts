/**
 * Los desplegables de las docs: "Ver las N" de las tarjetas de opciones (`scripts/transforms/option-cards.mjs`) y abrir
 * el problema o la versión a la que lleva un link (`#ancla`).
 */

/**
 * "Ver las N": al tocarlo se muestran todas y el botón desaparece. El foco pasa a la primera que estaba escondida, así
 * con teclado o lector de pantalla se sigue desde ahí y no se vuelve al principio de la página.
 */
export function initShowMore() {
  document.addEventListener('click', (event) => {
    const summary = (event.target as Element | null)?.closest('details.arcli-more > summary');
    const details = summary?.parentElement;
    if (!summary || !details) return;
    event.preventDefault();
    summary.remove();
    const first = details.firstElementChild as HTMLElement | null;
    details.replaceWith(...details.childNodes);
    if (first) {
      first.tabIndex = -1;
      first.focus({ preventScroll: true });
    }
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
