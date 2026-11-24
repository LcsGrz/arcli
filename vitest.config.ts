import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Los worktrees de revisión y los sandbox de Stryker viven adentro del repo y traen su propia copia de los tests.
    exclude: [...configDefaults.exclude, '.claude/worktrees/**', '.stryker-tmp/**'],
    // Procesos, no worker threads: en un thread, el HOME que fija el setup no cambia `os.homedir()` y Conf (via
    // env-paths) apuntaria a la config real. Lo dejamos explicito por si el default de vitest o de quien lo corre
    // (el runner de Stryker usa threads) cambia; el setup igual fija ARCLI_CONFIG_DIR y lo controla (TEST-14).
    pool: 'forks',
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      exclude: ['src/**/__tests__/**', 'src/testing/**', 'src/modules/storybook/**'],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Un punto debajo de lo medido, redondeado hacia abajo, para que una baja se note sin que la diferencia entre
      // sistemas operativos rompa el CI (19/11/2026, TEST-9: 91,5 ramas, 96,7 funciones, 96,2 líneas y 96,2
      // sentencias; billing 90,6, 99,2, 96,5 y 96,6). Si la cobertura sube, subilos.
      thresholds: {
        branches: 90,
        functions: 95,
        lines: 95,
        statements: 95,
        'src/modules/billing/**': {
          branches: 89,
          functions: 98,
          lines: 95,
          statements: 95,
        },
      },
    },
  },
});
