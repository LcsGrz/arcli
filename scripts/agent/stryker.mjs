#!/usr/bin/env node
// Corre Stryker (mutation testing) sin poder tocar la config real de quien lo corre. Es la única forma permitida:
// el 19/11/2026 una corrida directa pisó ~/Library/Preferences/arcli (borró cert y key, puso emitir en true).
//
//   node scripts/agent/stryker.mjs                    lo cambiado en src/ desde el último tag (antes de una release)
//   node scripts/agent/stryker.mjs --desde <ref>      lo cambiado desde <ref>
//   node scripts/agent/stryker.mjs src/modules/billing [más rutas]
//
// Opciones: --concurrencia <n> (4 por defecto), --con-estaticos (muta también lo que se evalúa al cargar el módulo).
//
// Aislamiento, en capas:
// 1. Todo el proceso corre con HOME, USERPROFILE, APPDATA, XDG_CONFIG_HOME y ARCLI_CONFIG_DIR temporales.
// 2. vitest con pool forks (vitest.stryker.config.ts): en threads el HOME temporal no cambia os.homedir().
// 3. El guard de src/__tests__/setup.ts falla si la config se resuelve fuera del temporal.
// 4. Un watchdog mira la carpeta de config real cada 3 s y mata a Stryker si cambia algo.
// Stryker no es dependencia del proyecto: se instala con versión fija en node_modules/.cache/arcli-stryker.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { clearInterval, setInterval } from 'node:timers';

const STRYKER_VERSION = '10.1.1';
const WATCH_INTERVAL_MS = 3000;
const root = resolve(import.meta.dirname, '..', '..');
const cacheDir = join(root, 'node_modules', '.cache', 'arcli-stryker');
const reportsDir = join(root, 'reports', 'stryker');

const options = parseArgs(process.argv.slice(2));
const mutate = mutateGlobs(options);
if (mutate.length === 0) {
  console.log('No hay archivos de src/ para mutar.');
  process.exit(0);
}

const realConfigDir = await resolveRealConfigDir();
installStryker();

const home = mkdtempSync(join(tmpdir(), 'arcli-stryker-home-'));
mkdirSync(reportsDir, { recursive: true });
const configPath = join(reportsDir, 'stryker.config.json');
writeFileSync(configPath, JSON.stringify(strykerConfig(mutate, options), null, 2));

const before = snapshot(realConfigDir);
console.log(`Mutando ${mutate.length} rutas. Config real vigilada: ${realConfigDir}`);

const child = spawn(join(cacheDir, 'node_modules', '.bin', 'stryker'), ['run', configPath], {
  cwd: root,
  detached: true,
  env: isolatedEnv(home),
  stdio: 'inherit',
});

let tampered = false;
const watchdog = setInterval(() => {
  if (snapshot(realConfigDir) === before) return;
  tampered = true;
  killTree();
}, WATCH_INTERVAL_MS);

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => killTree());

child.on('exit', (code) => {
  clearInterval(watchdog);
  rmSync(home, { force: true, recursive: true });
  // Si se cortó Stryker, sus sandbox quedan en .stryker-tmp con una copia de los tests.
  rmSync(join(root, '.stryker-tmp'), { force: true, recursive: true });
  if (tampered || snapshot(realConfigDir) !== before) {
    console.error(
      `\nLA CONFIG REAL CAMBIÓ (${realConfigDir}). Se cortó Stryker. Revisala antes de usar ARCLI: ` +
        'cert, key, ticketPath, emitir y archivos sueltos. No la arregles sin avisarle a quien mantiene el proyecto.',
    );
    process.exit(3);
  }
  console.log(
    `\nInforme: ${relative(root, join(reportsDir, 'mutation.html'))} y ${relative(root, join(reportsDir, 'mutation.json'))}`,
  );
  process.exit(code ?? 1);
});

function parseArgs(args) {
  const parsed = { concurrency: 4, paths: [], since: undefined, statics: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--desde') parsed.since = args[(index += 1)];
    else if (arg === '--concurrencia') parsed.concurrency = Number(args[(index += 1)]);
    else if (arg === '--con-estaticos') parsed.statics = true;
    else if (arg.startsWith('-')) fail(`Opción desconocida: ${arg}`);
    else parsed.paths.push(arg);
  }
  if (!Number.isInteger(parsed.concurrency) || parsed.concurrency < 1)
    fail('--concurrencia tiene que ser un entero positivo.');
  if (parsed.paths.length === 0 && !parsed.since) parsed.since = git('describe', '--tags', '--abbrev=0').trim();
  if (parsed.paths.length === 0 && !parsed.since) fail('No hay tags: pasá --desde <ref> o rutas.');
  return parsed;
}

