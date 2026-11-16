// @ts-check
import starlight from '@astrojs/starlight';
import { existsSync, readFileSync } from 'node:fs';

import { defineConfig } from 'astro/config';

// El menu lo arma scripts/sync-docs.mjs (corre antes de `astro dev` y `astro build`), con un icono por pagina.
const sidebarFile = new URL('./src/generated/sidebar.json', import.meta.url);
const sidebar = existsSync(sidebarFile) ? JSON.parse(readFileSync(sidebarFile, 'utf8')) : [];

// `base` tiene que coincidir con BASE de scripts/sync-docs.mjs: el sitio vive en lcsgrz.github.io/arcli.
export default defineConfig({
  base: '/arcli',
  integrations: [
    starlight({
      components: {
        Header: './src/components/Header.astro',
        Sidebar: './src/components/Sidebar.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
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
      sidebar,
      social: [
        { href: 'https://github.com/LcsGrz/arcli', icon: 'github', label: 'GitHub' },
        { href: 'https://www.npmjs.com/package/arcli', icon: 'npm', label: 'npm' },
      ],
      title: 'arcli',
    }),
  ],
  site: 'https://lcsgrz.github.io',
});
