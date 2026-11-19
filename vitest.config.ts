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
      // Los globales, lo medido redondeado hacia abajo (19/11/2026, TEST-9: 89,2 ramas, 96,3 funciones, 95,2 líneas y
      // 95,1 sentencias); billing, unos 2 puntos debajo (16/11/2026: 88, 99 y 94). Así una baja se nota. Si la
      // cobertura sube, subilos.
      thresholds: {
        branches: 89,
        functions: 96,
        lines: 95,
        statements: 95,
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
