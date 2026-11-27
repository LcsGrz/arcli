import eslintJS from '@eslint/js';
import eslintJSON from '@eslint/json';
import { defineConfig, globalIgnores } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import eslintTS from 'typescript-eslint';

import { dataDirectoryRule } from './scripts/lint/data-directory-rule.mjs';

const UI_STYLE_IMPORTS = [
  { name: 'boxen', message: 'Usá los paneles de src/ui.' },
  ...['node:util', 'util'].map((name) => ({
    name,
    importNames: ['styleText'],
    message: 'Usá colorize o bold de src/ui, con un token de color.',
  })),
];

/** Solo `services/` conoce `@arcasdk/core` (docs/architecture.md); sus tipos, en un solo archivo de `services/arca`. */
const SDK_TYPES_FILE = 'src/services/arca/arca-sdk.types.ts';
const SDK_OUTSIDE_SERVICES = {
  regex: '^@arcasdk/core(/|$)',
  message: 'Solo src/services conoce @arcasdk/core: usá los tipos propios de modules o ArcaClient.',
};
const SDK_TYPES_OUTSIDE_ARCA = {
  regex: '(^|/)arca-sdk\\.types$',
  message:
    'Los tipos del SDK no salen de src/services/arca: usá los propios (VoucherRequest, AuthorizationAnswer, ExportVoucherPayload) o ArcaClient, de arca-client.factory.',
};
const TESTING_OUTSIDE_TESTS = {
  regex: '(^|/)testing/',
  message: 'src/testing es solo para los tests: no entra en el build.',
};
const SDK_INTERNAL_PATHS = {
  regex: '^@arcasdk/core/lib/',
  message:
    'Las rutas internas del SDK cambian sin aviso: sumá el tipo a src/services/arca/arca-sdk.types e importalo de ahí.',
};
const UI_BARREL = {
  regex: '(^|/)ui$',
  message: 'El barrel src/ui reexporta todo: importá de src/ui/primitives, components, presenters, stream o theme.',
};

// =========================
// Fronteras del núcleo (docs/architecture.md, "Núcleo y adaptadores"): `modules` y `lib` no saben quién los llama.
// Lo que ya se cumple es error: `no-restricted-imports` (también `node:fs` y `conf`), `no-restricted-syntax` (el reloj)
// y `no-restricted-globals` (`process`). El reloj, `process`, `node:fs` y `conf` siguen en warn en los módulos de la app
// (ARQ-7).
// Lo que hoy falla es deuda en warn, con el ticket que la cierra
// (`@typescript-eslint/no-restricted-imports`): no es un patrón para copiar. Cuando el ticket se cierra, la frontera
// pasa al bloque de error.
// =========================
const CORE_FILES = ['src/lib/**/*.ts', 'src/modules/**/*.ts'];
const TEST_FILES = ['src/**/__tests__/**/*.ts', 'src/**/*.test.ts'];
/** Lo que puede importar src/testing. */
const TESTING_USERS = [...TEST_FILES, 'src/testing/**', 'src/**/*.arca.ts'];
/**
 * ARQ-12: SQLite se carga en un solo archivo, que oculta el aviso de Node 22 y es lo único que cambia si cambia el
 * driver. Los tests pueden mirar la base con node:sqlite. No ve `import()` ni `getBuiltinModule`: eso lo busca
 * scripts/lint/__tests__/sqlite-boundary.test.mjs en el texto.
 */
const SQLITE_DRIVER = 'src/services/data/sqlite-driver.ts';
const SQLITE_OUTSIDE_DRIVER = {
  name: 'node:sqlite',
  message: `SQLite se abre solo desde ${SQLITE_DRIVER} (loadSqliteDriver): ahí se oculta el aviso de Node 22.`,
};
/**
 * Los imports prohibidos de una capa y, salvo en los tests, también los de src/testing y node:sqlite. `driver` es el
 * archivo de la capa que sí carga SQLite: en flat config las opciones de la regla se reemplazan, no se suman, así que
 * va en su propio bloque con todo lo demás.
 */
const layerImports = ({ files, ignores = [], paths = [], patterns, driver }) => {
  const outsideTests = { paths, patterns: [...patterns, TESTING_OUTSIDE_TESTS] };

  return [
    { files, ignores, rules: { 'no-restricted-imports': ['error', { paths, patterns }] } },
    {
      files,
      ignores: [...ignores, ...TESTING_USERS],
      rules: {
        'no-restricted-imports': ['error', { ...outsideTests, paths: [...paths, SQLITE_OUTSIDE_DRIVER] }],
      },
    },
    ...(driver ? [{ files: [driver], rules: { 'no-restricted-imports': ['error', outsideTests] } }] : []),
  ];
};
/** Módulos que son de la app CLI y no del núcleo: ARQ-7 los muda a la app. Mientras, su deuda dice ARQ-7. */
const APP_MODULES = ['completion', 'desktop-shortcut', 'examples', 'storybook', 'update-check'].map(
  (name) => `src/modules/${name}/**/*.ts`,
);
const APP_MODULE_MESSAGE = 'Es un módulo de la app CLI dentro del núcleo: lo muda a la app ARQ-7. No copies el patrón.';

