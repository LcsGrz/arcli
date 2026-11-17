import { headingSlug } from '../lib/markdown.mjs';

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

/** El tipo de cambio (`Agregado`, `⚠️ Puede afectar…`) como chip. El texto no cambia, asi el ancla sigue siendo `#agregado`. */
function changeKindChip(name) {
  const key = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
  const kind = /puede afectar/.test(key) ? 'aviso' : (CHANGE_KINDS[key] ?? 'otro');

  return `<span class="arcli-chip arcli-kind arcli-kind-${kind}">${name}</span>`;
}

/**
 * Novedades: sin "Sin publicar" (es lo que todavia no salio), las ultimas tres versiones abiertas con la fecha abajo y
 * el resto en un desplegable por version. Los tipos de cambio (`### Agregado`...) van como chips de color: en las
 * abiertas siguen siendo titulos con su ancla y en las plegadas, un parrafo (como antes, cuando iban en negrita).
 */
export function releases(text) {
  const [head, ...parts] = text.split(/^(?=## )/m);
  const versions = parts.filter((part) => !/^## Sin publicar/.test(part));
  const dated = (part) => {
    const [line, ...rest] = part.split('\n');
    const match = line.match(/^## (.+?) · (.+)$/);

    return { body: rest.join('\n').trim(), date: match?.[2] ?? '', version: match?.[1] ?? line.replace(/^## /, '') };
  };
  const recent = versions.slice(0, 3).map((part) => {
    const { body, date, version } = dated(part);

    return `## ${version}\n\n<p class="arcli-date">${date}</p>\n\n${body.replace(/^### (.+)$/gm, (_, name) => `### ${changeKindChip(name)}`)}\n`;
  });
  const older = versions.slice(3).map((part) => {
    const { body, date, version } = dated(part);

    return `<details class="arcli-ver" id="${headingSlug(version)}">\n<summary><b>${version}</b><small>${date}</small></summary>\n\n${body.replace(/^### (.+)$/gm, (_, name) => `<p>${changeKindChip(name)}</p>`)}\n\n</details>\n`;
  });

  return [head.trim(), ...recent, older.length ? `## Versiones anteriores\n\n${older.join('\n')}` : ''].join('\n\n');
}
