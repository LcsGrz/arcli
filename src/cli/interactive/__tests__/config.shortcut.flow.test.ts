import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError, InputValidationError } from '../../../lib/errors/app-error';
import { stripAnsi } from '../../../ui';
import { runConfigMenu } from '../config.flow';
import { chooseOne } from '../prompts';

vi.mock('../prompts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../prompts')>()),
  chooseOne: vi.fn(),
}));

const createShortcut = vi.hoisted(() => vi.fn());

vi.mock('../../../modules/desktop-shortcut/installer', () => ({
  createDesktopShortcut: createShortcut,
  currentDesktopShortcutEnvironment: () => ({}),
}));

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-acceso-'));
  vi.stubEnv('ARCLI_CONFIG_DIR', directory);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.mocked(chooseOne).mockReset();
  rmSync(directory, { force: true, recursive: true });
});

describe('el acceso directo que no se puede crear, desde Configuración (H26)', () => {
  it.each<[string, Error, string]>([
    ['su mensaje', new InputValidationError('No se encontró el escritorio.'), 'No se encontró el escritorio.'],
    [
      'su sugerencia',
      new AppError('No se pudo crear el acceso directo.', {
        code: 'DESKTOP_SHORTCUT_ERROR',
        suggestion: 'Revisá que tengas permisos en esa carpeta.',
      }),
      'Revisá que tengas permisos en esa carpeta.',
    ],
    [
      'un error del sistema de archivos',
      Object.assign(new Error('EPERM: operation not permitted, mkdir'), { code: 'EPERM', syscall: 'mkdir' }),
      'EPERM',
    ],
  ])('muestra %s y sigue en el menu', async (_name, error, expected) => {
    let printed = '';

    createShortcut.mockImplementationOnce(() => {
      throw error;
    });
    vi.mocked(chooseOne).mockResolvedValueOnce('acceso-directo').mockResolvedValueOnce('volver');
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      printed += String(chunk);

      return true;
    });

    await runConfigMenu();

    expect(stripAnsi(printed)).toContain(expected);
    expect(chooseOne).toHaveBeenCalledTimes(2);
  });
});
