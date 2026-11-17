// @ts-check
import starlight from '@astrojs/starlight';
import { existsSync, readFileSync } from 'node:fs';

import { defineConfig } from 'astro/config';

import { NPM_URL, REPO_URL } from './src/lib/site';

// El menu lo arma scripts/sync-docs.mjs (corre antes de `astro dev` y `astro build`), con un icono por pagina.
const sidebarFile = new URL('./src/generated/sidebar.json', import.meta.url);
const sidebar = existsSync(sidebarFile) ? JSON.parse(readFileSync(sidebarFile, 'utf8')) : [];

// Cloudflare Web Analytics (visitas, sin cookies): solo en el build, para no contar `astro dev`. El token es público.
const analytics = process.argv.includes('dev')
  ? []
  : [
      {
        attrs: {
          'data-cf-beacon': '{"token": "b33b6130f08f4210bea678e343d87d24"}',
          defer: true,
          src: 'https://static.cloudflareinsights.com/beacon.min.js',
          type: 'module',
        },
        tag: 'script',
      },
    ];

// El sitio vive en la raiz de arcli.com.ar, sin `base`: los links de scripts/sync-docs.mjs empiezan en `/`.
export default defineConfig({
  integrations: [
    starlight({
      components: {
        Footer: './src/components/Footer.astro',
        Header: './src/components/Header.astro',
        PageSidebar: './src/components/PageSidebar.astro',
        PageTitle: './src/components/PageTitle.astro',
        Sidebar: './src/components/Sidebar.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
      customCss: ['./src/styles/tokens.css', './src/styles/arcli.css'],
      // La 404 es la de src/content/docs/404.md, en español y con el buscador.
      disable404Route: true,
      description: 'Emití facturas electrónicas de ARCA (ex AFIP) desde la terminal o con un asistente paso a paso.',
      favicon: '/favicon.svg',
      head: [
        // Comportamiento de las páginas generadas: "Ver las N", el buscador de problemas y abrir lo plegado por link.
        { attrs: { defer: true, src: '/arcli.js' }, tag: 'script' },
        // Respaldo del favicon.svg para navegadores sin SVG (`sizes` evita que Chrome lo prefiera al SVG), el ícono de
        // inicio de iOS y el manifiesto. Los genera scripts/icono/generar.py en public/, desde el mismo ícono.
        { attrs: { href: '/favicon.ico', rel: 'icon', sizes: '32x32' }, tag: 'link' },
        { attrs: { href: '/apple-touch-icon.png', rel: 'apple-touch-icon' }, tag: 'link' },
        { attrs: { href: '/site.webmanifest', rel: 'manifest' }, tag: 'link' },
        // Geist y JetBrains Mono, las fuentes de la maqueta. `display=optional`: si no llegan enseguida, esa visita
        // sigue con la del sistema, así el texto (y sobre todo el código) no cambia de tamaño mientras carga.
        { attrs: { href: 'https://fonts.googleapis.com', rel: 'preconnect' }, tag: 'link' },
        { attrs: { crossorigin: true, href: 'https://fonts.gstatic.com', rel: 'preconnect' }, tag: 'link' },
        {
          attrs: {
            href: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=optional',
            rel: 'stylesheet',
          },
          tag: 'link',
        },
        {
          attrs: { content: 'https://arcli.com.ar/assets/imagenes/social-preview.png', property: 'og:image' },
          tag: 'meta',
        },
        ...analytics,
      ],
      // Bloques de código como en la maqueta: título ("Terminal") y "Copiar", sin los tres puntos de la ventana. Los colores
      // son los tokens de terminal de src/styles/tokens.css.
      expressiveCode: {
        styleOverrides: {
          borderColor: 'var(--arcli-term-line)',
          borderRadius: 'var(--arcli-radius-lg)',
          // Con un color fijo (no un token), así expressive-code puede calcular el contraste del texto en el tema claro.
          codeBackground: '#11111b',
          frames: {
            editorActiveTabBackground: 'var(--arcli-term-bg)',
            editorTabBarBackground: 'var(--arcli-term-bg)',
            editorTabBarBorderBottomColor: 'var(--arcli-term-line)',
            frameBoxShadowCssValue: 'none',
            terminalBackground: 'var(--arcli-term-bg)',
            terminalTitlebarBackground: 'var(--arcli-term-bg)',
            terminalTitlebarBorderBottomColor: 'var(--arcli-term-line)',
            terminalTitlebarDotsOpacity: '0',
            terminalTitlebarForeground: 'var(--arcli-term-fg-soft)',
          },
        },
      },
      lastUpdated: false,
      // El índice de la derecha, solo con las secciones (##).
      tableOfContents: { maxHeadingLevel: 2, minHeadingLevel: 2 },
      locales: { root: { label: 'Español', lang: 'es' } },
      logo: { alt: 'arcli', src: './src/assets/logo.svg' },
      sidebar,
      social: [
        { href: REPO_URL, icon: 'github', label: 'GitHub' },
        { href: NPM_URL, icon: 'npm', label: 'npm' },
      ],
      title: 'arcli',
    }),
  ],
  site: 'https://arcli.com.ar',
});
