/**
 * El CHANGELOG sigue Keep a Changelog (`## [2.4.0] - 2026-11-08`, lo leen herramientas); en el sitio las fechas van en
 * formato argentino: `## 2.4.0 · 08/11/2026`. El nombre de una version, si lo tiene, queda al final:
 * `## [2.6.0] - 2026-11-21 · Monotributo y recibos` → `## 2.6.0 · 21/11/2026 · Monotributo y recibos`.
 */
export function argentineVersionDates(text) {
  return text
    .replace(/^## \[([^\]]+)\] - (\d{4})-(\d{2})-(\d{2})( · .+)?$/gm, '## $1 · $4/$3/$2$5')
    .replace(/^## \[Sin publicar\]$/m, '## Sin publicar');
}
