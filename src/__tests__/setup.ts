import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, vi } from 'vitest';

import { assertConfigIsolated } from './config-isolation';

// Ningun test toca la config real ni depende de la terminal de quien corre la suite: con FORCE_COLOR, TERM=dumb o
// ARCLI_ASCII en el entorno, las salidas esperadas cambian. Tampoco del gestor con que se corre (`yarn test` define
// npm_config_user_agent y el comando para actualizar saldria con yarn).
const home = mkdtempSync(join(tmpdir(), 'arcli-test-'));

process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.APPDATA = join(home, 'AppData', 'Roaming');
process.env.XDG_CONFIG_HOME = join(home, '.config');
// HOME solo no alcanza: `env-paths` (lo usa Conf) toma la carpeta de `os.homedir()` al cargarse, y en un worker
// thread `os.homedir()` no ve el `process.env` del worker. ARCLI_CONFIG_DIR se lee en cada `new ConfigService()`
// (y en los stores de monotributo y del aviso de version), asi que vale con cualquier pool (TEST-14).
process.env.ARCLI_CONFIG_DIR = join(home, 'arcli');

delete process.env.FORCE_COLOR;
delete process.env.NO_COLOR;
delete process.env.ARCLI_ASCII;
delete process.env.TERM;
delete process.env.npm_config_user_agent;

// Antes de cualquier test: si la config o los tickets se resuelven fuera del temporal, la suite falla aca. Import
// dinamico y resetModules para que los `vi.mock` de config.service de cada archivo de tests sigan aplicando.
const { resolveConfigLocation } = await import('../modules/config/config.service');

assertConfigIsolated(home, resolveConfigLocation());
vi.resetModules();

afterAll(() => {
  rmSync(home, { force: true, recursive: true });
});
