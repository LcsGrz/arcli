import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { openSqliteConnection, type SqliteParameters } from '../sqlite-driver';

import { temporaryDataDirectory } from './local-data.fixtures';

const NODE_MAJOR = Number(process.versions.node.split('.')[0]);

async function openTemporary() {
  return openSqliteConnection(join(temporaryDataDirectory('arcli-driver-'), 'prueba.db'), { timeoutMs: 1000 });
}

describe('sqlite-driver (ARQ-12)', () => {
  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('abre, escribe y lee con parámetros con nombre', async () => {
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
  // en todas las versiones. Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails.each(['run', 'get', 'all'] as const)('%s con un parámetro undefined lanza y no escribe', async (method) => {
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
  // aunque se prenda `writable_schema`. Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.runIf(NODE_MAJOR >= 24).fails('con defensive, escribir sqlite_master falla', async () => {
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
