import { defineConfig } from 'vitest/config';

// `yarn test:arca`: el `dist/` compilado contra ARCA testing, con tu config. Solo local; ver el archivo de tests.
export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['src/**/*.arca.ts'],
    testTimeout: 180_000,
  },
});
