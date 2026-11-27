import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Cargar node:sqlite (ARQ-12): el filtro del aviso de Node 22 y lo que pasa si la carga falla. Cada test carga el
 * driver de cero (`vi.resetModules`): la carga se guarda por proceso.
 */
async function freshDriver() {
  vi.resetModules();

  return import('../sqlite-driver');
}

afterEach(() => {
  vi.doUnmock('node:sqlite');
});

describe('isSqliteExperimentalWarning (ARQ-12)', () => {
  it.each([
    ['con el tipo como texto', 'SQLite is an experimental feature and might change at any time', 'ExperimentalWarning'],
    ['con el tipo en las opciones', 'SQLite is an experimental feature', { type: 'ExperimentalWarning' }],
    [
      'como Error',
      Object.assign(new Error('SQLite is an experimental feature'), { name: 'ExperimentalWarning' }),
      undefined,
    ],
  ])('oculta el de SQLite %s', async (_name, warning, typeOrOptions) => {
    const { isSqliteExperimentalWarning } = await freshDriver();

    expect(isSqliteExperimentalWarning(warning, typeOrOptions)).toBe(true);
  });

  it.each([
    ['otro experimental', 'Fetch is an experimental feature', 'ExperimentalWarning'],
    ['uno de SQLite de otro tipo', 'SQLite otro', 'DeprecationWarning'],
    ['uno de SQLite de otro tipo en las opciones', 'SQLite otro', { type: 'DeprecationWarning' }],
    ['uno común', 'SQLite sin tipo', undefined],
    ['uno que nombra SQLite en el medio', 'Algo de SQLite ', 'ExperimentalWarning'],
    ['uno que empieza con SQLite pegado', 'SQLiteX', 'ExperimentalWarning'],
  ])('deja salir %s', async (_name, warning, typeOrOptions) => {
    const { isSqliteExperimentalWarning } = await freshDriver();

    expect(isSqliteExperimentalWarning(warning, typeOrOptions)).toBe(false);
  });
});

describe('loadSqliteDriver (ARQ-12)', () => {
  it('después de cargar deja process.emitWarning como estaba', async () => {
    const original = process.emitWarning;
    const { loadSqliteDriver } = await freshDriver();

    await loadSqliteDriver();

    expect(process.emitWarning).toBe(original);
  });

  // Sin node:sqlite (un Node viejo, o compilado sin SQLite) falla ese intento, y el siguiente vuelve a probar.
  it('si la carga falla, lo dice y el siguiente intento vuelve a cargar', async () => {
    const original = process.emitWarning;

    vi.doMock('node:sqlite', () => {
      throw new Error('sin sqlite');
    });

    const { loadSqliteDriver } = await freshDriver();

    // vitest envuelve el error del mock con el suyo: alcanza con que falle.
    await expect(loadSqliteDriver()).rejects.toThrow();
    expect(process.emitWarning).toBe(original);

    vi.doUnmock('node:sqlite');

    await expect(loadSqliteDriver()).resolves.toMatchObject({ open: expect.any(Function) });
  });
});