function mutateGlobs({ paths, since }) {
  const excluded = ['!src/**/__tests__/**', '!src/testing/**', '!src/**/*.d.ts', '!src/modules/storybook/**'];
  if (paths.length > 0) {
    const globs = paths.map((path) => {
      const relativePath = relative(root, resolve(path));
      if (relativePath.startsWith('..') || !existsSync(join(root, relativePath))) fail(`No existe en el repo: ${path}`);
      return statSync(join(root, relativePath)).isDirectory() ? `${relativePath}/**/*.ts` : relativePath;
    });
    return [...globs, ...excluded];
  }
  console.log(`Lo cambiado en src/ desde ${since}.`);
  const files = git('diff', '--name-only', `${since}...HEAD`, '--', 'src/**/*.ts')
    .split('\n')
    .filter(
      (file) =>
        file &&
        !file.includes('/__tests__/') &&
        !file.startsWith('src/testing/') &&
        !file.endsWith('.d.ts') &&
        !file.startsWith('src/modules/storybook/'),
    )
    .filter((file) => existsSync(join(root, file)));
  return files;
}

function strykerConfig(mutate, { concurrency, statics }) {
  return {
    $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
    concurrency,
    disableTypeChecks: 'src/**/*.ts',
    ignoreStatic: !statics,
    // Lo que no hace falta copiar al sandbox (los worktrees y el sitio traen miles de archivos).
    ignorePatterns: ['.claude/worktrees', 'site', 'dist', 'coverage', 'reports'],
    incremental: true,
    incrementalFile: 'reports/stryker/incremental.json',
    jsonReporter: { fileName: 'reports/stryker/mutation.json' },
    htmlReporter: { fileName: 'reports/stryker/mutation.html' },
    mutate,
    reporters: ['clear-text', 'progress', 'json', 'html'],
    testRunner: 'vitest',
    thresholds: { break: null, high: 85, low: 70 },
    // El runner pisa el pool de la config de vitest: sin esto usa threads y el HOME temporal no cambia os.homedir().
    vitest: { configFile: 'vitest.stryker.config.ts', pool: 'forks' },
  };
}

function isolatedEnv(home) {
  const env = {
    ...process.env,
    APPDATA: join(home, 'AppData', 'Roaming'),
    ARCLI_CONFIG_DIR: join(home, 'arcli'),
    ARCLI_STRYKER_AISLADO: '1',
    HOME: home,
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, '.config'),
  };
  delete env.ZDOTDIR;
  return env;
}

// La carpeta que usaría ARCLI con el entorno real: la de ARCLI_CONFIG_DIR si quien corre la definió, o la de Conf.
async function resolveRealConfigDir() {
  const custom = process.env.ARCLI_CONFIG_DIR?.trim();
  if (custom) return resolve(custom);
  const { default: envPaths } = await import('env-paths');
  return envPaths('arcli', { suffix: '' }).config;
}

// Nombres, tamaños y contenido de todo lo que hay en la carpeta (no el mtime: Conf la reescribe igual al abrirla).
function snapshot(dir) {
  const hash = createHash('sha256');
  const walk = (current) => {
    if (!existsSync(current)) return hash.update(`sin:${current}`);
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const stats = statSync(path);
      hash.update(`${relative(dir, path)}:${stats.isDirectory() ? 'dir' : stats.size}`);
      if (stats.isDirectory()) walk(path);
      else if (stats.size < 1024 * 1024) hash.update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest('hex');
}

function installStryker() {
  const installed = join(cacheDir, 'node_modules', '@stryker-mutator', 'core', 'package.json');
  if (existsSync(installed) && JSON.parse(readFileSync(installed, 'utf8')).version === STRYKER_VERSION) return;
  console.log(`Instalando Stryker ${STRYKER_VERSION} en ${relative(root, cacheDir)} (una sola vez)…`);
  mkdirSync(cacheDir, { recursive: true });
  const result = spawnSync(
    'npm',
    [
      'install',
      '--prefix',
      cacheDir,
      '--no-save',
      '--no-package-lock',
      '--ignore-scripts',
      // Sin esto npm instala su propio vitest como peer y el runner no usaría el del proyecto.
      '--legacy-peer-deps',
      `@stryker-mutator/core@${STRYKER_VERSION}`,
      `@stryker-mutator/vitest-runner@${STRYKER_VERSION}`,
    ],
    { cwd: root, shell: process.platform === 'win32', stdio: 'inherit' },
  );
  if (result.status !== 0) fail('No se pudo instalar Stryker.');
}

function killTree() {
  try {
    process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL');
  } catch {
    // Ya terminó.
  }
}

function git(...args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout ?? '';
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
