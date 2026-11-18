/**
 * Íconos de los títulos `##` del README: los mismos dibujos del sitio (`site/src/icons.ts`), como SVG sueltos en
 * `docs/assets/iconos/`, porque GitHub no deja poner SVG en línea. `yarn docs:readme-iconos` los escribe y pone los
 * títulos del README; `readme-iconos.test.ts` falla si quedaron desincronizados.
 */
import { type IconName, ICONS } from '../../site/src/icons';

/** Celeste del trazo: contrasta sobre el blanco y sobre el oscuro de GitHub (el `#74acdf` del sitio casi no se ve en blanco). */
export const ICON_COLOR = '#2f86c9';

/** Rama de las URLs del README publicado. En un PR se puede apuntar a la rama para verlo en GitHub (`--ref`). */
export const DEFAULT_REF = 'main';

const RAW = 'https://raw.githubusercontent.com/LcsGrz/arcli';

/** Carpeta de los SVG, desde la raíz del repo. */
export const ICONS_DIR = 'docs/assets/iconos';

/** Cada título `##` del README con su ancla de siempre (la que GitHub generaba sin el ícono) y su ícono. */
export const README_HEADINGS = [
  { title: 'Elegí cómo usarlo', anchor: 'elegí-cómo-usarlo', icon: 'flechas' },
  { title: 'Qué facturás', anchor: 'qué-facturás', icon: 'factura' },
  { title: 'Empezar', anchor: 'empezar', icon: 'terminal' },
  { title: 'Qué trae', anchor: 'qué-trae', icon: 'pila' },
  { title: 'Seguridad', anchor: 'seguridad', icon: 'escudo' },
  { title: 'Documentación', anchor: 'documentación', icon: 'libro' },
  { title: 'Comunidad', anchor: 'comunidad', icon: 'chat' },
  { title: 'Agradecimientos', anchor: 'agradecimientos', icon: 'estrella' },
  { title: 'Licencia', anchor: 'licencia', icon: 'candado' },
] as const satisfies readonly { anchor: string; icon: IconName; title: string }[];

export type ReadmeIcon = (typeof README_HEADINGS)[number]['icon'];

/** El SVG suelto de un ícono: trazo de 24×24 como `Icon.astro`, pero con el color fijo. */
export function renderSvg(name: ReadmeIcon): string {
  const attrs = [
    'xmlns="http://www.w3.org/2000/svg"',
    'width="24"',
    'height="24"',
    'viewBox="0 0 24 24"',
    'fill="none"',
    `stroke="${ICON_COLOR}"`,
    'stroke-width="1.8"',
    'stroke-linecap="round"',
    'stroke-linejoin="round"',
  ].join(' ');

  return `<svg ${attrs}>${ICONS[name]}</svg>\n`;
}

/** Los SVG que van en `docs/assets/iconos/`, por nombre de archivo. */
export function renderIcons(): Map<string, string> {
  return new Map(README_HEADINGS.map(({ icon }) => [`${icon}.svg`, renderSvg(icon)]));
}

export function iconUrl(name: ReadmeIcon, ref = DEFAULT_REF): string {
  return `${RAW}/${ref}/${ICONS_DIR}/${name}.svg`;
}

/**
 * El título con su ícono. GitHub saca `style`, así que la alineación va con `align`. Con el `<img>` adelante, GitHub
 * genera el ancla `#-empezar`: el `<a id>` de arriba mantiene `#empezar` para los links que ya existen.
 */
export function renderHeading({ anchor, icon, title }: (typeof README_HEADINGS)[number], ref = DEFAULT_REF): string {
  const img = `<img src="${iconUrl(icon, ref)}" width="24" height="24" alt="" align="absmiddle">`;

  return `<a id="${anchor}"></a>\n\n## ${img} ${title}`;
}

/** Título `##` del README, con o sin ícono y con o sin el `<a id>` de arriba. */
const HEADING = /^(?:<a id="[^"]*"><\/a>\n\n)?## (?:<img [^>]*> )?(.+)$/gm;

/** El README con cada título `##` en su forma con ícono. Falla si hay un título que no está en `README_HEADINGS`. */
export function applyHeadings(readme: string, ref = DEFAULT_REF): string {
  return readme.replace(HEADING, (_match, title: string) => {
    const heading = README_HEADINGS.find((item) => item.title === title);

    if (!heading) {
      throw new Error(`README.md: el título "${title}" no tiene ícono; sumalo a README_HEADINGS.`);
    }

    return renderHeading(heading, ref);
  });
}

/** La rama a la que apuntan los íconos del README (la del primero). */
export function readmeRef(readme: string): string | undefined {
  const end = readme.indexOf(`/${ICONS_DIR}/`);
  const start = readme.lastIndexOf(`${RAW}/`, end);

  return start === -1 || end === -1 ? undefined : readme.slice(start + RAW.length + 1, end);
}
