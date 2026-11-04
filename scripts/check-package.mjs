// Instala el paquete como lo haria alguien desde npm y corre `arcli --version` y `--ayuda`. Atrapa lo que los tests
// no ven: archivos que faltan en `files`, imports rotos por fix-esm-extensions.mjs y una version desalineada.
//
// Uso: node scripts/check-package.mjs [arcli-x.y.z.tgz]. Sin argumento empaqueta `dist` (hay que correr el build antes).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const isWindows = process.platform === 'win32';
// El npm que viene con este Node, corrido con node: bajo `yarn` en Windows, `npm.cmd` puede resolver a otra copia.
const npmCli = [
  join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
].find((path) => existsSync(path));
const npm = (args) => (npmCli ? [process.execPath, [npmCli, ...args]] : [isWindows ? 'npm.cmd' : 'npm', args]);
const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const workDirectory = mkdtempSync(join(tmpdir(), 'arcli-package-check-'));

function run([command, args], options = {}) {
  // En Windows npm y el bin instalado son .cmd y necesitan shell; con shell, una ruta con espacios va entre comillas.
  const shell = isWindows && /\.cmd$/i.test(command);
  const result = spawnSync(shell ? `"${command}"` : command, args, {
    encoding: 'utf8',
    env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
    shell,
    cwd: workDirectory,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} salio con ${result.status ?? result.error?.message}\n${result.stdout}${result.stderr}`,
    );
  }

  return result.stdout;
}

try {
  let tarball = process.argv[2] ? resolve(process.argv[2]) : undefined;

  if (!tarball) {
    // --ignore-scripts: el prepack haria otro build; aca se prueba el que ya esta.
    const [packed] = JSON.parse(
      run(npm(['pack', resolve('.'), '--ignore-scripts', '--json', '--pack-destination', workDirectory])),
    );

    tarball = join(workDirectory, packed.filename);
  }

  const prefix = join(workDirectory, 'instalacion');

  run(npm(['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', tarball]));

  const bin = join(prefix, 'node_modules', '.bin', isWindows ? 'arcli.cmd' : 'arcli');
  const reported = run([bin, ['--version']]).trim();

  if (!reported.includes(version)) {
    throw new Error(`arcli --version dice "${reported}" y package.json, ${version}: falta subir src/cli/version.ts.`);
  }

  run([bin, ['--ayuda']]);
  console.log(`Paquete ok: arcli ${version} se instala y arranca.`);
} finally {
  rmSync(workDirectory, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
}
