import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import type { MonotributoTable } from '../monotributo';
import { BUNDLED_MONOTRIBUTO_TABLE } from '../monotributo.bundled';
import { loadMonotributoTable, resolveOwnCategory } from '../monotributo.service';
import type { MonotributoPageFetch } from '../monotributo.source';
import { MemoryMonotributoStore } from '../monotributo.store';

const PAGE = readFileSync(new URL('fixtures/categorias.html', import.meta.url), 'utf8');
/** 18/11/2026 al mediodia de Buenos Aires. */
const NOW = new Date('2026-11-18T15:00:00Z');
const VERSION = '2.6.0';

const OLD_TABLE: MonotributoTable = { ...BUNDLED_MONOTRIBUTO_TABLE, validFrom: '20260201' };

function fetcher(result: MonotributoPageFetch) {
  return vi.fn(async () => result);
}

const ONLINE = { html: PAGE, ok: true } as const;
const OFFLINE = { ok: false, reason: 'sin-conexion' } as const;

describe('loadMonotributoTable', () => {
  it('la primera vez consulta ARCA y guarda la tabla con la fecha de hoy', async () => {
    const store = new MemoryMonotributoStore();
    const fetchPage = fetcher(ONLINE);
    const loaded = await loadMonotributoTable({ fetchPage, now: NOW, refresh: false, store, version: VERSION });

    expect(fetchPage).toHaveBeenCalledOnce();
    expect(loaded).toMatchObject({ consultedOn: '20261118', notices: [], source: 'arca' });
    expect(loaded.table.validFrom).toBe('20260801');
    expect(store.readTable()?.consultedOn).toBe('20261118');
    expect(store.readFirstAttempt()).toBe('20261118');
  });

  it('con tabla guardada no consulta ARCA', async () => {
    const store = new MemoryMonotributoStore({ table: { consultedOn: '20261101', table: BUNDLED_MONOTRIBUTO_TABLE } });
    const fetchPage = fetcher(ONLINE);
    const loaded = await loadMonotributoTable({ fetchPage, now: NOW, refresh: false, store, version: VERSION });

    expect(fetchPage).not.toHaveBeenCalled();
    expect(loaded).toMatchObject({ consultedOn: '20261101', notices: [], source: 'guardada' });
  });

  it('sin conexión la primera vez: la incluida con un aviso, y no reintenta en la próxima', async () => {
    const store = new MemoryMonotributoStore();
    const fetchPage = fetcher(OFFLINE);
    const first = await loadMonotributoTable({ fetchPage, now: NOW, refresh: false, store, version: VERSION });

    expect(first).toMatchObject({ consultedOn: null, source: 'incluida' });
    expect(first.notices).toEqual([
      'No se pudo consultar la tabla en ARCA (sin conexión). Se muestra la incluida en ARCLI 2.6.0, vigente desde el 01/08/2026.',
    ]);

    const second = await loadMonotributoTable({ fetchPage, now: NOW, refresh: false, store, version: VERSION });

    expect(fetchPage).toHaveBeenCalledOnce();
    expect(second).toMatchObject({ notices: [], source: 'incluida' });
  });

  it.each([
    [{ ok: false, reason: 'sin-respuesta' } as const, 'no respondió a tiempo'],
    [{ ok: false, reason: 'error-http', status: 503 } as const, 'respondió con el error 503'],
  ])('dice por qué no se pudo consultar: %o', async (result, reason) => {
    const store = new MemoryMonotributoStore({ table: { consultedOn: '20261101', table: BUNDLED_MONOTRIBUTO_TABLE } });
    const loaded = await loadMonotributoTable({
      fetchPage: fetcher(result),
      now: NOW,
      refresh: true,
      store,
      version: VERSION,
    });

    expect(loaded.source).toBe('guardada');
    expect(loaded.notices).toEqual([
      `No se pudo consultar la tabla en ARCA (${reason}). Se muestra la guardada el 01/11/2026, vigente desde el 01/08/2026.`,
    ]);
  });

  it('con --actualizar y la página cambiada: la guardada, con el aviso', async () => {
    const store = new MemoryMonotributoStore({ table: { consultedOn: '20261101', table: BUNDLED_MONOTRIBUTO_TABLE } });
    const loaded = await loadMonotributoTable({
      fetchPage: fetcher({ html: PAGE.replace('$119.811,45', '$1,00'), ok: true }),
      now: NOW,
      refresh: true,
      store,
      version: VERSION,
    });

    expect(loaded.source).toBe('guardada');
    expect(loaded.notices).toEqual([
      'La página de ARCA cambió y ARCLI no pudo leer la tabla. Se usa la guardada el 01/11/2026. Si sigue, avisanos en GitHub: https://github.com/LcsGrz/arcli/issues',
    ]);
    expect(store.readTable()?.consultedOn).toBe('20261101');
  });

  it('con la página cambiada y sin guardada: la incluida', async () => {
    const loaded = await loadMonotributoTable({
      fetchPage: fetcher({ html: '<html>otra cosa</html>', ok: true }),
      now: NOW,
      refresh: true,
      store: new MemoryMonotributoStore(),
      version: VERSION,
    });

    expect(loaded.source).toBe('incluida');
    expect(loaded.notices[0]).toContain('Se usa la incluida en ARCLI 2.6.0.');
  });

  it('con --actualizar reemplaza la guardada', async () => {
    const store = new MemoryMonotributoStore({ table: { consultedOn: '20260301', table: OLD_TABLE } });
    const loaded = await loadMonotributoTable({
      bundled: OLD_TABLE,
      fetchPage: fetcher(ONLINE),
      now: NOW,
      refresh: true,
      store,
      version: VERSION,
    });

    expect(loaded).toMatchObject({ consultedOn: '20261118', notices: [], source: 'arca' });
    expect(store.readTable()?.table.validFrom).toBe('20260801');
  });

  it('usa la incluida si es más nueva que la guardada (ARCLI actualizado)', async () => {
    const store = new MemoryMonotributoStore({ table: { consultedOn: '20260301', table: OLD_TABLE } });
    const loaded = await loadMonotributoTable({
      fetchPage: fetcher(ONLINE),
      now: NOW,
      refresh: false,
      store,
      version: VERSION,
    });

    expect(loaded).toMatchObject({ consultedOn: null, notices: [], source: 'incluida' });
  });

  it('avisa que la guardada puede estar vieja', async () => {
    const store = new MemoryMonotributoStore({ table: { consultedOn: '20260301', table: OLD_TABLE } });
    const loaded = await loadMonotributoTable({
      bundled: OLD_TABLE,
      fetchPage: fetcher(ONLINE),
      now: NOW,
      refresh: false,
      store,
      version: VERSION,
    });

    expect(loaded.notices).toEqual([
      'ARCA actualiza las categorías en febrero y agosto. La tabla guardada es del 01/02/2026 y puede haber una nueva. Actualizala con `arcli monotributo --actualizar`.',
    ]);
  });
});

