import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** El `arcli` compilado que corren los `*.arca.ts`. */
export const ARCA_CLI = resolve('dist/cli/index.js');

/**
 * El chequeo con el que arranca cada `*.arca.ts`: fuera del CI, con `dist/` compilado, la config en `testing` y el
 * certificado de testing configurado. Si algo falta, falla con el motivo antes de llamar a ARCA (y antes de emitir).
 * Solo mira si las claves están, nunca su contenido: `config --json` ya enmascara las rutas.
 */
export function assertArcaTestingReady(): void {
  if (process.env.CI) {
    throw new Error('Los tests contra ARCA no corren en el CI: usan tu certificado de testing.');
  }

  if (!existsSync(ARCA_CLI)) {
    throw new Error('No está dist/cli/index.js: corré `yarn build` antes de `yarn test:arca`.');
  }

  const result = spawnSync(process.execPath, [ARCA_CLI, 'config', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_UPDATE_NOTIFIER: '1' },
    timeout: 30_000,
  });

  if (result.status !== 0) {
    throw new Error(`\`arcli config --json\` falló: ${result.stderr || result.stdout}`);
  }

  const config = JSON.parse(result.stdout) as {
    readonly cert?: Record<string, unknown>;
    readonly entorno?: string;
    readonly key?: Record<string, unknown>;
  };

  if (config.entorno !== 'testing') {
    throw new Error(`La config de arcli no está en testing (entorno: ${String(config.entorno)}): no se llama a ARCA.`);
  }

  const missing = [config.cert?.testing ? undefined : 'cert.testing', config.key?.testing ? undefined : 'key.testing']
    .filter((key): key is string => Boolean(key))
    .join(' y ');

  if (missing) {
    throw new Error(
      `Falta ${missing} en la config de arcli: los tests contra ARCA usan tu certificado de testing. Revisá \`arcli config revisar\`.`,
    );
  }
}
