/**
 * El menu: una seccion por carpeta, en el orden de `sections`, y cada pagina con su icono (`data-icon`, lo dibuja
 * `Sidebar.astro`). Las paginas con `group` van juntas en un grupo plegable; "Monotributo · C" lleva la letra al lado.
 */
export function buildSidebar(sections, pages) {
  return sections
    .map(({ dir, label }) => {
      const items = [];

      for (const page of pages.filter((other) => other.slug.split('/')[0] === dir && !other.hidden)) {
        const link = { attrs: { 'data-icon': page.icon }, label: page.label ?? page.title, slug: page.slug };
        const last = items.at(-1);

        if (page.group && last?.items && last.label === page.group) last.items.push(link);
        else if (page.group) items.push({ collapsed: true, items: [link], label: page.group });
        else items.push(link);
      }

      return { items, label };
    })
    .filter((section) => section.items.length > 0);
}
