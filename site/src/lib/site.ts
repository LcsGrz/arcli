/** Utilidades y links que comparten los componentes del sitio (y `astro.config.mjs`). */

export const REPO_URL = 'https://github.com/LcsGrz/arcli';
export const ISSUES_URL = `${REPO_URL}/issues`;
export const NPM_URL = 'https://www.npmjs.com/package/arcli';
export const CAFECITO_URL = 'https://cafecito.app/lcsgrz';

/**
 * Una ruta del sitio con la `base` de Astro adelante: `url('ayuda/novedades/')`, y `url()` para el inicio. Lee
 * `BASE_URL` al llamarla, no al importar, para que `astro.config.mjs` pueda importar los links de arriba.
 */
export const url = (path = '') => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path}`;

/** Escapa el texto que va adentro de HTML armado a mano (`set:html`). */
export const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** La portada, que tiene su propio título y su propio pie (`Landing.astro`). */
export const isHome = (route: { id: string }) => route.id === '';
