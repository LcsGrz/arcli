import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDesktopShortcut, type DesktopShortcutEnvironment, resolveDesktopFolder } from '../installer';

const root = resolve(import.meta.dirname, '../../../..');
let folder: string;

function environment(overrides: Partial<DesktopShortcutEnvironment> = {}): DesktopShortcutEnvironment {
  return {
    cliPath: '/opt/arcli/dist/cli/index.js',
    commandInterpreter: 'C:\\Windows\\System32\\cmd.exe',
    home: folder,
    iconsFolder: join(root, 'assets/acceso-directo'),
    nodePath: '/opt/node/bin/node',
    platform: 'darwin',
    run: () => ({ status: 0, stdout: '' }),
    supportFolder: join(folder, 'config', 'acceso-directo'),
    ...overrides,
  };
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'arcli-acceso-directo-'));
});

afterEach(() => {
  rmSync(folder, { force: true, recursive: true });
});

describe('createDesktopShortcut', () => {
  it('macOS: arma una .app con ícono y lanzador ejecutables', () => {
    const result = createDesktopShortcut(folder, environment());
    const contents = join(folder, 'ARCLI.app', 'Contents');

    expect(result).toEqual({ path: join(folder, 'ARCLI.app'), replaced: false, usesInstalledArcli: false });
    expect(readFileSync(join(contents, 'Info.plist'), 'utf8')).toContain('<string>arcli.icns</string>');
    expect(existsSync(join(contents, 'Resources', 'arcli.icns'))).toBe(true);
    expect(readFileSync(join(contents, 'Resources', 'arcli.command'), 'utf8')).toContain("'/opt/node/bin/node'");

    if (process.platform !== 'win32') {
      expect(statSync(join(contents, 'MacOS', 'ARCLI')).mode & 0o111).not.toBe(0);
      expect(statSync(join(contents, 'Resources', 'arcli.command')).mode & 0o111).not.toBe(0);
    }
  });

  it('desde el código fuente abre el arcli instalado: el .ts necesita un cargador que el lanzador no tiene', () => {
    const result = createDesktopShortcut(folder, environment({ cliPath: undefined }));
    const launcher = readFileSync(join(folder, 'ARCLI.app', 'Contents', 'Resources', 'arcli.command'), 'utf8');

    expect(result.usesInstalledArcli).toBe(true);
    expect(launcher).toContain('cd "$HOME" || exit 1\narcli\n');
    expect(launcher).not.toContain('/opt/node/bin/node');
  });

  it('macOS: al repetirlo reemplaza la .app propia', () => {
    createDesktopShortcut(folder, environment());
    writeFileSync(join(folder, 'ARCLI.app', 'Contents', 'viejo.txt'), 'x');

    expect(createDesktopShortcut(folder, environment()).replaced).toBe(true);
    expect(existsSync(join(folder, 'ARCLI.app', 'Contents', 'viejo.txt'))).toBe(false);
  });

  it('macOS: no borra una ARCLI.app que no creó', () => {
    const contents = join(folder, 'ARCLI.app', 'Contents');

    mkdirSync(contents, { recursive: true });
    writeFileSync(join(contents, 'Info.plist'), '<string>com.otra.app</string>');

    expect(() => createDesktopShortcut(folder, environment())).toThrow('no lo creó ARCLI');
    expect(readFileSync(join(contents, 'Info.plist'), 'utf8')).toContain('com.otra.app');
  });

  it('Linux: crea el .desktop en la carpeta y el lanzador con el ícono junto a la config', () => {
    const run = vi.fn(() => ({ status: 0, stdout: '' }));
    const result = createDesktopShortcut(folder, environment({ platform: 'linux', run }));
    const entry = readFileSync(join(folder, 'ARCLI.desktop'), 'utf8');

    expect(result.path).toBe(join(folder, 'ARCLI.desktop'));
    expect(entry).toContain('Terminal=true');
    expect(entry).toContain(`Icon=${join(folder, 'config', 'acceso-directo', 'arcli.png')}`);
    expect(existsSync(join(folder, 'config', 'acceso-directo', 'arcli.png'))).toBe(true);
    expect(existsSync(join(folder, 'config', 'acceso-directo', 'arcli.sh'))).toBe(true);
    expect(run).toHaveBeenCalledWith('gio', ['set', join(folder, 'ARCLI.desktop'), 'metadata::trusted', 'true']);
  });

  it('Linux: no pisa un ARCLI.desktop que no creó', () => {
    writeFileSync(join(folder, 'ARCLI.desktop'), '[Desktop Entry]\nName=Otro\n');

    expect(() => createDesktopShortcut(folder, environment({ platform: 'linux' }))).toThrow('no lo creó ARCLI');
  });

  it('Windows: crea el .lnk con PowerShell, con el lanzador y el ícono junto a la config', () => {
    const run = vi.fn(() => ({ status: 0, stdout: '' }));
    const result = createDesktopShortcut(folder, environment({ platform: 'win32', run }));
    const args = run.mock.calls[0] as unknown as [string, string[]];
    const script = Buffer.from(args[1].at(-1) ?? '', 'base64').toString('utf16le');

    expect(result.path).toBe(join(folder, 'ARCLI.lnk'));
    expect(args[0]).toBe('powershell.exe');
    expect(script).toContain(`CreateShortcut('${join(folder, 'ARCLI.lnk')}')`);
    expect(script).toContain(`$link.IconLocation = '${join(folder, 'config', 'acceso-directo', 'arcli.ico')},0'`);
    expect(existsSync(join(folder, 'config', 'acceso-directo', 'arcli.cmd'))).toBe(true);
    expect(existsSync(join(folder, 'config', 'acceso-directo', 'arcli.ico'))).toBe(true);
  });

  it('Windows: informa si PowerShell falla', () => {
    const run = () => ({ status: 1, stdout: '' });

    expect(() => createDesktopShortcut(folder, environment({ platform: 'win32', run }))).toThrow(
      'No se pudo crear el acceso directo',
    );
  });

  it('sin ruta usa el escritorio', () => {
    mkdirSync(join(folder, 'Desktop'));

    expect(createDesktopShortcut(undefined, environment()).path).toBe(join(folder, 'Desktop', 'ARCLI.app'));
  });

  it('sin escritorio pide una ruta', () => {
    expect(() => createDesktopShortcut(undefined, environment())).toThrow('arcli acceso-directo <ruta>');
  });

  it('rechaza una ruta que no existe o que no es una carpeta', () => {
    const file = join(folder, 'archivo.txt');

    writeFileSync(file, 'x');

    expect(() => createDesktopShortcut(join(folder, 'nada'), environment())).toThrow('no existe');
    expect(() => createDesktopShortcut(file, environment())).toThrow('no existe');
  });
});

