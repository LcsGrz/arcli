import eslintJS from '@eslint/js';
import eslintJSON from '@eslint/json';
import tsParser from '@typescript-eslint/parser';
import { defineConfig, globalIgnores } from 'eslint/config';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
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

export default defineConfig([
  // =========================
  // Global ignores
  // =========================
  globalIgnores(['**/node_modules', '**/dist', '**/.next']),

  // =========================
  // JavaScript/TypeScript files
  // =========================
  {
    files: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.ts', '**/*.tsx'],
    extends: [eslintJS.configs.recommended, eslintTS.configs.recommended, eslintPluginPrettierRecommended],
    languageOptions: {
      parser: tsParser,
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
            ['^react$', '^@react-', '^react-', '^[^.]'],
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
  // Capas (docs/architecture.md) y colores y paneles solo desde src/ui (docs/design-system.md)
  // =========================
  {
    files: ['src/**/*.ts'],
    ignores: ['src/ui/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: UI_STYLE_IMPORTS }],
    },
  },
  {
    files: ['src/lib/**/*.ts', 'src/modules/**/*.ts', 'src/services/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: UI_STYLE_IMPORTS,
          patterns: [
            {
              regex: '(^|/)ui$',
              message: 'El barrel src/ui reexporta todo: importá de src/ui/primitives, components, presenters, stream o theme.',
            },
          ],
        },
      ],
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
