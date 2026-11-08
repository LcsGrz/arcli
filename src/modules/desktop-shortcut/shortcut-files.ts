/**
 * Lo que abre el acceso directo: rutas absolutas, tomadas de la instalacion que lo creo. Sin `cliPath` (se creo desde
 * el codigo fuente), abre el `arcli` del PATH.
 */
export interface ShortcutTarget {
  readonly cliPath?: string;
  readonly nodePath: string;
}

export const SHORTCUT_NAME = 'ARCLI';
export const MAC_BUNDLE_ID = 'com.github.lcsgrz.arcli';
export const LINUX_ENTRY_MARKER = 'X-ARCLI-Generated=true';

const FAILURE_MESSAGE =
  'ARCLI terminó con un error. Si no vuelve a abrir, recreá el acceso directo con `arcli acceso-directo`.';

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Lanzador de macOS y Linux. Si Node o ARCLI cambiaron de lugar, prueba con el `arcli` del PATH. Al terminar con un
 * error espera un Enter, porque si no la ventana se cierra sin que se llegue a leer; 130 es salir con Ctrl+C.
 */
export function buildPosixLauncher({ cliPath, nodePath }: ShortcutTarget): string {
  const node = quotePosix(nodePath);
  const run =
    cliPath === undefined
      ? 'arcli'
      : `if [ -x ${node} ] && [ -f ${quotePosix(cliPath)} ]; then
  ${node} ${quotePosix(cliPath)}
else
  arcli
fi`;

  return `#!/bin/sh
# Generado por \`arcli acceso-directo\`.
printf '\\033]0;${SHORTCUT_NAME}\\007'
cd "$HOME" || exit 1
${run}
status=$?
if [ "$status" -ne 0 ] && [ "$status" -ne 130 ]; then
  printf '\\n%s\\n' ${quotePosix(FAILURE_MESSAGE)}
  printf 'Presioná Enter para cerrar.'
  read -r _
fi
exit "$status"
`;
}

/** Lanzador de Windows, equivalente a `buildPosixLauncher`. En un `.cmd`, un `%` literal se escribe `%%`. */
export function buildWindowsLauncher({ cliPath, nodePath }: ShortcutTarget): string {
  const escape = (value: string) => value.replaceAll('%', '%%');

  return [
    '@echo off',
    'rem Generado por `arcli acceso-directo`.',
    'chcp 65001 >nul',
    `title ${SHORTCUT_NAME}`,
    'cd /d "%USERPROFILE%"',
    ...(cliPath === undefined
      ? ['call arcli']
      : [
          `set "ARCLI_NODE=${escape(nodePath)}"`,
          `set "ARCLI_CLI=${escape(cliPath)}"`,
          'if exist "%ARCLI_NODE%" if exist "%ARCLI_CLI%" goto directo',
          'call arcli',
          'goto fin',
          ':directo',
          '"%ARCLI_NODE%" "%ARCLI_CLI%"',
          ':fin',
        ]),
    'if not errorlevel 1 exit /b 0',
    'echo.',
    `echo ${FAILURE_MESSAGE}`,
    'pause',
    '',
  ].join('\r\n');
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function buildMacInfoPlist(executableName: string, iconFileName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${escapeXml(executableName)}</string>
  <key>CFBundleIconFile</key>
  <string>${escapeXml(iconFileName)}</string>
  <key>CFBundleIdentifier</key>
  <string>${MAC_BUNDLE_ID}</string>
  <key>CFBundleName</key>
  <string>${SHORTCUT_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
</dict>
</plist>
`;
}

/** El ejecutable de la `.app`: abre el lanzador en la Terminal, sin pedir permisos de automatizacion. */
export function buildMacExecutable(launcherFileName: string): string {
  return `#!/bin/sh
exec open -a Terminal "$(dirname "$0")/../Resources/${launcherFileName}"
`;
}

/** Un valor de `Exec=`: primero las reglas de `Exec` y despues las de cualquier cadena del `.desktop`. */
function quoteDesktopExec(value: string): string {
  const quoted = value.replace(/[\\"`$]/g, '\\$&').replaceAll('%', '%%');

  return `"${quoted}"`.replaceAll('\\', '\\\\');
}

export function buildLinuxDesktopEntry(launcherPath: string, iconPath: string): string {
  return `[Desktop Entry]
Type=Application
Name=${SHORTCUT_NAME}
Comment=Emití y revisá comprobantes de ARCA
Exec=${quoteDesktopExec(launcherPath)}
Icon=${iconPath}
Terminal=true
Categories=Office;Finance;
${LINUX_ENTRY_MARKER}
`;
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export interface WindowsShortcutOptions {
  readonly commandInterpreter: string;
  readonly iconPath: string;
  readonly launcherPath: string;
  readonly shortcutPath: string;
  readonly workingDirectory: string;
}

/** Script de PowerShell que crea el `.lnk`. Las comillas dobles de `/c` las saca cmd: sin ellas falla con espacios. */
export function buildWindowsShortcutScript(options: WindowsShortcutOptions): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$link = (New-Object -ComObject WScript.Shell).CreateShortcut(${quotePowerShell(options.shortcutPath)})`,
    `$link.TargetPath = ${quotePowerShell(options.commandInterpreter)}`,
    `$link.Arguments = ${quotePowerShell(`/c ""${options.launcherPath}""`)}`,
    `$link.WorkingDirectory = ${quotePowerShell(options.workingDirectory)}`,
    `$link.IconLocation = ${quotePowerShell(`${options.iconPath},0`)}`,
    `$link.Description = '${SHORTCUT_NAME}'`,
    '$link.Save()',
  ].join('\n');
}

/** Pide el escritorio real: con OneDrive no siempre es `~/Desktop`. En UTF-8, por los nombres con tilde. */
export const WINDOWS_DESKTOP_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  "[Environment]::GetFolderPath('Desktop')",
].join('\n');

/** `-EncodedCommand` espera UTF-16 en base64: evita pelear con las comillas de cada shell. */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}
