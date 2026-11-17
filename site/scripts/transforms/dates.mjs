/**
 * El CHANGELOG sigue Keep a Changelog (`## [2.4.0] - 2026-11-08`, lo leen herramientas); en el sitio las fechas van en
 * formato argentino: `## 2.4.0 · 08/11/2026`.
 */
export function argentineVersionDates(text) {
  return text
    .replace(/^## \[([^\]]+)\] - (\d{4})-(\d{2})-(\d{2})$/gm, '## $1 · $4/$3/$2')
    .replace(/^## \[Sin publicar\]$/m, '## Sin publicar');
}
