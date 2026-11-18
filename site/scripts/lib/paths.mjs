import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const siteDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const repoDir = join(siteDir, '..');
export const contentDir = join(siteDir, 'src/content/docs');

/** Prefijo de los links internos: el sitio esta en la raiz de arcli.com.ar (astro.config.mjs no tiene `base`). */
export const BASE = '';
export const REPO = 'https://github.com/LcsGrz/arcli';
