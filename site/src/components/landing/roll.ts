/**
 * El nombre de la IA que va rotando (Claude, ChatGPT...) en la nota de instalación y en el chat de la demo
 * (`Roll.astro`). Cada 1,5 s sube un nombre; al llegar a la copia del primero vuelve al principio sin animar.
 */
import { AI_NAMES } from '../../data/landing';

let aiIndex = 0;

/** Pone cada `.ai-roll` de `scope` en el nombre de ahora, con su ancho; `animate` anima el cambio. */
export function syncRolls(scope: ParentNode, animate: boolean) {
  for (const roll of scope.querySelectorAll<HTMLElement>('.ai-roll')) {
    const track = roll.firstElementChild as HTMLElement;
    track.style.transition = animate ? 'transform 0.28s cubic-bezier(0.3, 1.3, 0.5, 1)' : 'none';
    track.style.transform = `translateY(-${aiIndex * 1.3}em)`;
    const width = track.children[aiIndex]?.getBoundingClientRect().width;
    if (width) roll.style.width = `${width}px`;
  }
}

/** Arranca la rotación de los nombres de `root`, salvo con movimiento reducido. */
export function startRolls(root: HTMLElement) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  setInterval(() => {
    aiIndex += 1;
    syncRolls(root, true);
    if (aiIndex === AI_NAMES.length) {
      setTimeout(() => {
        aiIndex = 0;
        syncRolls(root, false);
      }, 320);
    }
  }, 1500);
}