describe('resolveOwnCategory', () => {
  const base = { cuit: '20333333334', environment: 'testing' as const, now: NOW, refresh: false };

  it('sin CUIT en la config no consulta', async () => {
    const lookup = vi.fn(async () => 'E' as const);

    await expect(
      resolveOwnCategory({ ...base, cuit: undefined, lookup, store: new MemoryMonotributoStore() }),
    ).resolves.toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('consulta una vez y guarda la letra para ese CUIT y entorno', async () => {
    const store = new MemoryMonotributoStore();
    const lookup = vi.fn(async () => 'E' as const);

    await expect(resolveOwnCategory({ ...base, lookup, store })).resolves.toBe('E');
    await expect(resolveOwnCategory({ ...base, lookup, store })).resolves.toBe('E');
    expect(lookup).toHaveBeenCalledOnce();
    expect(store.readOwnCategory()).toEqual({
      consultedOn: '20261118',
      cuit: '20333333334',
      environment: 'testing',
      letter: 'E',
    });
  });

  it('guarda también que no es monotributista', async () => {
    const store = new MemoryMonotributoStore();
    const lookup = vi.fn(async () => null);

    await resolveOwnCategory({ ...base, lookup, store });
    await resolveOwnCategory({ ...base, lookup, store });

    expect(lookup).toHaveBeenCalledOnce();
  });

  it('vuelve a consultar con --actualizar, con otro CUIT o en otro entorno', async () => {
    const store = new MemoryMonotributoStore({
      ownCategory: { consultedOn: '20261101', cuit: '20333333334', environment: 'testing', letter: 'D' },
    });
    const lookup = vi.fn(async () => 'E' as const);

    await expect(resolveOwnCategory({ ...base, lookup, refresh: true, store })).resolves.toBe('E');
    await resolveOwnCategory({ ...base, cuit: '20201797064', lookup, store });
    await resolveOwnCategory({ ...base, environment: 'produccion', lookup, store });

    expect(lookup).toHaveBeenCalledTimes(3);
  });

  // TEST-21: cada caso con su propia categoria guardada, para que uno no tape al otro.
  it.each([
    ['otro CUIT', { cuit: '20201797064' }],
    ['otro entorno', { environment: 'produccion' as const }],
  ])('no reusa la categoría guardada con %s', async (_case, overrides) => {
    const store = new MemoryMonotributoStore({
      ownCategory: { consultedOn: '20261101', cuit: '20333333334', environment: 'testing', letter: 'D' },
    });
    const lookup = vi.fn(async () => 'E' as const);

    await expect(resolveOwnCategory({ ...base, ...overrides, lookup, store })).resolves.toBe('E');
    expect(lookup).toHaveBeenCalledOnce();
    expect(store.readOwnCategory()).toMatchObject({ letter: 'E', ...overrides });
  });

  it('si el padrón falla no marca nada, no guarda y no lanza', async () => {
    const store = new MemoryMonotributoStore();
    const lookup = vi.fn(async () => {
      throw new Error('Falta la ruta del certificado');
    });

    await expect(resolveOwnCategory({ ...base, lookup, store })).resolves.toBeNull();
    expect(store.readOwnCategory()).toBeUndefined();
  });
});
