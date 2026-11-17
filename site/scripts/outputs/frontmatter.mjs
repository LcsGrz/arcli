import { REPO } from '../lib/paths.mjs';

/** El frontmatter de una pagina; el orden en el menu es su posicion entre las `pages` de la misma seccion. */
export function frontmatter(page, pages, { description, extra = {}, title }) {
  const quote = (value) => JSON.stringify(value);
  const order = pages.filter((other) => other.slug.split('/')[0] === page.slug.split('/')[0]).indexOf(page) + 1;

  return [
    '---',
    `title: ${quote(title)}`,
    `description: ${quote(description)}`,
    `editUrl: ${quote(`${REPO}/edit/dev/${page.src}`)}`,
    'sidebar:',
    `  label: ${quote(page.label ?? title)}`,
    `  order: ${order}`,
    ...Object.entries(extra).map(([key, value]) => `${key}: ${quote(value)}`),
    '---',
    '',
  ].join('\n');
}
