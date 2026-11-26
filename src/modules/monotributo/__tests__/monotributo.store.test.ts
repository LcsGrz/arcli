import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUNDLED_MONOTRIBUTO_TABLE } from '../monotributo.bundled';
import { fetchMonotributoPage } from '../monotributo.source';
import { FileMonotributoStore } from '../monotributo.store';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arcli-monotributo-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('FileMonotributoStore', () => {
  it('guarda y lee la tabla, la categoría propia y el primer intento', () => {
    const store = new FileMonotributoStore(dir);

    store.saveTable({ consultedOn: '20261118', table: BUNDLED_MONOTRIBUTO_TABLE });
    store.saveOwnCategory({ consultedOn: '20261118', cuit: '20333333334', environment: 'testing', letter: 'E' });
    store.saveFirstAttempt('20261118');

    const reopened = new FileMonotributoStore(dir);

    expect(reopened.readTable()).toEqual({ consultedOn: '20261118', table: BUNDLED_MONOTRIBUTO_TABLE });
    expect(reopened.readOwnCategory()?.letter).toBe('E');
    expect(reopened.readFirstAttempt()).toBe('20261118');
    // Con los nombres del --json, para leerlo a mano.
    expect(readFileSync(join(dir, 'monotributo.json'), 'utf8')).toContain('"ingresosBrutosHasta": 12009410.45');
  });

  it('ignora una tabla guardada que no pasa el control', () => {
    new FileMonotributoStore(dir).saveTable({ consultedOn: '20261118', table: BUNDLED_MONOTRIBUTO_TABLE });

    const path = join(dir, 'monotributo.json');

    writeFileSync(path, readFileSync(path, 'utf8').replace('"aporteSipa": 18246.86', '"aporteSipa": 1'));

    expect(new FileMonotributoStore(dir).readTable()).toBeUndefined();
  });

  it('un archivo roto no corta: se toma como vacío', () => {
    writeFileSync(join(dir, 'monotributo.json'), '{ esto no es JSON');

    const store = new FileMonotributoStore(dir);

    expect(store.readTable()).toBeUndefined();
    expect(store.readOwnCategory()).toBeUndefined();
    expect(store.readFirstAttempt()).toBeUndefined();
  });

  /** Caracterización antes de ARQ-12 PR 3: el store pasa a services/files sobre el adaptador y esto queda igual. */
  describe('el archivo, como lo lee y escribe hoy', () => {
    const path = () => join(dir, 'monotributo.json');

    it('escribe JSON con tabs y deja lo que ya estaba', () => {
      writeFileSync(path(), '{"otraClave": 1}');
      new FileMonotributoStore(dir).saveFirstAttempt('20261118');

      expect(readFileSync(path(), 'utf8')).toBe('{\n\t"otraClave": 1,\n\t"primeraConsulta": "20261118"\n}');
    });

    it('cada guardado conserva lo que guardó el anterior, aunque sea de otra instancia', () => {
      const first = new FileMonotributoStore(dir);
      const second = new FileMonotributoStore(dir);

      first.saveFirstAttempt('20261118');
      second.saveOwnCategory({ consultedOn: '20261118', cuit: '20333333334', environment: 'testing', letter: 'E' });

      const reopened = new FileMonotributoStore(dir);

      expect(reopened.readFirstAttempt()).toBe('20261118');
      expect(reopened.readOwnCategory()?.letter).toBe('E');
    });

    it('lee un archivo con BOM', () => {
      writeFileSync(path(), '﻿{"primeraConsulta": "20261118"}');

      expect(new FileMonotributoStore(dir).readFirstAttempt()).toBe('20261118');
    });

    it.each(['[]', 'null', '42'])('un JSON que no es un objeto (%s) se toma como vacío', (content) => {
      writeFileSync(path(), content);

      const store = new FileMonotributoStore(dir);

      expect(store.readFirstAttempt()).toBeUndefined();

      store.saveFirstAttempt('20261118');

      expect(JSON.parse(readFileSync(path(), 'utf8'))).toEqual({ primeraConsulta: '20261118' });
    });

    it('guardar sobre un archivo roto lo reemplaza', () => {
      writeFileSync(path(), '{ esto no es JSON');
      new FileMonotributoStore(dir).saveFirstAttempt('20261118');

      expect(JSON.parse(readFileSync(path(), 'utf8'))).toEqual({ primeraConsulta: '20261118' });
    });
  });
});

describe('fetchMonotributoPage', () => {
  it('devuelve el HTML', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html></html>'));

    await expect(fetchMonotributoPage(fetchImpl)).resolves.toEqual({ html: '<html></html>', ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://www.afip.gob.ar/monotributo/categorias.asp',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('sin conexión', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(fetchMonotributoPage(fetchImpl)).resolves.toEqual({ ok: false, reason: 'sin-conexion' });
  });

  it('un error HTTP', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));

    await expect(fetchMonotributoPage(fetchImpl)).resolves.toEqual({ ok: false, reason: 'error-http', status: 503 });
  });

  it('corta si ARCA no responde a tiempo', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    await expect(fetchMonotributoPage(fetchImpl as typeof fetch, 10)).resolves.toEqual({
      ok: false,
      reason: 'sin-respuesta',
    });
  });
});
