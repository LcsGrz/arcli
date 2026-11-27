import { ESLint } from 'eslint';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ARQ-12: un solo archivo carga SQLite (src/services/data/sqlite-driver.ts), para ocultar ahí el aviso de Node 22 y
 * poder cambiar de driver sin tocar el resto. Mira la config real de ESLint que le toca a cada archivo
 * (`calculateConfigForFile`), como core-files-boundary.test.mjs. `no-restricted-imports` no ve un `import()` ni
 * `process.getBuiltinModule`: eso lo busca el texto.
 */
const ERROR = 2;
const DRIVER = 'src/services/data/sqlite-driver.ts';
const DATA = 'src/services/data';

const eslint = new ESLint();

/** Los .ts de src sin tests ni helpers de tests, con `/` en cualquier sistema. */
function sourceFiles(root = 'src') {
  return readdirSync(root, { recursive: true })
    .map((file) => join(root, String(file)).split('\\').join('/'))
    .filter((file) => file.endsWith('.ts') && !file.includes('/__tests__/') && !file.endsWith('.test.ts'))
    .filter((file) => !file.startsWith('src/testing/'));
}

/** Las entradas de `no-restricted-imports` (las de error) que nombran node:sqlite, en la config de `file`. */
async function sqliteRestrictions(file) {
  const [severity, options] = (await eslint.calculateConfigForFile(file)).rules['no-restricted-imports'] ?? [];
  const paths = (options?.paths ?? []).filter(({ name }) => name === 'node:sqlite');

  return { paths, severity };
}

describe('node:sqlite solo en el driver (ARQ-12)', () => {
  it('ningún otro archivo de src nombra node:sqlite ni getBuiltinModule', () => {
    const naming = sourceFiles().filter((file) => /node:sqlite|getBuiltinModule/.test(readFileSync(file, 'utf8')));

    expect(naming.filter((file) => file !== DRIVER)).toEqual([]);
  });

  // Un import estático avisa antes de que se pueda filtrar el aviso de Node 22 (medido el 25/11).
  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('el driver lo carga con import() dinámico, nunca estático', () => {
    const driver = readFileSync(DRIVER, 'utf8');

    expect(driver).toMatch(/await import\(\s*['"]node:sqlite['"]\s*\)/);
    expect(driver).not.toMatch(/^\s*import\s[^(]*['"]node:sqlite['"]/m);
  });

  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails.each([
    'src/services/data/sqlite-voucher-record-store.ts',
    'src/services/data/sqlite-errors.ts',
    'src/services/files/conf-config-store.ts',
    'src/modules/vouchers/voucher-record-store.ts',
    'src/lib/time/clock.ts',
    'src/cli/data-directory.ts',
    'src/ui/primitives/text.ts',
  ])('importar node:sqlite en %s es error', async (file) => {
    const { paths, severity } = await sqliteRestrictions(file);

    expect(severity).toBe(ERROR);
    expect(paths).toEqual([expect.objectContaining({ message: expect.stringContaining('sqlite-driver') })]);
  });

  it('el driver puede importarlo', async () => {
    expect((await sqliteRestrictions(DRIVER)).paths).toEqual([]);
  });

  it('los tests pueden mirar la base con node:sqlite', async () => {
    const { paths } = await sqliteRestrictions('src/services/data/__tests__/vouchers-schema.test.ts');

    expect(paths).toEqual([]);
  });

  // La regla de siempre: el núcleo no conoce los adaptadores, tampoco src/services/data.
  it.each(['src/modules/local-data/local-data-files.ts', 'src/modules/vouchers/voucher-record-store.ts'])(
    '%s no puede importar src/services/data',
    async (file) => {
      const [severity, options] = (await eslint.calculateConfigForFile(file)).rules['no-restricted-imports'];
      const services = (options.patterns ?? []).filter(
        ({ regex }) => regex && new RegExp(regex).test('../../services/data/sqlite-driver'),
      );

      expect(severity).toBe(ERROR);
      expect(services).not.toEqual([]);
    },
  );
});

describe('reglas del SQL desde el día 1 (ARQ-12, diseno-arq-12-esquema.md)', () => {
  // Columnas siempre nombradas, nunca pisar ni borrar filas, nada que dependa de SQLite y no pase a Postgres.
  const FORBIDDEN = [
    ['SELECT *', /select\s+(\w+\.)?\*/i],
    ['INSERT sin columnas', /insert\s+into\s+\w+\s+values/i],
    ['INSERT OR REPLACE', /insert\s+or\s+replace/i],
    ['REPLACE INTO', /replace\s+into/i],
    ['INSERT OR IGNORE', /insert\s+or\s+ignore/i],
    ['DELETE', /delete\s+from/i],
    ['triggers', /create\s+trigger/i],
    ['vistas', /create\s+view/i],
    ['columnas generadas', /generated\s+always/i],
    ['AUTOINCREMENT', /autoincrement/i],
  ];

  /** El código sin comentarios: un comentario que dice "nunca INSERT OR REPLACE" no es usarlo. */
  const code = (file) =>
    readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it.each(FORBIDDEN)('ningún archivo de src/services/data usa %s', (_name, pattern) => {
    const offending = sourceFiles(DATA).filter((file) => pattern.test(code(file)));

    expect(offending).toEqual([]);
  });
});
