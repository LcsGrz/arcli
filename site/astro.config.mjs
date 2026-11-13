// @ts-check
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// `base` tiene que coincidir con BASE de scripts/sync-docs.mjs: el sitio vive en lcsgrz.github.io/arcli.
export default defineConfig({
  base: '/arcli',
  integrations: [
    starlight({
      customCss: ['./src/styles/arcli.css'],
      // La 404 es la de src/content/docs/404.md, en español y con el buscador.
      disable404Route: true,
      description: 'Emití facturas electrónicas de ARCA (ex AFIP) desde la terminal o con un asistente paso a paso.',
      favicon: '/favicon.svg',
      head: [
        {
          attrs: { content: 'https://lcsgrz.github.io/arcli/assets/imagenes/social-preview.png', property: 'og:image' },
          tag: 'meta',
        },
      ],
      lastUpdated: false,
      locales: { root: { label: 'Español', lang: 'es' } },
      logo: { alt: 'arcli', src: './src/assets/logo.svg' },
      sidebar: [
        { items: [{ autogenerate: { directory: 'empezar' } }], label: 'Empezar' },
        { items: [{ autogenerate: { directory: 'guias' } }], label: 'Guías' },
        { items: [{ autogenerate: { directory: 'referencia' } }], label: 'Referencia' },
        { items: [{ autogenerate: { directory: 'ayuda' } }], label: 'Ayuda' },
      ],
      social: [
        { href: 'https://github.com/LcsGrz/arcli', icon: 'github', label: 'GitHub' },
        { href: 'https://www.npmjs.com/package/arcli', icon: 'npm', label: 'npm' },
      ],
      title: 'arcli',
    }),
  ],
  site: 'https://lcsgrz.github.io',
});
