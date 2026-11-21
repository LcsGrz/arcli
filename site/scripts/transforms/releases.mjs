import { escapeHtml, headingSlug } from '../lib/markdown.mjs';

/** Color del chip de cada tipo de cambio de Novedades; lo que no esta aca sale en gris (`arcli-kind-otro`). */
const CHANGE_KINDS = {
  agregado: 'agregado',
  arreglado: 'arreglado',
  cambiado: 'cambiado',
  corregido: 'arreglado',
  deprecado: 'deprecado',
  documentacion: 'documentacion',
  eliminado: 'eliminado',
  seguridad: 'seguridad',
};

/**
 * El tipo de cambio (`✨ Agregado`, `⚠️ Puede afectar…`) como chip. El icono va en `data-icon` y lo dibuja el CSS: el
 * texto del titulo queda sin el, asi el ancla sigue siendo `#agregado` (con el icono, GitHub y Astro dan `#-agregado`).
 */
function changeKindChip(name) {
  const [, icon, label] = name.match(/^([^\p{L}]*?)\s*(\p{L}.*)$/u) ?? [name, '', name];
  const key = label
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
  const kind = /puede afectar/.test(key) ? 'aviso' : (CHANGE_KINDS[key] ?? 'otro');
  const iconAttribute = icon.trim() ? ` data-icon="${escapeHtml(icon.trim())}"` : '';

  return `<span class="arcli-chip arcli-kind arcli-kind-${kind}"${iconAttribute}>${label}</span>`;
}

/**
 * Los destacados de una version (`#### Titulo`, su parrafo y su bloque de codigo, antes de la primera seccion) como
 * tarjetas en grilla. Terminan en el aviso (`:::`, ya convertido por `alerts.mjs`), en la linea `---` o en la primera
 * seccion (`### `); un `---` o `:::` adentro de un bloque de codigo no cuenta.
 */
function highlightCards(body) {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => line.startsWith('#### '));
  const firstSection = lines.findIndex((line) => line.startsWith('### '));

  if (start < 0 || (firstSection >= 0 && firstSection < start)) {
    return body;
  }

  let end = start;
  let inCode = false;

  for (; end < lines.length; end++) {
    const line = lines[end];

    if (line.startsWith('```')) inCode = !inCode;

    if (!inCode && /^(?::::|---\s*$|### )/.test(line)) break;
  }

  const cards = lines
    .slice(start, end)
    .join('\n')
    .trim()
    .split(/^(?=#### )/m)
    .map((card) => `<div class="arcli-highlight">\n\n${card.trim()}\n\n</div>`);

  return [
    ...lines.slice(0, start),
    `<div class="arcli-highlights">\n\n${cards.join('\n\n')}\n\n</div>\n`,
    ...lines.slice(end),
  ].join('\n');
}

/** `## 2.6.0 · 21/11/2026 · Monotributo y recibos` (ver `dates.mjs`): la version, la fecha y el nombre, si lo tiene. */
function versionParts(part) {
  const [line, ...rest] = part.split('\n');
  const match = line.match(/^## (\S+) · (\S+)(?: · (.+))?$/);

  return {
    body: highlightCards(rest.join('\n').trim()),
    date: match?.[2] ?? '',
    name: match?.[3] ?? '',
    version: match?.[1] ?? line.replace(/^## /, ''),
  };
}

/**
 * Novedades: sin "Sin publicar" (es lo que todavia no salio), las ultimas tres versiones abiertas con la fecha abajo y
 * el resto en un desplegable por version. El nombre de la version (`· Monotributo y recibos`) va al lado del numero y
 * los destacados, en tarjetas. Los tipos de cambio (`### ✨ Agregado`...) van como chips de color: en las abiertas
 * siguen siendo titulos con su ancla y en las plegadas, un parrafo (como antes, cuando iban en negrita).
 */
export function releases(text) {
  const [head, ...parts] = text.split(/^(?=## )/m);
  const versions = parts.filter((part) => !/^## Sin publicar/.test(part));
  const recent = versions.slice(0, 3).map((part) => {
    const { body, date, name, version } = versionParts(part);
    const title = name ? `${version} <span class="arcli-ver-name">· ${escapeHtml(name)}</span>` : version;

    return `## ${title}\n\n<p class="arcli-date">${date}</p>\n\n${body.replace(/^### (.+)$/gm, (_, kind) => `### ${changeKindChip(kind)}`)}\n`;
  });
  const older = versions.slice(3).map((part) => {
    const { body, date, name, version } = versionParts(part);
    const title = name
      ? `<b>${version}</b><span class="arcli-ver-name">${escapeHtml(name)}</span>`
      : `<b>${version}</b>`;

    return `<details class="arcli-ver" id="${headingSlug(version)}">\n<summary>${title}<small>${date}</small></summary>\n\n${body.replace(/^### (.+)$/gm, (_, kind) => `<p>${changeKindChip(kind)}</p>`)}\n\n</details>\n`;
  });

  return [head.trim(), ...recent, older.length ? `## Versiones anteriores\n\n${older.join('\n')}` : ''].join('\n\n');
}
