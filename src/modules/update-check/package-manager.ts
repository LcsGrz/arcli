import { realpathSync } from 'node:fs';
import process from 'node:process';

export type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';

const UPDATE_COMMANDS: Readonly<Record<PackageManager, string>> = {
  bun: 'bun add -g arcli@latest',
  npm: 'npm install -g arcli@latest',
  pnpm: 'pnpm add -g arcli@latest',
  yarn: 'yarn global add arcli@latest',
};

/**
 * Carpetas donde cada gestor deja los paquetes globales (o su cache de `dlx`), con `/` y en minusculas:
 * `~/.bun/install/global`, `~/Library/pnpm/global/5/.pnpm/...`, `~/.config/yarn/global` y, en Windows,
 * `%LOCALAPPDATA%\Yarn\Data\global`. La de npm (`<prefijo>/lib/node_modules`, `%APPDATA%\npm\node_modules`) va
 * ultima: asi un arcli global de npm corrido desde un script de yarn no sale con el comando de yarn.
 */
const PATH_PATTERNS: ReadonlyArray<readonly [PackageManager, RegExp]> = [
  ['bun', /\/\.bun\//],
  ['pnpm', /\/\.pnpm\/|\/pnpm\/(global|dlx)\/|\/pnpm-global\//],
  ['yarn', /\/yarn\/(data\/)?global\//],
  ['npm', /\/lib\/node_modules\/|\/npm\/node_modules\//],
];

/**
 * Con que gestor se instalo arcli. Primero mira la ruta real del ejecutable (sirve para los globales, que no tienen
 * `npm_config_user_agent`) y despues el user agent (`pnpm dlx`, `bunx`, scripts). Sin señales, npm.
 */
export function detectPackageManager(signals: {
  readonly scriptPath?: string;
  readonly userAgent?: string;
}): PackageManager {
  const path = signals.scriptPath?.replaceAll('\\', '/').toLowerCase();
  const fromPath = path ? PATH_PATTERNS.find(([, pattern]) => pattern.test(path))?.[0] : undefined;

  if (fromPath) {
    return fromPath;
  }

  const agent = /^(bun|npm|pnpm|yarn)\//.exec(signals.userAgent?.trim().toLowerCase() ?? '')?.[1];

  return (agent as PackageManager | undefined) ?? 'npm';
}

export function formatUpdateCommand(packageManager: PackageManager): string {
  return UPDATE_COMMANDS[packageManager];
}

/** La ruta real del script que se esta corriendo: los bin globales suelen ser symlinks a la carpeta del gestor. */
function resolveScriptPath(): string | undefined {
  const script = process.argv[1];

  if (!script) {
    return undefined;
  }

  try {
    return realpathSync(script);
  } catch {
    return script;
  }
}

/** El comando para actualizar arcli con el gestor con que se instalo. */
export function resolveUpdateCommand(): string {
  return formatUpdateCommand(
    detectPackageManager({ scriptPath: resolveScriptPath(), userAgent: process.env.npm_config_user_agent }),
  );
}
