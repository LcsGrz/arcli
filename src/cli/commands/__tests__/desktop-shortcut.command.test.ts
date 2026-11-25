import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentDesktopShortcutEnvironment } from '../../../modules/desktop-shortcut/installer';
import { stripAnsi } from '../../../ui';
import { reportCliError } from '../../error-output';
import { createProgram } from '../../program';

// El instalador es el real; del equipo se finge solo que es Windows y que PowerShell falla.
vi.mock('../../../modules/desktop-shortcut/installer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../modules/desktop-shortcut/installer')>()),
  currentDesktopShortcutEnvironment: vi.fn(),
}));

const SUGGESTION = 'Revisá que tengas permisos en esa carpeta y que PowerShell esté disponible.';
let folder = '';

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'arcli-acceso-comando-'));
  vi.stubEnv('ARCLI_CONFIG_DIR', join(folder, 'config'));
  vi.mocked(currentDesktopShortcutEnvironment).mockReturnValue({
    cliPath: undefined,
    commandInterpreter: 'C:\\Windows\\System32\\cmd.exe',
    home: folder,
    iconsFolder: resolve(import.meta.dirname, '../../../../assets/acceso-directo'),
    nodePath: '/opt/node/bin/node',
    platform: 'win32',
    run: () => ({ status: 1, stdout: '' }),
    supportFolder: join(folder, 'acceso-directo'),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(folder, { force: true, recursive: true });
});

/** `arcli acceso-directo <carpeta>`, con el error impreso como en `index.ts`. */
async function fail(json: boolean): Promise<{ code: number; stderr: string; stdout: string }> {
  let stderr = '';
  let stdout = '';

  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);

    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);

    return true;
  });

  const error: unknown = await createProgram()
    .parseAsync(['node', 'arcli', 'acceso-directo', folder, ...(json ? ['--json'] : [])])
    .then(
      () => undefined,
      (caught: unknown) => caught,
    );
  const code = reportCliError(error, json);

  return { code, stderr, stdout };
}

describe('acceso-directo, si Windows no puede crear el .lnk (DESKTOP_SHORTCUT_ERROR)', () => {
  it('con --json', async () => {
    const { code, stderr, stdout } = await fail(true);

    expect({ code, stdout }).toEqual({ code: 1, stdout: '' });
    expect(JSON.parse(stderr)).toEqual({
      codigo: 'DESKTOP_SHORTCUT_ERROR',
      detalles: null,
      error: `No se pudo crear el acceso directo en ${folder}.`,
      sugerencia: SUGGESTION,
    });
  });

  it('en la terminal', async () => {
    const { code, stderr, stdout } = await fail(false);
    const shown = stripAnsi(stderr).replace(/[│┃\s]+/g, ' ');

    expect({ code, stdout }).toEqual({ code: 1, stdout: '' });
    expect(shown).toContain('No se pudo crear el acceso directo');
    expect(shown).toContain(SUGGESTION);
  });
});
