import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: ['src/**/__tests__/**', 'src/modules/storybook/**'],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        branches: 60,
        functions: 60,
        lines: 60,
        statements: 60,
        'src/modules/billing/**': {
          branches: 65,
          functions: 80,
          lines: 75,
          statements: 75,
        },
      },
    },
  },
});
