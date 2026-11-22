import eslintJS from '@eslint/js';
import eslintJSON from '@eslint/json';
import { defineConfig, globalIgnores } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import eslintTS from 'typescript-eslint';

const UI_STYLE_IMPORTS = [
  { name: 'boxen', message: 'Usá los paneles de src/ui.' },
  ...['node:util', 'util'].map((name) => ({
    name,
    importNames: ['styleText'],
    message: 'Usá colorize o bold de src/ui, con un token de color.',
  })),
];

/** Solo `services/` conoce `@arcasdk/core` (docs/architecture.md): el resto importa los tipos de un solo archivo. */
const SDK_TYPES_FILE = 'src/services/arca/arca-sdk.types.ts';
const SDK_OUTSIDE_SERVICES = {
  regex: '^@arcasdk/core(/|$)',
  message: 'Solo src/services conoce @arcasdk/core: importá los tipos de src/services/arca/arca-sdk.types.',
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
// Lo que ya se cumple es error (`no-restricted-imports`). Lo que hoy falla es deuda en warn, con el ticket que la
// cierra (`@typescript-eslint/no-restricted-imports`, `no-restricted-globals`, `no-restricted-syntax`): no es un
// patrón para copiar. Cuando el ticket se cierra, la frontera pasa al bloque de error.
// =========================
const CORE_FILES = ['src/lib/**/*.ts', 'src/modules/**/*.ts'];
const TEST_FILES = ['src/**/__tests__/**/*.ts', 'src/**/*.test.ts'];
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
const CORE_ON_PROMPTS = {
  regex: '^@inquirer/',
  message: 'Las preguntas son de la app CLI (src/cli/interactive): el núcleo recibe las respuestas como datos.',
};
const CORE_ON_APP_LIBS = [
  { name: 'commander', message: 'El parseo de flags es de la app CLI: el núcleo recibe la entrada ya parseada.' },
  {
    name: 'ora',
    message: 'Los spinners son de la app CLI: el núcleo devuelve una promesa y la app decide cómo mostrar la espera.',
  },
];

// --- Deuda: warn, con su ticket ---
const SERVICES_ON_CLI = {
  regex: '(^|/)cli(/|$)',
  message:
    'services no conoce a src/cli: recibí lo ya resuelto (entorno, opciones de salida) como parámetro. Lo cierra REV-48.',
};
const CORE_ON_SERVICES = {
  regex: '(^|/)services(/|$)',
  message:
    'El núcleo no conoce los adaptadores: usá tipos propios y recibí el gateway o el contexto como dependencia; la traducción a los tipos del SDK vive en src/services/arca. Lo cierran ARQ-4 (tipos del SDK) y REV-48 (contexto).',
};
const CORE_ON_UI = {
  regex: '(^|/)ui/',
  message:
    'El núcleo devuelve datos, no texto de pantalla: el presenter va en la app CLI y el módulo le pasa los datos. Lo cierra ARQ-7.',
};
const CORE_ON_CONF = {
  name: 'conf',
  message:
    'El almacenamiento de la config es un adaptador: recibí la config resuelta o un repositorio como dependencia. Lo cierra ARQ-12.',
};
const CORE_ON_FS = ['node:fs', 'node:fs/promises', 'fs', 'fs/promises'].map((name) => ({
  name,
  message:
    'El núcleo no lee ni escribe archivos: recibí el contenido, o un puerto (TicketStore, un repositorio) como dependencia. Lo cierran REV-48 (contexto y tickets) y ARQ-12 (datos locales).',
}));
const CORE_ON_PROCESS_MODULE = ['node:process', 'process'].map((name) => ({
  name,
  message:
    'El núcleo no lee el proceso: recibí el entorno, los argumentos o la salida como parámetro. Lo cierra REV-48.',
}));
const PROCESS_MESSAGE =
  'El núcleo no lee el proceso (process.env, argv, cwd, stdout, exit): recibilo como parámetro desde la app. Lo cierra REV-48.';
const NOW_MESSAGE =
  'El núcleo no lee el reloj: recibí la fecha como parámetro o el puerto Clock (docs/architecture.md, "Núcleo y adaptadores"). Lo cierra REV-48.';
const NOW_SELECTORS = [
  "NewExpression[callee.name='Date'][arguments.length=0]",
  "CallExpression[callee.object.name='Date'][callee.property.name='now']",
];

/** Arma las reglas de deuda del núcleo; en los módulos de la app, todas con el mensaje de ARQ-7. */
const coreDebtRules = (override) => {
  const msg = (message) => override ?? message;
  const withMessage = (entries) => entries.map((entry) => ({ ...entry, message: msg(entry.message) }));
  return {
    '@typescript-eslint/no-restricted-imports': [
      'warn',
      {
        paths: withMessage([CORE_ON_CONF, ...CORE_ON_FS, ...CORE_ON_PROCESS_MODULE]),
        patterns: withMessage([CORE_ON_SERVICES, CORE_ON_UI]),
      },
    ],
    'no-restricted-globals': ['warn', { name: 'process', message: msg(PROCESS_MESSAGE) }],
    'no-restricted-syntax': ['warn', ...NOW_SELECTORS.map((selector) => ({ selector, message: msg(NOW_MESSAGE) }))],
  };
};

export default defineConfig([
  // =========================
  // Global ignores
  // =========================
  globalIgnores(['**/node_modules', '**/dist', 'coverage', 'reports', '.stryker-tmp', '.claude/worktrees']),

  // =========================
  // JavaScript/TypeScript files
  // =========================
  {
    files: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.ts', '**/*.tsx'],
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
  {
    files: ['src/**/*.ts'],
    ignores: ['src/ui/**', 'src/services/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: UI_STYLE_IMPORTS, patterns: [SDK_OUTSIDE_SERVICES] }],
    },
  },
  {
    files: ['src/lib/**/*.ts', 'src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: UI_STYLE_IMPORTS, patterns: [UI_BARREL, SDK_OUTSIDE_SERVICES] }],
    },
  },
  {
    // Fronteras del núcleo, sin tests: los tests pueden armar el caso con lo que necesiten.
    files: CORE_FILES,
    ignores: TEST_FILES,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...UI_STYLE_IMPORTS, ...CORE_ON_APP_LIBS],
          patterns: [UI_BARREL, SDK_OUTSIDE_SERVICES, CORE_ON_CLI, CORE_ON_PROMPTS],
        },
      ],
      ...coreDebtRules(),
    },
  },
  {
    files: APP_MODULES,
    ignores: TEST_FILES,
    rules: coreDebtRules(APP_MODULE_MESSAGE),
  },
  {
    // Deuda en warn: la versión de typescript-eslint de la regla, porque `no-restricted-imports` ya está en error
    // en este archivo y una regla tiene una sola severidad.
    files: ['src/services/**/*.ts'],
    ignores: TEST_FILES,
    rules: {
      '@typescript-eslint/no-restricted-imports': ['warn', { patterns: [SERVICES_ON_CLI] }],
    },
  },
  {
    files: ['src/services/**/*.ts'],
    ignores: [SDK_TYPES_FILE],
    rules: {
      'no-restricted-imports': ['error', { paths: UI_STYLE_IMPORTS, patterns: [UI_BARREL, SDK_INTERNAL_PATHS] }],
    },
  },
  {
    files: [SDK_TYPES_FILE],
    rules: {
      'no-restricted-imports': ['error', { paths: UI_STYLE_IMPORTS, patterns: [UI_BARREL] }],
    },
  },
  {
    files: ['src/ui/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '/(cli|modules|services)(/|$)',
              message: 'La UI no conoce el dominio: recibí los datos ya armados (ver docs/architecture.md).',
            },
          ],
        },
      ],
    },
  },

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
