import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { openSqliteConnection, type SqliteParameters } from '../sqlite-driver';

import { temporaryDataDirectory } from './local-data.fixtures';

const NODE_MAJOR = Number(process.versions.node.split('.')[0]);

async function openTemporary() {
  return openSqliteConnection(join(temporaryDataDirectory('arcli-driver-'), 'prueba.db'), { timeoutMs: 1000 });
}

describe('sqlite-driver (ARQ-12)', () => {
  it('abre, escribe y lee con parámetros con nombre', async () => {
    const connection = await openTemporary();

    try {
      connection.exec('CREATE TABLE t (cae TEXT PRIMARY KEY, total INTEGER NOT NULL) STRICT');
      expect(connection.run('INSERT INTO t (cae, total) VALUES (:cae, :total)', { cae: '76', total: 5 })).toEqual(
        expect.objectContaining({ changes: 1 }),
      );
      expect(connection.get('SELECT cae, total FROM t WHERE cae = :cae', { cae: '76' })).toEqual({
        cae: '76',
        total: 5,
      });
      expect(connection.all('SELECT cae FROM t')).toEqual([{ cae: '76' }]);
    } finally {
      connection.close();
    }
  });

  // En Node 26 un `undefined` se guarda como NULL sin avisar (medido en el CI del 25/11): el driver lo frena antes,
  // en todas las versiones.
  it.each(['run', 'get', 'all'] as const)('%s con un parámetro undefined lanza y no escribe', async (method) => {
    const connection = await openTemporary();

    try {
      connection.exec('CREATE TABLE t (cae TEXT PRIMARY KEY, nota TEXT) STRICT');

      const parameters = { cae: '76', nota: undefined } as unknown as SqliteParameters;
      const sql =
        method === 'run' ? 'INSERT INTO t (cae, nota) VALUES (:cae, :nota)' : 'SELECT cae FROM t WHERE nota = :nota';

      expect(() => connection[method](sql, parameters)).toThrow(TypeError);
      expect(() => connection[method](sql, parameters)).toThrow(/nota/);
      expect(connection.all('SELECT cae FROM t')).toEqual([]);
    } finally {
      connection.close();
    }
  });

  // `defensive` no hace nada en Node 22 (medido): ahí no se puede probar. En 24 y 26, escribir sqlite_master falla
  // aunque se prenda `writable_schema`.
  it.runIf(NODE_MAJOR >= 24)('con defensive, escribir sqlite_master falla', async () => {
    const connection = await openTemporary();

    try {
      connection.exec('CREATE TABLE t (cae TEXT PRIMARY KEY) STRICT');

      expect(() =>
        connection.exec("PRAGMA writable_schema = ON; UPDATE sqlite_master SET sql = 'basura' WHERE name = 't'"),
      ).toThrow();
      expect(connection.get("SELECT sql FROM sqlite_master WHERE name = 't'")).toEqual({
        sql: 'CREATE TABLE t (cae TEXT PRIMARY KEY) STRICT',
      });
    } finally {
      connection.close();
    }
  });
});

describe('abrir sin crear (ARQ-12 PR 4b)', () => {
  // Si otro proceso apartó la base entre que se miró y se abrió, SQLite no deja una vacía en su lugar.
  it('con mustExist, una que no está da error y no crea nada', async () => {
    const folder = temporaryDataDirectory("arcli-driver ñ #%20'-");

    await expect(
      openSqliteConnection(join(folder, 'comprobantes.db'), { mustExist: true, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: 'ERR_SQLITE_ERROR' });
    expect(readdirSync(folder)).toEqual([]);
  });

  it('con mustExist, una que está (espacios, ñ, #, %20 y apóstrofo en la ruta) se abre y se escribe', async () => {
    const folder = temporaryDataDirectory("arcli-driver ñ #%20'-");
    const file = join(folder, 'comprobantes.db');

    (await openSqliteConnection(file, { timeoutMs: 1000 })).close();

    const connection = await openSqliteConnection(file, { mustExist: true, timeoutMs: 1000 });

    try {
      connection.exec('CREATE TABLE t (x INTEGER) STRICT');
      expect(connection.get("SELECT name FROM sqlite_master WHERE name = 't'")).toEqual({ name: 't' });
    } finally {
      connection.close();
    }

    expect(readdirSync(folder)).toEqual(['comprobantes.db']);
  });
});
