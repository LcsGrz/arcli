/**
 * Genera las paginas del sitio desde `docs/`, `README.md` y `CHANGELOG.md`, que siguen siendo la unica fuente: los
 * links de GitHub que ya circulan no se rompen y los tests de docs del CLI no cambian.
 *
 * Por cada pagina: titulo del primer `#` al frontmatter, links entre docs a la URL del sitio, links a archivos que no
 * estan en el sitio a GitHub, imagenes a `public/assets` y "Editar esta pagina" al archivo original en `dev`.
 * Lo generado esta en `.gitignore`; las paginas propias del sitio (como `index.mdx`) no se tocan.
 *
 * Este archivo solo orquesta. Que paginas hay: `pages.mjs`. Que le pasa al Markdown: `transforms/` (el orden, en
 * `transforms/index.mjs`). Lo que se escribe aparte (menu, marca, comprobantes, llms-full, imagenes): `outputs/`.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { extractBody } from './lib/body.mjs';
import { imageSize } from './lib/images.mjs';
import { contentDir, repoDir, siteDir } from './lib/paths.mjs';
import { readmeInstallPrompt } from './lib/readme.mjs';
import { readVouchers } from './lib/vouchers.mjs';
import { copyAssets } from './outputs/assets.mjs';
import { brandData, githubStars } from './outputs/brand.mjs';
import { vouchersData } from './outputs/comprobantes.mjs';
import { pageDescription } from './outputs/description.mjs';
import { writeFile, writeGenerated, writePublic } from './outputs/files.mjs';
import { frontmatter } from './outputs/frontmatter.mjs';
import { llmsFull, pageMarkdown } from './outputs/llms.mjs';
import { buildSidebar } from './outputs/sidebar.mjs';
import { ALIASES, ASSET_FOLDERS, GENERATED_SECTIONS, PAGES, SECTIONS } from './pages.mjs';
import { transformPage } from './transforms/index.mjs';

const read = (path) => readFileSync(join(repoDir, path), 'utf8');

async function sync() {
  for (const section of GENERATED_SECTIONS) {
    rmSync(join(contentDir, section), { force: true, recursive: true });
    rmSync(join(siteDir, 'public', section), { force: true, recursive: true });
  }

  const bySource = new Map(PAGES.map((page) => [page.src, page]));
  const pages = [];

  for (const page of PAGES) {
    const { body, title } = extractBody(page, read(page.src));
    const ctx = { aliases: ALIASES, bySource, imageSize, page, readmePrompt: readmeInstallPrompt };
    const { content, familia, source } = transformPage(body, ctx);
    const description = pageDescription(page, title, source);
    const extra = familia ? { familia } : {};

    writeFile(
      join(contentDir, `${page.slug}.md`),
      `${frontmatter(page, PAGES, { description, extra, title })}\n${content}\n`,
    );
    // Cada pagina tambien en Markdown, para asistentes de IA.
    writePublic(`${page.slug}.md`, pageMarkdown({ body, title }));
    pages.push({ body, page, title });
  }

  await copyAssets(ASSET_FOLDERS);

  const stars = await githubStars();

  writeGenerated(
    'brand.json',
    brandData({
      installPrompt: readmeInstallPrompt(),
      logoSource: read('src/ui/primitives/renderLogo.ts'),
      packageJson: read('package.json'),
      stars,
    }),
  );
  writeGenerated('sidebar.json', buildSidebar(SECTIONS, PAGES));
  writeGenerated('comprobantes.json', vouchersData(readVouchers()));

  // Para asistentes de IA: llms.txt (el resumen curado) y llms-full.txt (todo junto), en la raiz del sitio.
  writePublic('llms.txt', read('llms.txt'));
  writePublic('llms-full.txt', llmsFull(pages));

  console.log(`Sitio: ${PAGES.length} páginas generadas desde docs/.`);
}

await sync();
