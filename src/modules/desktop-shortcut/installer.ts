import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AppError, InputValidationError } from '../../lib/errors/app-error';

import {
  buildLinuxDesktopEntry,
  buildMacExecutable,
  buildMacInfoPlist,
  buildPosixLauncher,
  buildWindowsLauncher,
  buildWindowsShortcutScript,
  encodePowerShell,
  LINUX_ENTRY_MARKER,
  MAC_BUNDLE_ID,
  SHORTCUT_NAME,
  WINDOWS_DESKTOP_SCRIPT,
} from './shortcut-files';

const EXECUTABLE_MODE = 0o755;
const LAUNCHER_NAME = 'arcli.command';
const ICONS_FOLDER = fileURLToPath(new URL('../../../assets/acceso-directo/', import.meta.url));

export type RunCommand = (
  command: string,
  args: readonly string[],
) => { readonly status: number | null; readonly stdout: string };

/** Lo que hace falta del entorno; en los tests se pasa a mano. */
export interface DesktopShortcutEnvironment {
  /** El ARCLI que corre; sin definir si es el codigo fuente (\`yarn dev\`): el acceso directo abre el instalado. */
  readonly cliPath?: string;
  readonly commandInterpreter: string;
  readonly home: string;
  readonly iconsFolder: string;
  readonly nodePath: string;
  readonly platform: NodeJS.Platform;
  readonly run: RunCommand;
  /** Donde quedan el lanzador y el icono en Windows y Linux; en macOS van dentro de la `.app`. */
  readonly supportFolder: string;
}

export interface DesktopShortcutResult {
  readonly path: string;
  /** `true` si ya habia un acceso directo de ARCLI en esa carpeta. */
  readonly replaced: boolean;
  /** `true` si abre el \`arcli\` del PATH en lugar del que lo creo, porque se creo desde el codigo fuente. */
  readonly usesInstalledArcli: boolean;
}

function runCommand(command: string, args: readonly string[]): { status: number | null; stdout: string } {
  const { status, stdout } = spawnSync(command, args, { encoding: 'utf8' });

  return { status, stdout: stdout ?? '' };
}

/** @param configPath ruta del archivo de configuracion: el lanzador y el icono quedan junto a el. */
export function currentDesktopShortcutEnvironment(configPath: string): DesktopShortcutEnvironment {
  const cliPath = realpathSync(process.argv[1] ?? '');

  return {
    // Desde el codigo fuente, Node corre el .ts con un cargador (tsx) que el lanzador no tiene: fallaria al abrir.
    cliPath: cliPath.endsWith('.ts') ? undefined : cliPath,
    commandInterpreter: process.env.ComSpec ?? 'cmd.exe',
    home: process.env.HOME ?? process.env.USERPROFILE ?? '',
    iconsFolder: ICONS_FOLDER,
    nodePath: process.execPath,
    platform: process.platform,
    run: runCommand,
    supportFolder: join(dirname(configPath), 'acceso-directo'),
  };
}

function runPowerShell(
  script: string,
  environment: DesktopShortcutEnvironment,
): { status: number | null; stdout: string } {
  return environment.run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    encodePowerShell(script),
  ]);
}

/** El escritorio de quien usa la maquina. Si el sistema no lo informa, el `Desktop` del usuario. */
export function resolveDesktopFolder(environment: DesktopShortcutEnvironment): string {
  const reported =
    environment.platform === 'win32'
      ? runPowerShell(WINDOWS_DESKTOP_SCRIPT, environment)
      : environment.platform === 'darwin'
        ? undefined
        : environment.run('xdg-user-dir', ['DESKTOP']);

  return (reported?.status === 0 && reported.stdout.trim()) || join(environment.home, 'Desktop');
}

function assertFolder(folder: string, isDefault: boolean): void {
  let isFolder = false;

  try {
    isFolder = statSync(folder).isDirectory();
  } catch {
    // No existe: mismo error que si fuera un archivo.
  }

  if (!isFolder) {
    throw new InputValidationError(
      isDefault
        ? `No se encontró el escritorio en ${folder}. Indicá una carpeta: \`arcli acceso-directo <ruta>\`.`
        : `La carpeta ${folder} no existe. Creala o indicá otra.`,
    );
  }
}

function assertOwned(path: string, marker: string): void {
  if (!readFileSync(path, 'utf8').includes(marker)) {
    throw new InputValidationError(`${path} ya existe y no lo creó ARCLI. Borralo o indicá otra carpeta.`);
  }
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, EXECUTABLE_MODE);
}

