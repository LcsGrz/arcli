import { REPO } from '../lib/paths.mjs';

/** Una pagina dentro de `llms-full.txt`: titulo, archivo fuente y el Markdown de `docs/` tal cual. */
export const llmsFullPage = ({ body, page, title }) =>
  `# ${title}\n\nFuente: ${REPO}/blob/main/${page.src}\n\n${body}\n`;

/** Una pagina sola en Markdown (`/<slug>.md`), para asistentes de IA. */
export const pageMarkdown = ({ body, title }) => `# ${title}\n\n${body}\n`;

/** `llms-full.txt`: todas las paginas en un solo archivo, en el orden de `PAGES`. */
export const llmsFull = (pages) =>
  `# arcli: documentación completa\n\nTodas las páginas de https://arcli.com.ar/ en un solo archivo. El resumen para agentes está en https://arcli.com.ar/llms.txt.\n\n${pages.map(llmsFullPage).join('\n---\n\n')}`;
