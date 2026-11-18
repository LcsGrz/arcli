/**
 * El pipeline de una pagina, en orden: de Markdown de `docs/` (sin el `#`, ver `lib/body.mjs`) al Markdown del sitio.
 * Cada paso es `(texto, ctx) => texto`, con `ctx = { aliases, bySource, imageSize, page, readmePrompt }`; asi se
 * prueban sin leer archivos.
 */
import { githubAlertsToAsides } from './alerts.mjs';
import { chats } from './chats.mjs';
import { argentineVersionDates } from './dates.mjs';
import { gifs } from './gifs.mjs';
import { installPrompt } from './install-prompt.mjs';
import { rewriteLinks } from './links.mjs';
import { markdownTouches } from './markdown-touches.mjs';
import { optionCards } from './option-cards.mjs';
import { problems } from './problems.mjs';
import { releases } from './releases.mjs';
import { samples } from './samples.mjs';
import { shortcutGrids } from './shortcut-grids.mjs';
import { sizedImages } from './sized-images.mjs';
import { steps } from './steps.mjs';
import { tabs } from './tabs.mjs';
import { voucherMeta } from './voucher-meta.mjs';
import { ways } from './ways.mjs';

const onlyFor = (src) => (page) => page.src === src;

/**
 * Lo que va antes de las marcas `<!-- arcli: … -->`: prompt del README, negritas y titulos de bloques, avisos y links.
 * Los links van antes de `ways`, asi la tercera columna de la tabla ya apunta al sitio.
 */
const BEFORE = [installPrompt, markdownTouches, githubAlertsToAsides, rewriteLinks];

/** Lo que el sitio dibuja distinto que GitHub, en el orden en que corre. `appliesTo` limita un paso a una pagina. */
export const SITE_TRANSFORMS = [
  { transform: gifs },
  { transform: sizedImages },
  { transform: shortcutGrids },
  { transform: optionCards },
  { transform: chats },
  { transform: samples },
  { transform: ways },
  { transform: steps },
  { transform: tabs },
  { appliesTo: onlyFor('docs/troubleshooting.md'), transform: problems },
  { appliesTo: onlyFor('CHANGELOG.md'), transform: releases },
];

/**
 * El cuerpo de una pagina para el sitio. Devuelve `content` (lo que se escribe), `source` (sin la marca de la familia
 * ni el comentario de "Generado", para la descripcion) y `familia` (al frontmatter, o `null`).
 */
export function transformPage(body, ctx) {
  const shown = ctx.page.src === 'CHANGELOG.md' ? argentineVersionDates(body) : body;
  const { body: source, familia } = voucherMeta(shown.replace(/^<!-- Generado[^\n]*\n+/, ''));
  const prepared = BEFORE.reduce((text, transform) => transform(text, ctx), source);
  const content = SITE_TRANSFORMS.reduce(
    (text, { appliesTo, transform }) => (!appliesTo || appliesTo(ctx.page) ? transform(text, ctx) : text),
    prepared,
  );

  return { content, familia, source };
}
