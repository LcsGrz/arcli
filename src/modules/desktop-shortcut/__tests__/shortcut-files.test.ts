import { describe, expect, it } from 'vitest';

import {
  buildLinuxDesktopEntry,
  buildMacExecutable,
  buildPosixLauncher,
  buildWindowsLauncher,
  buildWindowsShortcutScript,
} from '../shortcut-files';

const target = { cliPath: "/Users/Ana O'Neil/arcli/index.js", nodePath: '/opt/node/bin/node' };

describe('buildPosixLauncher', () => {
  it('arranca en el home, escapa las rutas y prueba el arcli del PATH si no están', () => {
    const script = buildPosixLauncher(target);

    expect(script).toContain('cd "$HOME"');
    expect(script).toContain(`'/opt/node/bin/node' '/Users/Ana O'\\''Neil/arcli/index.js'`);
    expect(script).toMatch(/else\n {2}arcli\nfi/);
  });

  it('espera un Enter si hubo un error, salvo con Ctrl+C', () => {
    const script = buildPosixLauncher(target);

    expect(script).toContain('[ "$status" -ne 0 ] && [ "$status" -ne 130 ]');
    expect(script).toContain('read -r _');
  });
});

describe('buildWindowsLauncher', () => {
  it('sin la ruta de ARCLI, llama al arcli del PATH', () => {
    const script = buildWindowsLauncher({ nodePath: 'node.exe' });

    expect(script).toContain('call arcli');
    expect(script).not.toContain('ARCLI_CLI');
  });

  it('usa CRLF y UTF-8, y pausa si hubo un error', () => {
    const script = buildWindowsLauncher({
      cliPath: 'C:\\a\\index.js',
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    });

    expect(script.split('\r\n')).toContain('chcp 65001 >nul');
    expect(script).toContain('set "ARCLI_NODE=C:\\Program Files\\nodejs\\node.exe"');
    expect(script).toContain('if not errorlevel 1 exit /b 0');
    expect(script).toContain('pause');
    expect(script.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('escapa el % de las rutas', () => {
    expect(buildWindowsLauncher({ cliPath: 'C:\\100%\\index.js', nodePath: 'node.exe' })).toContain(
      'set "ARCLI_CLI=C:\\100%%\\index.js"',
    );
  });
});

describe('buildMacExecutable', () => {
  it('abre el lanzador en la Terminal', () => {
    expect(buildMacExecutable('arcli.command')).toContain(
      'exec open -a Terminal "$(dirname "$0")/../Resources/arcli.command"',
    );
  });
});

describe('buildLinuxDesktopEntry', () => {
  it('escapa Exec según la especificación', () => {
    expect(buildLinuxDesktopEntry('/home/ana/100% $x/arcli.sh', '/i.png')).toContain(
      'Exec="/home/ana/100%% \\\\$x/arcli.sh"',
    );
  });
});

describe('buildWindowsShortcutScript', () => {
  it('escapa las comillas simples y envuelve el lanzador para cmd', () => {
    const script = buildWindowsShortcutScript({
      commandInterpreter: 'cmd.exe',
      iconPath: 'C:\\config\\arcli.ico',
      launcherPath: "C:\\Users\\Ana O'Neil\\arcli.cmd",
      shortcutPath: "C:\\Users\\Ana O'Neil\\Desktop\\ARCLI.lnk",
      workingDirectory: 'C:\\Users\\Ana',
    });

    expect(script).toContain(`CreateShortcut('C:\\Users\\Ana O''Neil\\Desktop\\ARCLI.lnk')`);
    expect(script).toContain(`$link.Arguments = '/c ""C:\\Users\\Ana O''Neil\\arcli.cmd""'`);
  });
});