// --- Ya se cumplen: error ---
const CORE_ON_CLI = {
  regex: '(^|/)cli(/|$)',
  message:
    'El núcleo no conoce a quién lo llama: mové lo que necesitás de src/cli a modules o lib, o recibilo como parámetro.',
};
const CORE_ON_SERVICES = {
  regex: '(^|/)services(/|$)',
  message:
    'El núcleo no conoce los adaptadores: usá tipos propios y recibí el gateway como dependencia; la traducción a los tipos del SDK vive en src/services/arca.',
};
const CORE_ON_PROMPTS = {
  regex: '^@inquirer/',
  message: 'Las preguntas son de la app CLI (src/cli/interactive): el núcleo recibe las respuestas como datos.',
};
const CORE_ON_FS = ['node:fs', 'node:fs/promises', 'fs', 'fs/promises'].map((name) => ({
  name,
  message:
    'El núcleo no lee ni escribe archivos: recibí el contenido, o un puerto (LocalFiles, CertificateStore, TicketStore) como dependencia; el adaptador va en src/services/files.',
}));
const CORE_ON_CONF = {
  name: 'conf',
  message:
    'El núcleo no abre archivos de la carpeta de datos: usá el puerto ConfigStore (src/modules/config/config-store.ts); el adaptador sobre `conf` va en src/services/files.',
};
const CORE_ON_APP_LIBS = [
  { name: 'commander', message: 'El parseo de flags es de la app CLI: el núcleo recibe la entrada ya parseada.' },
  {
    name: 'ora',
    message: 'Los spinners son de la app CLI: el núcleo devuelve una promesa y la app decide cómo mostrar la espera.',
  },
];

const NOW_MESSAGE =
  'El núcleo no lee el reloj: recibí la fecha como parámetro o el puerto Clock (docs/architecture.md, "Núcleo y adaptadores").';
const NOW_SELECTORS = [
  "NewExpression[callee.name='Date'][arguments.length=0]",
  // Tambien sin llamarla, como `now = Date.now`.
  "MemberExpression[object.name='Date'][property.name='now']",
];
/** Las lecturas del reloj: error en el núcleo, warn de ARQ-7 en los módulos de la app. */
const noClockReads = (severity, message) => [severity, ...NOW_SELECTORS.map((selector) => ({ selector, message }))];

const PROCESS_MESSAGE =
  'El núcleo no lee el proceso (process.env, argv, cwd, platform, stdout, exit): recibilo como parámetro desde la app.';
/** `process`, el global y el módulo: error en el núcleo, warn donde es deuda con ticket. */
const noProcessGlobal = (severity, message) => ({
  'no-restricted-globals': [severity, { name: 'process', message }],
});
const processModule = (message) => ['node:process', 'process'].map((name) => ({ name, message }));

const SERVICES_ON_CLI = {
  regex: '(^|/)cli(/|$)',
  message: 'services no conoce a src/cli: recibí lo ya resuelto (entorno, opciones de salida) como parámetro.',
};

// --- Deuda: warn, con su ticket ---
const CORE_ON_UI = {
  regex: '(^|/)ui/',
  message:
    'El núcleo devuelve datos, no texto de pantalla: el presenter va en la app CLI y el módulo le pasa los datos. Lo cierra ARQ-7.',
};
/** Las reglas de deuda del núcleo; en los módulos de la app, todas con el mensaje de ARQ-7. */
const coreDebtRules = ({ message, extraPaths = [] } = {}) => {
  const withMessage = (entries) => entries.map((entry) => ({ ...entry, message: message ?? entry.message }));
  return {
    '@typescript-eslint/no-restricted-imports': [
      'warn',
      {
        paths: extraPaths,
        patterns: withMessage([CORE_ON_UI]),
      },
    ],
  };
};

