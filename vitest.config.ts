import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Los worktrees de revisión viven adentro del repo y traen su propia copia de los tests.
    exclude: [...configDefaults.exclude, '.claude/worktrees/**'],
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      exclude: ['src/**/__tests__/**', 'src/modules/storybook/**'],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Unos 2 puntos debajo de lo medido (16/11/2026: 83 ramas, 93 funciones, 91 líneas; billing 88, 99 y 94), para
      // que una baja se note. Si la cobertura sube, subilos.
      thresholds: {
        branches: 81,
        functions: 91,
        lines: 88,
        statements: 88,
        'src/modules/billing/**': {
          branches: 86,
          functions: 97,
          lines: 92,
          statements: 92,
        },
      },
    },
  },
});
