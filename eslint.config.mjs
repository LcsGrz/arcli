import eslintJS from '@eslint/js';
import eslintJSON from '@eslint/json';
import tsParser from '@typescript-eslint/parser';
import { defineConfig, globalIgnores } from 'eslint/config';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import eslintTS from 'typescript-eslint';

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
