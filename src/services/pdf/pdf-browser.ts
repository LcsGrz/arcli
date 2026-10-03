import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Rutas conocidas de Chrome, Chromium y Edge. Con alguno instalado no hace falta descargar un navegador. */
export function listSystemBrowserCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  switch (platform) {
    case 'darwin':
      return ['/Applications', join(homedir(), 'Applications')].flatMap((folder) => [
        join(folder, 'Google Chrome.app/Contents/MacOS/Google Chrome'),
        join(folder, 'Chromium.app/Contents/MacOS/Chromium'),
        join(folder, 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      ]);
    case 'win32':
      return [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
        .filter((folder): folder is string => Boolean(folder))
        .flatMap((folder) => [
          join(folder, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(folder, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ]);
    default:
      return [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/microsoft-edge',
        '/snap/bin/chromium',
      ];
  }
}

export function findSystemBrowser(candidates: readonly string[] = listSystemBrowserCandidates()): string | undefined {
  return candidates.find((candidate) => existsSync(candidate));
}

/** Binario de chrome-headless-shell descargado con el CLI de Puppeteer en `<cacheDir>/chrome-headless-shell/<build>/<carpeta>/`. */
export function findDownloadedBrowser(cacheDir: string): string | undefined {
  const root = join(cacheDir, 'chrome-headless-shell');

  if (!existsSync(root)) {
    return undefined;
  }

  const binaryName = process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';

  const folders = (path: string) =>
    readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

  for (const build of folders(root)) {
    for (const folder of folders(join(root, build))) {
      const binary = join(root, build, folder, binaryName);

      if (existsSync(binary)) {
        return binary;
      }
    }
  }

  return undefined;
}
