// Regenera src/cli/__tests__/public-contract.txt desde el código: corre el test del contrato en modo actualizar.
import { spawnSync } from 'node:child_process';

const result = spawnSync('vitest', ['run', 'src/cli/__tests__/public-contract.test.ts'], {
  env: { ...process.env, ARCLI_ACTUALIZAR_CONTRATO: '1' },
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