/** Los imports del núcleo que son error. */
const coreImportRules = (extraPaths = []) => ({
  'no-restricted-imports': [
    'error',
    {
      paths: [...UI_STYLE_IMPORTS, ...CORE_ON_APP_LIBS, SQLITE_OUTSIDE_DRIVER, ...extraPaths],
      patterns: [
        UI_BARREL,
        SDK_OUTSIDE_SERVICES,
        SDK_TYPES_OUTSIDE_ARCA,
        TESTING_OUTSIDE_TESTS,
        CORE_ON_CLI,
        CORE_ON_SERVICES,
        CORE_ON_PROMPTS,
      ],
    },
  ],
});

export default defineConfig([
  // =========================
  // Global ignores
  // =========================
  globalIgnores(['**/node_modules', '**/dist', 'coverage', 'reports', '.stryker-tmp', '.claude/worktrees']),

  // =========================
  // JavaScript/TypeScript files
  // =========================
  {
    files: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.mts', '**/*.ts', '**/*.tsx'],
    // El formato lo controla Prettier por su lado (`yarn lint:prettier` y lint-staged): eslint-config-prettier solo
    // apaga las reglas de ESLint que chocan con él.
    extends: [eslintJS.configs.recommended, eslintTS.configs.recommended, eslintConfigPrettier],
    languageOptions: {
      parser: eslintTS.parser,
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      // --- TypeScript ---
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-inferrable-types': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // --- ESLint base ---
      'prefer-template': 'error',
      'template-curly-spacing': 'error',
      'no-else-return': 'error',
      'no-param-reassign': 'error',
      'no-unused-vars': 'off', // Desactivado para usar la versión TS
      // --- Import sorting ---
      'simple-import-sort/exports': 'error',
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            // Side effect imports
            ['^\u0000'],
            // Vendors
            ['^[^.]'],
            // Absolute and relative imports
            ['^.'],
            // Project: back imports
            ['^../'],
            // Project: inner imports
            ['^./'],
          ],
        },
      ],
    },
  },

  // =========================
  // Lint con tipos, solo en src/ (los .mjs de scripts/ y site/ no están en ningún tsconfig).
  // tsconfig.typecheck.json incluye los tests; tsconfig.json los excluye.
  // =========================
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        // `project` y no `projectService`: el servicio usa el tsconfig.json más cercano, que deja afuera los tests.
        project: './tsconfig.typecheck.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Con verbatimModuleSyntax, `import { type A } from './a'` deja `import {} from './a'` en dist: un import que
      // carga el módulo sin usarlo. `import type { A }` lo borra entero.
      '@typescript-eslint/no-import-type-side-effects': 'error',
      // Una promesa sin await ni catch se pierde: su error no llega a reportCliError ni al exit code.
      '@typescript-eslint/no-floating-promises': 'error',
      // Un caso nuevo de una unión (un tipo de comprobante, un estado) tiene que fallar donde no se maneja, también
      // si el switch tiene `default` (considerDefaultExhaustiveForUnions: false): nombrá cada caso en vez de taparlo
      // con `default`. Si el `default` es la respuesta correcta para todo lo demás (un `typeof`, el sistema
      // operativo), desactivala en esa línea con el motivo.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },

  // =========================
  // Largo de archivo, sin contar líneas en blanco ni comentarios (los comentarios del porqué no se castigan).
  // max-lines no deja cambiar el mensaje. Para arreglarlo, partí el archivo por responsabilidad (código) o por
  // comportamiento (tests). Lo cierran ARQ-8 (código) y ARQ-6 (tests).
  // =========================
  {
    files: ['src/**/*.ts'],
    ignores: TEST_FILES,
    rules: { 'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }] },
  },
  {
    files: TEST_FILES,
    rules: { 'max-lines': ['warn', { max: 800, skipBlankLines: true, skipComments: true }] },
  },

  // =========================
  // Capas (docs/architecture.md) y colores y paneles solo desde src/ui (docs/design-system.md)
  // =========================
  ...layerImports({
    files: ['src/**/*.ts'],
    ignores: ['src/ui/**', 'src/services/**'],
    paths: UI_STYLE_IMPORTS,
    patterns: [SDK_OUTSIDE_SERVICES, SDK_TYPES_OUTSIDE_ARCA],
  }),
  // En el asistente, toda espera a ARCA va por `waitForArca` (arca-wait.ts), que ataja Ctrl+C (ARQ-11): el spinner no
  // se importa directo, asi una espera nueva no queda sin Ctrl+C. Las excepciones esperan a npm, no a ARCA, y Ctrl+C
  // ahi corta como siempre: config.flow.ts (instalar el plugin de PDF) y update.flow.ts (las novedades de la version).
  ...layerImports({
    files: ['src/cli/interactive/**/*.ts'],
    ignores: [
      'src/ui/**',
      'src/services/**',
      'src/cli/interactive/arca-wait.ts',
      'src/cli/interactive/config.flow.ts',
      'src/cli/interactive/update.flow.ts',
      ...TEST_FILES,
    ],
    paths: UI_STYLE_IMPORTS,
    patterns: [
      SDK_OUTSIDE_SERVICES,
      SDK_TYPES_OUTSIDE_ARCA,
      {
        regex: '(^|/)(pending-)?spinner$',
        message: 'En el asistente, las esperas a ARCA van con `waitForArca` (arca-wait.ts), que ataja Ctrl+C (ARQ-11).',
      },
    ],
  }),
  ...layerImports({
    files: CORE_FILES,
    paths: UI_STYLE_IMPORTS,
    patterns: [UI_BARREL, SDK_OUTSIDE_SERVICES, SDK_TYPES_OUTSIDE_ARCA],
  }),
  {
    // Fronteras del núcleo, sin tests: los tests pueden armar el caso con lo que necesiten.
    files: CORE_FILES,
    ignores: TEST_FILES,
    rules: {
      ...coreImportRules([...CORE_ON_FS, CORE_ON_CONF, ...processModule(PROCESS_MESSAGE)]),
      ...noProcessGlobal('error', PROCESS_MESSAGE),
      'no-restricted-syntax': noClockReads('error', NOW_MESSAGE),
      ...coreDebtRules(),
    },
  },
  {
    files: APP_MODULES,
    ignores: TEST_FILES,
    rules: {
      'no-restricted-syntax': noClockReads('warn', APP_MODULE_MESSAGE),
      ...coreImportRules(),
      ...noProcessGlobal('warn', APP_MODULE_MESSAGE),
      ...coreDebtRules({
        message: APP_MODULE_MESSAGE,
        extraPaths: [
          ...[CORE_ON_CONF, ...CORE_ON_FS].map((entry) => ({ ...entry, message: APP_MODULE_MESSAGE })),
          ...processModule(APP_MODULE_MESSAGE),
        ],
      }),
    },
  },
  {
    // La carpeta de datos siempre explícita: cada excepción habilita solo lo suyo.
    files: ['src/**/*.ts', 'scripts/**/*.{ts,mts}'],
    ignores: TESTING_USERS,
    plugins: { arcli: { rules: { 'data-directory': dataDirectoryRule } } },
    rules: { 'arcli/data-directory': 'error' },
  },
  {
    files: ['src/cli/config-service.ts'],
    rules: { 'arcli/data-directory': ['error', { opensConfig: true }] },
  },
  {
    files: ['src/cli/data-directory.ts'],
    rules: { 'arcli/data-directory': ['error', { resolvesDirectory: true }] },
  },
  ...layerImports({
    files: ['src/services/**/*.ts'],
    ignores: ['src/services/arca/**'],
    paths: UI_STYLE_IMPORTS,
    patterns: [UI_BARREL, SDK_INTERNAL_PATHS, SDK_TYPES_OUTSIDE_ARCA, SERVICES_ON_CLI],
    driver: SQLITE_DRIVER,
  }),
  ...layerImports({
    files: ['src/services/arca/**/*.ts'],
    ignores: [SDK_TYPES_FILE],
    paths: UI_STYLE_IMPORTS,
    patterns: [UI_BARREL, SDK_INTERNAL_PATHS, SERVICES_ON_CLI],
  }),
  ...layerImports({
    files: [SDK_TYPES_FILE],
    paths: UI_STYLE_IMPORTS,
    patterns: [UI_BARREL, SERVICES_ON_CLI],
  }),
  ...layerImports({
    files: ['src/ui/**/*.ts'],
    patterns: [
      {
        regex: '/(cli|modules|services)(/|$)',
        message: 'La UI no conoce el dominio: recibí los datos ya armados (ver docs/architecture.md).',
      },
    ],
  }),

  // =========================
  // Scripts en Node: los de sync-docs (site/) y los del repo (scripts/). Los componentes .astro no pasan por ESLint
  // =========================
  {
    files: ['site/scripts/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        AbortSignal: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
      },
    },
  },

  // =========================
  // JSON, JSONC, JSON5 configs
  // =========================
  {
    files: ['**/*.json'],
    ignores: ['package-lock.json'],
    plugins: { json: eslintJSON },
    language: 'json/json',
    extends: ['json/recommended'],
  },
  {
    files: ['**/*.jsonc'],
    plugins: { json: eslintJSON },
    language: 'json/jsonc',
    extends: ['json/recommended'],
  },
  {
    files: ['**/*.json5'],
    plugins: { json: eslintJSON },
    language: 'json/json5',
    extends: ['json/recommended'],
  },
]);
