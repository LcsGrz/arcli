import { defineConfig } from 'vitest/config';

// `yarn test:e2e`: corre el `dist/` compilado, asi que va despues de `yarn build`. No usa el setup de los tests
// unitarios: cada test arma su propia carpeta de config.
export default defineConfig({
  test: {
    include: ['src/**/*.e2e.ts'],
    testTimeout: 120_000,
  },
});
