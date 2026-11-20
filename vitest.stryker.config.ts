import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';

import base from './vitest.config';

// Solo para scripts/agent/stryker.mjs, la única forma permitida de correr Stryker (ver ese archivo).
if (process.env.ARCLI_STRYKER_AISLADO !== '1') {
  throw new Error('Stryker se corre solo con `node scripts/agent/stryker.mjs`: aísla la config real de ARCLI.');
}

export default mergeConfig(
  base,
  defineConfig({
    test: {
      // public-contract busca los códigos de error como texto en src/, y en el código instrumentado no están literales.
      exclude: [...configDefaults.exclude, '.claude/worktrees/**', '.stryker-tmp/**', 'src/cli/__tests__/public-contract.test.ts'],
      pool: 'forks',
    },
  }),
);