function createMacShortcut(
  folder: string,
  environment: DesktopShortcutEnvironment,
): Omit<DesktopShortcutResult, 'usesInstalledArcli'> {
  const path = join(folder, `${SHORTCUT_NAME}.app`);
  const infoPath = join(path, 'Contents', 'Info.plist');
  const replaced = existsSync(path);

  // Solo se borra una `.app` que se reconoce como propia.
  if (replaced) {
    if (!existsSync(infoPath)) {
      throw new InputValidationError(`${path} ya existe y no lo creó ARCLI. Borralo o indicá otra carpeta.`);
    }

    assertOwned(infoPath, MAC_BUNDLE_ID);
    rmSync(path, { recursive: true });
  }

  const executablesFolder = join(path, 'Contents', 'MacOS');
  const resourcesFolder = join(path, 'Contents', 'Resources');

  mkdirSync(executablesFolder, { recursive: true });
  mkdirSync(resourcesFolder, { recursive: true });
  writeFileSync(infoPath, buildMacInfoPlist(SHORTCUT_NAME, 'arcli.icns'));
  copyFileSync(join(environment.iconsFolder, 'arcli.icns'), join(resourcesFolder, 'arcli.icns'));
  writeExecutable(join(executablesFolder, SHORTCUT_NAME), buildMacExecutable(LAUNCHER_NAME));
  writeExecutable(join(resourcesFolder, LAUNCHER_NAME), buildPosixLauncher(environment));

  return { path, replaced };
}

function createLinuxShortcut(
  folder: string,
  environment: DesktopShortcutEnvironment,
): Omit<DesktopShortcutResult, 'usesInstalledArcli'> {
  const path = join(folder, `${SHORTCUT_NAME}.desktop`);
  const launcherPath = join(environment.supportFolder, 'arcli.sh');
  const iconPath = join(environment.supportFolder, 'arcli.png');
  const replaced = existsSync(path);

  if (replaced) {
    assertOwned(path, LINUX_ENTRY_MARKER);
  }

  mkdirSync(environment.supportFolder, { recursive: true });
  writeExecutable(launcherPath, buildPosixLauncher(environment));
  copyFileSync(join(environment.iconsFolder, 'arcli.png'), iconPath);
  writeExecutable(path, buildLinuxDesktopEntry(launcherPath, iconPath));
  // GNOME pide marcarlo como confiable para abrirlo con doble clic; donde no existe `gio`, no hace falta.
  environment.run('gio', ['set', path, 'metadata::trusted', 'true']);

  return { path, replaced };
}

function createWindowsShortcut(
  folder: string,
  environment: DesktopShortcutEnvironment,
): Omit<DesktopShortcutResult, 'usesInstalledArcli'> {
  const path = join(folder, `${SHORTCUT_NAME}.lnk`);
  const launcherPath = join(environment.supportFolder, 'arcli.cmd');
  const iconPath = join(environment.supportFolder, 'arcli.ico');
  const replaced = existsSync(path);

  mkdirSync(environment.supportFolder, { recursive: true });
  writeFileSync(launcherPath, buildWindowsLauncher(environment));
  copyFileSync(join(environment.iconsFolder, 'arcli.ico'), iconPath);

  const script = buildWindowsShortcutScript({
    commandInterpreter: environment.commandInterpreter,
    iconPath,
    launcherPath,
    shortcutPath: path,
    workingDirectory: environment.home,
  });

  if (runPowerShell(script, environment).status !== 0) {
    throw new AppError(`No se pudo crear el acceso directo en ${folder}.`, {
      code: 'DESKTOP_SHORTCUT_ERROR',
      suggestion: 'Revisá que tengas permisos en esa carpeta y que PowerShell esté disponible.',
    });
  }

  return { path, replaced };
}

/** Crea o actualiza el acceso directo en `requestedFolder` o, sin ruta, en el escritorio. */
export function createDesktopShortcut(
  requestedFolder: string | undefined,
  environment: DesktopShortcutEnvironment,
): DesktopShortcutResult {
  const folder = requestedFolder ? resolve(requestedFolder) : resolveDesktopFolder(environment);

  assertFolder(folder, requestedFolder === undefined);

  const result =
    environment.platform === 'darwin'
      ? createMacShortcut(folder, environment)
      : environment.platform === 'win32'
        ? createWindowsShortcut(folder, environment)
        : createLinuxShortcut(folder, environment);

  return { ...result, usesInstalledArcli: environment.cliPath === undefined };
}
