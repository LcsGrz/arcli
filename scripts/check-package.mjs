// Instala el paquete como lo haria alguien desde npm y corre `arcli --version` y `--ayuda`. Atrapa lo que los tests
// no ven: archivos que faltan en `files`, imports rotos por fix-esm-extensions.mjs y una version desalineada.
//
// Uso: node scripts/check-package.mjs [arcli-x.y.z.tgz]. Sin argumento empaqueta `dist` (hay que correr el build antes).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const workDirectory = mkdtempSync(join(tmpdir(), 'arcli-package-check-'));

function run(command, args, options = {}) {
  // En Windows npm y el bin instalado son .cmd y necesitan shell; con shell, una ruta con espacios va entre comillas.
  const shell = isWindows && /\.cmd$/i.test(command);
  const result = spawnSync(shell ? `"${command}"` : command, args, {
    encoding: 'utf8',
    env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
    shell,
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
    const [packed] = JSON.parse(run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', workDirectory]));

    tarball = join(workDirectory, packed.filename);
  }

  const prefix = join(workDirectory, 'instalacion');

  run(npm, ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', tarball]);

  const bin = join(prefix, 'node_modules', '.bin', isWindows ? 'arcli.cmd' : 'arcli');
  const reported = run(bin, ['--version']).trim();

  if (!reported.includes(version)) {
    throw new Error(`arcli --version dice "${reported}" y package.json, ${version}: falta subir src/cli/version.ts.`);
  }

  run(bin, ['--ayuda']);
  console.log(`Paquete ok: arcli ${version} se instala y arranca.`);
} finally {
  rmSync(workDirectory, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
}
