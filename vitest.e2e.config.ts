import { defineConfig } from 'vitest/config';

// `yarn test:e2e`: corre el `dist/` compilado, asi que va despues de `yarn build`. No usa el setup de los tests
// unitarios: cada test arma su propia carpeta de config.
export default defineConfig({
  test: {
    include: ['src/**/*.e2e.ts'],
    // Procesos, como `yarn test`: cada test pasa ARCLI_CONFIG_DIR al `arcli` que lanza, pero sin threads nada del
    // runner depende de que `os.homedir()` vea el entorno del worker (TEST-14).
    pool: 'forks',
    testTimeout: 120_000,
  },
});
