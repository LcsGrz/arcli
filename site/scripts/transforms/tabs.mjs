import { headingSlug } from '../lib/markdown.mjs';

/**
 * `<!-- arcli: pestañas=grupo -->` y despues `### Windows`, `### macOS`... hasta el proximo `##`: pestañas. La eleccion
 * se recuerda por grupo en todas las paginas (`public/arcli.js`). En GitHub se leen como subtitulos.
 */
export function tabs(text) {
  return text.replace(/<!-- arcli: pestañas=([\w-]+) -->\n([\s\S]*?)(?=\n## |$)/g, (_, group, block) => {
    const panels = block
      .split(/^### /m)
      .slice(1)
      .map((chunk) => {
        const [name, ...rest] = chunk.split('\n');

        return { body: rest.join('\n').trim(), id: headingSlug(name.trim()), name: name.trim() };
      });
    const buttons = panels
      .map(
        (panel, i) =>
          `<button type="button" role="tab" aria-selected="${i === 0}" data-tab="${panel.id}">${panel.name}</button>`,
      )
      .join('');
    const bodies = panels
      .map(
        (panel, i) =>
          `<div role="tabpanel" data-panel="${panel.id}"${i === 0 ? '' : ' hidden'}>\n\n${panel.body}\n\n</div>`,
      )
      .join('\n');

    return `<div class="arcli-tabs" data-sync="${group}"><div role="tablist">${buttons}</div>\n${bodies}\n</div>\n`;
  });
}