describe('resolveDesktopFolder', () => {
  it('Windows: usa la carpeta que informa el sistema, por OneDrive', () => {
    const run = () => ({ status: 0, stdout: 'C:\\Users\\Ana\\OneDrive\\Escritorio\r\n' });

    expect(resolveDesktopFolder(environment({ platform: 'win32', run }))).toBe('C:\\Users\\Ana\\OneDrive\\Escritorio');
  });

  it('Linux: usa xdg-user-dir, por los escritorios traducidos', () => {
    const run = vi.fn(() => ({ status: 0, stdout: '/home/ana/Escritorio\n' }));

    expect(resolveDesktopFolder(environment({ platform: 'linux', run }))).toBe('/home/ana/Escritorio');
    expect(run).toHaveBeenCalledWith('xdg-user-dir', ['DESKTOP']);
  });

  it('si el sistema no lo informa, usa Desktop', () => {
    const run = () => ({ status: null, stdout: '' });

    expect(resolveDesktopFolder(environment({ platform: 'linux', run }))).toBe(join(folder, 'Desktop'));
  });
});

describe('paquete', () => {
  it('los íconos se publican en npm', () => {
    const { files } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { files: string[] };

    expect(files).toContain('assets');

    for (const icon of ['arcli.icns', 'arcli.ico', 'arcli.png']) {
      expect(existsSync(join(root, 'assets/acceso-directo', icon))).toBe(true);
    }
  });
});
