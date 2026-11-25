import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Donde guarda ARCLI sus datos: con `ARCLI_CONFIG_DIR` y sin ella. Sin la variable se usa la carpeta de siempre, asi
 * que cada corrida va en un proceso aparte con la carpeta del usuario apuntando a una temporal.
 */
const CLI = resolve('dist/cli/index.js');

let root: string;
let home: string;
let workingDirectory: string;

beforeEach(() => {
  // macOS resuelve /var a /private/var en el `cwd` del proceso.
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'arcli-e2e-carpeta-')));
  home = mkdtempSync(join(root, 'home-'));
  workingDirectory = mkdtempSync(join(root, 'trabajo-'));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** Sin la `ARCLI_CONFIG_DIR` de quien corre la suite: cada test la define o no. */
function isolatedEnv(configDirectory: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APPDATA: join(home, 'AppData', 'Roaming'),
    FORCE_COLOR: '0',
    HOME: home,
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    NO_UPDATE_NOTIFIER: '1',
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, '.config'),
  };

  delete env.ARCLI_CONFIG_DIR;

  return configDirectory === undefined ? env : { ...env, ARCLI_CONFIG_DIR: configDirectory };
}

function run(configDirectory: string | undefined, ...args: string[]): string {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: workingDirectory,
    encoding: 'utf8',
    env: isolatedEnv(configDirectory),
    timeout: 30_000,
  });

  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);

  return result.stdout.trim();
}

/** La carpeta que eligio `conf` desde la primera version: cambiarla deja a cada usuario sin su config. */
function usualDirectory(): string {
  if (process.platform === 'darwin') return join(home, 'Library', 'Preferences', 'arcli');
  if (process.platform === 'win32') return join(home, 'AppData', 'Roaming', 'arcli', 'Config');

  return join(home, '.config', 'arcli');
}

describe('la carpeta de datos', () => {
  it.each([
    ['sin la variable', undefined],
    ['con la variable vacía', ''],
    ['con la variable en blanco', '   '],
  ])('%s, es la de siempre', (_name, variable) => {
    expect(run(variable, 'config', 'ruta')).toBe(join(usualDirectory(), 'config.json'));
    run(variable, 'config', 'establecer', 'puntoVenta', '7');
    expect(JSON.parse(readFileSync(join(usualDirectory(), 'config.json'), 'utf8'))).toMatchObject({
      puntoVentaPorDefecto: 7,
    });
    expect(readdirSync(usualDirectory())).toEqual(['config.json']);
  });

  it('con una ruta absoluta que no existe, la crea y no toca la de siempre', () => {
    const directory = join(root, 'no', 'existe');

    expect(run(` ${directory} `, 'config', 'ruta')).toBe(join(directory, 'config.json'));
    expect(readdirSync(directory)).toEqual(['config.json']);
    expect(existsSync(usualDirectory())).toBe(false);
  });

  it('con una ruta relativa, sale de la carpeta donde se corre', () => {
    const directory = join(workingDirectory, 'datos');

    expect(run('datos', 'config', 'ruta')).toBe(join(directory, 'config.json'));
    expect(existsSync(join(directory, 'config.json'))).toBe(true);
    expect(existsSync(usualDirectory())).toBe(false);
  });

  it('lee lo que guardó una versión anterior en la de siempre', () => {
    run(undefined, 'config', 'ruta');
    writeFileSync(
      join(usualDirectory(), 'config.json'),
      JSON.stringify({ comprobantesPorLista: 20, cuit: '20409509763' }),
    );

    expect(JSON.parse(run(undefined, 'config', '--json'))).toMatchObject({ cuit: '20409509763', filasPorLista: 20 });
  });

  it.skipIf(process.platform === 'win32')('la carpeta y el archivo que crea son solo del usuario', () => {
    run(undefined, 'config', 'establecer', 'puntoVenta', '7');

    expect(statSync(usualDirectory()).mode & 0o777).toBe(0o700);
    expect(statSync(join(usualDirectory(), 'config.json')).mode & 0o777).toBe(0o600);
  });
});
