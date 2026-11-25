import { ESLint } from 'eslint';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ARQ-12: el núcleo (src/lib y src/modules) no toca archivos ni lee el proceso. Los módulos de la app (ARQ-7) y los
 * tests quedan afuera, y `conf` sigue en warn hasta el ConfigStore. Pasa por la config real de ESLint.
 */
const ERROR = 2;
const WARN = 1;
const APP_MODULES = ['completion', 'desktop-shortcut', 'examples', 'storybook', 'update-check'];

const eslint = new ESLint();

/** La severidad con que la config real marca cada regla en `code`, como si estuviera en `filePath`. */
async function severities(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });

  return result.messages.map(({ message, ruleId, severity }) => ({ message, ruleId, severity }));
}

/** Los .ts del núcleo, sin tests ni módulos de la app. */
function coreFiles() {
  return ['src/lib', 'src/modules'].flatMap((root) =>
    readdirSync(root, { recursive: true })
      .map((file) => join(root, String(file)).split('\\').join('/'))
      .filter((file) => file.endsWith('.ts') && !file.includes('/__tests__/') && !file.endsWith('.test.ts'))
      .filter((file) => !APP_MODULES.some((name) => file.startsWith(`src/modules/${name}/`))),
  );
}

describe('el núcleo no toca archivos ni lee el proceso (ARQ-12)', () => {
  // Tests primero (ARQ-12): pasa a it() al implementarlo.
  it.fails.each([
    ['src/lib/paths/mask-path.ts', "import { readFileSync } from 'node:fs';\nexport const leer = readFileSync;\n"],
    ['src/lib/paths/mask-path.ts', "import { readFile } from 'fs/promises';\nexport const leer = readFile;\n"],
    [
      'src/modules/config/config-doctor.ts',
      "import { existsSync } from 'node:fs';\nexport const existe = existsSync;\n",
    ],
    [
      'src/modules/config/config-doctor.ts',
      "import { writeFile } from 'fs/promises';\nexport const escribir = writeFile;\n",
    ],
  ])('importar fs en %s es error', async (filePath, code) => {
    const fsMessages = (await severities(code, filePath)).filter(({ message }) =>
      /'(node:)?fs(\/promises)?'/.test(message),
    );

    expect(fsMessages.length).toBeGreaterThan(0);
    expect(fsMessages.map(({ severity }) => severity)).toEqual(fsMessages.map(() => ERROR));
  });

  // Tests primero (ARQ-12): pasa a it() al implementarlo.
  it.fails('usar process es error en todo el núcleo, sin archivos de deuda', async () => {
    const files = coreFiles();
    const warned = [];

    expect(files.length).toBeGreaterThan(100);

    for (const file of files) {
      const [severity] = (await eslint.calculateConfigForFile(file)).rules['no-restricted-globals'] ?? [];

      if (severity !== ERROR) {
        warned.push(`${file}: ${severity}`);
      }
    }

    expect(warned).toEqual([]);
  });

  it('process.platform ya es error en un archivo común del núcleo', async () => {
    const messages = await severities('export const plataforma = process.platform;\n', 'src/lib/paths/mask-path.ts');

    expect(messages).toContainEqual(expect.objectContaining({ ruleId: 'no-restricted-globals', severity: ERROR }));
  });

  it('en los módulos de la app sigue en warn, con el mensaje de ARQ-7', async () => {
    const messages = await severities(
      "import { readFileSync } from 'node:fs';\nexport const leer = readFileSync;\nexport const plataforma = process.platform;\n",
      'src/modules/update-check/update-check.service.ts',
    );

    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages).toEqual(
      messages.map(() => expect.objectContaining({ message: expect.stringContaining('ARQ-7'), severity: WARN })),
    );
  });

  it('conf sigue en warn en el núcleo hasta el ConfigStore', async () => {
    const messages = await severities(
      "import Conf from 'conf';\nexport const Almacen = Conf;\n",
      'src/modules/config/config-doctor.ts',
    );

    expect(messages).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('ARQ-12'), severity: WARN }),
    );
  });

  it('los tests del núcleo pueden usar fs y process', async () => {
    const config = await eslint.calculateConfigForFile('src/modules/config/__tests__/config-doctor.test.ts');

    expect(config.rules['no-restricted-globals']).toBeUndefined();
    expect(JSON.stringify(config.rules['no-restricted-imports'] ?? [])).not.toContain('node:fs');
    expect(JSON.stringify(config.rules['@typescript-eslint/no-restricted-imports'] ?? [])).not.toContain('node:fs');
  });
});
