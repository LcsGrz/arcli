import { ESLint } from 'eslint';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ARQ-12: el núcleo (src/lib y src/modules) no toca archivos ni lee el proceso. Los módulos de la app (ARQ-7) y los
 * tests quedan afuera, y `conf` sigue en warn hasta el ConfigStore. Mira la config real de ESLint que le toca a cada
 * archivo (`calculateConfigForFile`), como data-directory-rule.test.mjs: lintear texto inventado sobre la ruta de un
 * archivo real, con lint tipado, depende de qué programa de TypeScript armó antes el mismo worker.
 */
const ERROR = 2;
const WARN = 1;
const APP_MODULES = ['completion', 'desktop-shortcut', 'examples', 'storybook', 'update-check'];
const FS_MODULES = ['node:fs', 'node:fs/promises', 'fs', 'fs/promises'];

const eslint = new ESLint();

/** La severidad y las rutas prohibidas de una regla de imports, en la config que le toca a `file`. */
async function restrictedImports(file, rule) {
  const [severity, options] = (await eslint.calculateConfigForFile(file)).rules[rule] ?? [];

  return { paths: options?.paths ?? [], severity };
}

const fsPaths = (paths) => paths.filter(({ name }) => FS_MODULES.includes(name));

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
  it.each(['src/lib/paths/mask-path.ts', 'src/modules/config/config-doctor.ts'])(
    'importar fs en %s es error',
    async (file) => {
      const error = await restrictedImports(file, 'no-restricted-imports');
      const debt = await restrictedImports(file, '@typescript-eslint/no-restricted-imports');

      expect(error.severity).toBe(ERROR);
      expect(fsPaths(error.paths).map(({ name }) => name)).toEqual(FS_MODULES);
      // Solo error: ninguna regla de deuda lo marca además en warn.
      expect(fsPaths(debt.paths)).toEqual([]);
    },
  );

  it('usar process es error en todo el núcleo, sin archivos de deuda', async () => {
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
    const [severity, ...globals] =
      (await eslint.calculateConfigForFile('src/lib/paths/mask-path.ts')).rules['no-restricted-globals'] ?? [];

    expect(severity).toBe(ERROR);
    expect(globals).toContainEqual(expect.objectContaining({ name: 'process' }));
  });

  it('en los módulos de la app sigue en warn, con el mensaje de ARQ-7', async () => {
    const file = 'src/modules/update-check/update-check.service.ts';
    const error = await restrictedImports(file, 'no-restricted-imports');
    const debt = await restrictedImports(file, '@typescript-eslint/no-restricted-imports');
    const [globalsSeverity, ...globals] = (await eslint.calculateConfigForFile(file)).rules['no-restricted-globals'];
    const arq7 = expect.objectContaining({ message: expect.stringContaining('ARQ-7') });

    expect(fsPaths(error.paths)).toEqual([]);
    expect(debt.severity).toBe(WARN);
    expect(fsPaths(debt.paths).map(({ name }) => name)).toEqual(FS_MODULES);
    expect(fsPaths(debt.paths)).toEqual(FS_MODULES.map(() => arq7));
    expect(globalsSeverity).toBe(WARN);
    expect(globals).toEqual([expect.objectContaining({ message: expect.stringContaining('ARQ-7'), name: 'process' })]);
  });

  // Tests primero (ARQ-12 PR 3): pasa a it() al implementarlo.
  it.fails.each(['src/lib/paths/mask-path.ts', 'src/modules/config/config.service.ts'])(
    'importar conf en %s es error, sin deuda en warn',
    async (file) => {
      const error = await restrictedImports(file, 'no-restricted-imports');
      const debt = await restrictedImports(file, '@typescript-eslint/no-restricted-imports');

      expect(error.severity).toBe(ERROR);
      expect(error.paths).toContainEqual(expect.objectContaining({ name: 'conf' }));
      // Solo error: ninguna regla de deuda lo marca además en warn, ni queda un mensaje que diga que lo cierra ARQ-12.
      expect(debt.paths.filter(({ name }) => name === 'conf')).toEqual([]);
    },
  );

  it('en los módulos de la app, conf sigue en warn con el mensaje de ARQ-7', async () => {
    const file = 'src/modules/update-check/update-check.service.ts';
    const error = await restrictedImports(file, 'no-restricted-imports');
    const debt = await restrictedImports(file, '@typescript-eslint/no-restricted-imports');

    expect(error.paths.filter(({ name }) => name === 'conf')).toEqual([]);
    expect(debt.severity).toBe(WARN);
    expect(debt.paths.filter(({ name }) => name === 'conf')).toEqual([
      expect.objectContaining({ message: expect.stringContaining('ARQ-7') }),
    ]);
  });

  // Tests primero (ARQ-12 PR 3): pasa a it() al implementarlo.
  it.fails('ninguna regla del núcleo queda en warn con el mensaje de ARQ-12', async () => {
    const pending = [];

    for (const file of coreFiles()) {
      const debt = await restrictedImports(file, '@typescript-eslint/no-restricted-imports');

      if (debt.paths.some(({ message }) => message?.includes('ARQ-12'))) {
        pending.push(file);
      }
    }

    expect(pending).toEqual([]);
  });

  it('los tests del núcleo pueden usar fs y process', async () => {
    const config = await eslint.calculateConfigForFile('src/modules/config/__tests__/config-doctor.test.ts');

    expect(config.rules['no-restricted-globals']).toBeUndefined();
    expect(JSON.stringify(config.rules['no-restricted-imports'] ?? [])).not.toContain('node:fs');
    expect(JSON.stringify(config.rules['@typescript-eslint/no-restricted-imports'] ?? [])).not.toContain('node:fs');
  });
});
