import { headingSlug } from '../lib/markdown.mjs';

/**
 * `<!-- arcli: pestañas=grupo -->` y despues `### Windows`, `### macOS`... hasta el proximo `##`: pestañas. La eleccion
 * se recuerda por grupo en todas las paginas (`src/lib/docs/tabs.ts`). En GitHub se leen como subtitulos.
 *
 * Los atributos son los de un tablist (como `Tabs.astro` de la portada): cada pestaña controla su panel y solo la
 * elegida entra con Tab. Los ids llevan el grupo y el numero de bloque, por si una pagina repite el grupo.
 */
export function tabs(text) {
  let count = 0;

  return text.replace(/<!-- arcli: pestañas=([\w-]+) -->\n([\s\S]*?)(?=\n## |$)/g, (_, group, block) => {
    count += 1;
    const id = (kind, panel) => `${kind}-${group}-${count}-${panel.id}`;
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
          `<button type="button" role="tab" id="${id('tab', panel)}" aria-selected="${i === 0}" aria-controls="${id('panel', panel)}"${i === 0 ? '' : ' tabindex="-1"'} data-tab="${panel.id}">${panel.name}</button>`,
      )
      .join('');
    const bodies = panels
      .map(
        (panel, i) =>
          `<div role="tabpanel" id="${id('panel', panel)}" aria-labelledby="${id('tab', panel)}" data-panel="${panel.id}"${i === 0 ? '' : ' hidden'}>\n\n${panel.body}\n\n</div>`,
      )
      .join('\n');

    return `<div class="arcli-tabs" data-sync="${group}"><div role="tablist">${buttons}</div>\n${bodies}\n</div>\n`;
  });
}
