import { uiSymbol } from '../../ui/primitives';

import { isNewerVersion } from './update-check.service';

const CHANGELOG_URL = (version: string) => `https://raw.githubusercontent.com/LcsGrz/arcli/v${version}/CHANGELOG.md`;
const FETCH_TIMEOUT_MS = 3000;
// Lo que entra en un renglon del panel junto a la etiqueta ("nuevo", "arreglo"), en una terminal de 92 columnas.
const MAX_LEAD_LENGTH = 70;

/** Secciones de Keep a Changelog que usa el CHANGELOG; `otro` para cualquier otra. */
export type ChangelogChangeKind =
  'agregado' | 'cambiado' | 'corregido' | 'deprecado' | 'eliminado' | 'otro' | 'seguridad';

export interface ChangelogChange {
  readonly kind: ChangelogChangeKind;
  /** Un punto dentro de otro (por ejemplo, las partes de "Modo interactivo:"). */
  readonly nested: boolean;
  /** El titulo en negrita del cambio, o el comienzo del texto si no tiene. */
  readonly text: string;
  /** Categoria corta del titulo ("Modo interactivo", "Docs"); el detalle queda en `text`. */
  readonly topic?: string;
}

export interface ChangelogEntry {
  readonly changes: readonly ChangelogChange[];
  readonly date?: string;
  /** El nombre de la version (`## [2.6.0] - 2026-11-21 · Monotributo y recibos`), solo en las X.Y.0 que lo tienen. */
  readonly name?: string;
  /** Primera oracion de la introduccion de la version, si tiene. */
  readonly summary?: string;
  readonly version: string;
}

const CHANGE_KINDS: Record<string, ChangelogChangeKind> = {
  agregado: 'agregado',
  arreglado: 'corregido',
  cambiado: 'cambiado',
  corregido: 'corregido',
  deprecado: 'deprecado',
  eliminado: 'eliminado',
  seguridad: 'seguridad',
};

// `## [2.6.0] - 2026-11-21 · Monotributo y recibos`: la fecha y el nombre son opcionales.
const VERSION_HEADING = /^## \[(\d+\.\d+\.\d+)\](?:\s*-\s*([^\s·]+))?(?:\s*·\s*(.+?))?\s*$/;
const FENCE = /^\s*(?:```|~~~)/;

/** `### ✨ Agregado` → `agregado`: sin el icono (ni sus selectores de variante) ni mayusculas. */
function sectionKind(heading: string): ChangelogChangeKind {
  const name = heading
    .replace(/^[^\p{L}]+/u, '')
    .trim()
    .toLowerCase();

  return CHANGE_KINDS[name] ?? 'otro';
}

/** Saca el markdown de una linea: negritas, codigo y links (queda el texto del link). */
function plainText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|`/g, '')
    .trim();
}

function shorten(value: string, maxLength = MAX_LEAD_LENGTH): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}${uiSymbol('ellipsis')}` : value;
}

function firstSentence(value: string): string {
  return value.split(/(?<=\.)\s/)[0] ?? value;
}

/**
 * El titulo en negrita del cambio. Si es solo una categoria corta ("Modo interactivo:", "Docs:"), queda como
 * `topic` y el texto es el comienzo de la descripcion, porque la categoria sola no dice nada.
 */
function changeLead(bullet: string): Pick<ChangelogChange, 'text' | 'topic'> {
  const bold = /^\*\*(.+?)\*\*(.*)$/.exec(bullet);

  if (!bold) {
    return { text: shorten(plainText(firstSentence(bullet))) };
  }

  const [, title, rest] = bold;
  const isCategory = title.endsWith(':') && title.split(/\s+/).length <= 2 && rest.trim() !== '';

  if (isCategory) {
    const topic = plainText(title.slice(0, -1));

    // La categoria y el texto van en el mismo renglon: "Docs: el glosario...".
    return { text: shorten(plainText(firstSentence(rest.trim())), MAX_LEAD_LENGTH - topic.length - 2), topic };
  }

  return { text: shorten(plainText(title.replace(/:$/, ''))) };
}

/**
 * Las versiones posteriores a `currentVersion`, hasta `latestVersion` inclusive, de la mas nueva a la mas vieja.
 *
 * Lee el formato de `CHANGELOG.md` (`## [X.Y.Z] - fecha · Nombre`, resumen, destacados `####`, caja `> [!WARNING]`,
 * `---`, secciones `### ✨ Agregado` con `<details>`) y el de antes (sin nombre, iconos ni destacados), que siguen
 * teniendo los tags viejos. Lo que esta en un bloque de codigo, una cita o un `<details>` no es un cambio ni el resumen.
 */
export function extractChangelog(markdown: string, currentVersion: string, latestVersion: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current:
    { changes: ChangelogChange[]; date?: string; name?: string; summary?: string; version: string } | undefined;
  let kind: ChangelogChangeKind | undefined;
  // Despues de un destacado (`####`) ya no hay resumen ni cambios hasta la primera seccion.
  let inHighlights = false;
  let inFence = false;
  let inDetails = false;

  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    if (/<details[\s>]/.test(line) || inDetails) {
      inDetails = !line.includes('</details>');
      continue;
    }

    const heading = VERSION_HEADING.exec(line);

    if (heading) {
      const [, version, date, name] = heading;
      const inRange = isNewerVersion(version, currentVersion) && !isNewerVersion(version, latestVersion);

      current = inRange ? { changes: [], date, name, version } : undefined;
      kind = undefined;
      inHighlights = false;

      if (current) {
        entries.push(current);
      }

      continue;
    }

    if (line.startsWith('## ')) {
      current = undefined;
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith('### ')) {
      kind = sectionKind(line.slice(4));
      inHighlights = false;
      continue;
    }

    if (line.startsWith('#### ')) {
      inHighlights = !kind;
      continue;
    }

    // Una cita (la caja `> [!WARNING]`), la linea `---` y el HTML suelto no son cambios ni resumen.
    if (/^\s*(?:>|<|---\s*$)/.test(line) || inHighlights) {
      continue;
    }

    const bullet = /^(\s*)- (.+)$/.exec(line);

    if (bullet) {
      current.changes.push({ kind: kind ?? 'otro', nested: bullet[1].length > 0, ...changeLead(bullet[2]) });
    } else if (!kind && line.trim() && !current.summary) {
      current.summary = plainText(firstSentence(line));
    }
  }

  return entries;
}

/** El CHANGELOG.md publicado con esa version; `undefined` si no se pudo bajar. */
export async function fetchChangelog(version: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(CHANGELOG_URL(version), { signal: controller.signal });

    return response.ok ? await response.text() : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
