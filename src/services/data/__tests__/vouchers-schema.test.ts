import { readFileSync } from 'node:fs';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { ensureClientsDatabase } from '../clients-database';

import {
  APPLICATION_ID,
  clientsFile,
  CUIT,
  fingerprint,
  inMemory,
  inspect,
  movableClock,
  NOW,
  openStore,
  permissions,
  scalar,
  SCHEMA_V1,
  temporaryDataDirectory,
  VERSION,
  voucherRecord,
  vouchersFile,
  withPermissions,
} from './local-data.fixtures';

const VOUCHERS_DDL = readFileSync(new URL('fixtures/comprobantes-v1.sql', import.meta.url), 'utf8');
const CLIENTS_DDL = readFileSync(new URL('fixtures/clientes-v1.sql', import.meta.url), 'utf8');

const normalize = (sql: unknown) => String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * El SQL con que se creó cada objeto, sin comentarios `--` y con los espacios colapsados: un CHECK o un DEFAULT
 * cambiado no se ve en los pragmas, y acá sí (revisión del 27/11).
 */
const definition = (sql: unknown) => normalize(String(sql).replace(/--[^\n]*/g, ''));

/**
 * Tablas, columnas, claves e índices (con su `WHERE` si es parcial), en un orden fijo. Las columnas van por nombre: el
 * código nunca depende de su posición. Los CHECK se prueban aparte, por lo que dejan entrar.
 */
function structure(database: DatabaseSync) {
  const objects = database
    .prepare(
      "SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string; sql: string; tableName: string; type: string }[];

  return objects.map(({ name, sql, tableName, type }) => {
    if (type === 'table') {
      const strict = database.prepare(`SELECT strict FROM pragma_table_list WHERE name = '${name}'`).get();
      const columns = database
        .prepare(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_xinfo('${name}') ORDER BY name`)
        .all();
      const foreignKeys = database
        .prepare(`SELECT "table", "from", "to" FROM pragma_foreign_key_list('${name}') ORDER BY "from"`)
        .all();

      return { columns, definition: definition(sql), foreignKeys, name, strict, type };
    }

    const index = database
      .prepare(`SELECT "unique", partial FROM pragma_index_list('${tableName}') WHERE name = '${name}'`)
      .get();
    const columns = database.prepare(`SELECT name FROM pragma_index_info('${name}') ORDER BY seqno`).all();
    const where = /\bwhere\b(.*)$/i.exec(normalize(sql))?.[1]?.trim();

    return { columns, definition: definition(sql), index, name, tableName, type, where };
  });
}

/** Una fila de comprobantes con lo obligatorio, y lo que cada test cambie. */
function insertVoucher(database: DatabaseSync, overrides: Record<string, SQLInputValue> = {}): void {
  const row: Record<string, SQLInputValue> = {
    actualizado_el: NOW,
    cae: '76000000000001',
    esquema_actualizado: SCHEMA_V1,
    esquema_guardado: SCHEMA_V1,
    fecha: '2026-11-26',
    fuente: 'emitido',
    guardado_el: NOW,
    numero: 50,
    punto_venta: 2,
    servicio: 'wsfe',
    tipo_arca: 11,
    total_centavos: 100,
    version_arcli_actualizado: VERSION,
    version_arcli_guardado: VERSION,
    ...overrides,
  };
  const names = Object.keys(row);

  database
    .prepare(`INSERT INTO comprobantes (${names.join(', ')}) VALUES (${names.map((name) => `:${name}`).join(', ')})`)
    .run(row);
}

async function createdVouchersBase(): Promise<string> {
  const dataDirectory = temporaryDataDirectory();

  await openStore(dataDirectory).save(voucherRecord());

  return vouchersFile(dataDirectory);
}

describe('comprobantes.db v1 (ARQ-12, esquema del 26/11)', () => {
  it('tiene las tablas, columnas e índices del esquema aprobado', async () => {
    const file = await createdVouchersBase();
    const expected = inMemory(VOUCHERS_DDL, structure);

    // Lo sumado el 26/11 está en la referencia: si el DDL del adaptador no lo trae, la comparación lo dice.
    expect(JSON.stringify(expected)).toContain('cotizacion_fecha');
    expect(expected).toContainEqual(
      expect.objectContaining({ name: 'comprobantes_por_lote', where: 'lote_id is not null' }),
    );
    expect(inspect(file, structure)).toEqual(expected);
  });

  it('application_id, user_version y metadatos dicen de quién es la base', async () => {
    const file = await createdVouchersBase();

    inspect(file, (database) => {
      expect(scalar(database, 'PRAGMA application_id')).toBe(APPLICATION_ID);
      expect(scalar(database, 'PRAGMA user_version')).toBe(SCHEMA_V1);
      expect(
        Object.fromEntries(
          database
            .prepare('SELECT clave, valor FROM metadatos')
            .all()
            .map((r) => [r.clave, r.valor]),
        ),
      ).toEqual({
        base: 'comprobantes',
        creada_el: NOW,
        creada_por_version: VERSION,
        emisor_cuit: CUIT,
        entorno: 'testing',
      });
    });
  });

  // Lo que no se llena queda NULL ("no se sabe"), nunca '' ni 0; cada fila sabe con qué ARCLI y esquema se escribió.
  it('la fila guardada: lo del registro, la procedencia y NULL en lo demás', async () => {
    const file = await createdVouchersBase();
    const row = inspect(file, (database) => ({ ...database.prepare('SELECT * FROM comprobantes').get() }));

    expect(row).toMatchObject({
      actualizado_el: NOW,
      cae: '76123456789012',
      cotizacion_fecha: null,
      detalle_completo: 0,
      esquema_actualizado: SCHEMA_V1,
      esquema_guardado: SCHEMA_V1,
      extras: null,
      fecha: '2026-11-26',
      fuente: 'emitido',
      guardado_el: NOW,
      lote_id: null,
      numero: 1,
      punto_venta: 2,
      receptor_nombre: null,
      reemplazado_el: null,
      reemplazado_por: null,
      servicio: 'wsfe',
      tipo_arca: 11,
      total_centavos: 1_210_050,
      version_arcli_actualizado: VERSION,
      version_arcli_guardado: VERSION,
    });
  });

  // json_valid y json_type en CHECK, STRICT e índices parciales: que anden con el SQLite de cada Node (job datos-locales).
  it('los CHECK con json_valid y json_type rechazan lo que no es JSON o no es un objeto', async () => {
    const file = await createdVouchersBase();

    inspect(file, (database) => {
      const event = database.prepare(
        "INSERT INTO eventos (cae, tipo, ocurrido_el, version_arcli, datos) VALUES (NULL, 'prueba', :now, 'x', :datos)",
      );

      expect(() => event.run({ datos: '{malo', now: NOW })).toThrow(/CHECK constraint/);
      expect(() => event.run({ datos: '[1, 2]', now: NOW })).toThrow(/CHECK constraint/);
      expect(() => event.run({ datos: '{"a": 1}', now: NOW })).not.toThrow();
      expect(() => insertVoucher(database, { extras: '[]' })).toThrow(/CHECK constraint/);
      expect(() => insertVoucher(database, { observaciones_arca: 'no es json' })).toThrow(/CHECK constraint/);
      expect(() =>
        database
          .prepare(
            "INSERT INTO documentos (cae, clase, contenido, huella, guardado_el, version_arcli) VALUES ('76123456789012', 'entrada', '{x', 'h', :now, 'x')",
          )
          .run({ now: NOW }),
      ).toThrow(/CHECK constraint/);
    });
  });

  it('STRICT y los CHECK de identidad rechazan tipos y valores que no son', async () => {
    const file = await createdVouchersBase();

    inspect(file, (database) => {
      expect(() => insertVoucher(database, { tipo_arca: 'once' })).toThrow(/cannot store TEXT value in INTEGER column/);
      expect(() => insertVoucher(database, { cae: '76ABC' })).toThrow(/CHECK constraint/);
      expect(() => insertVoucher(database, { cae: '' })).toThrow(/CHECK constraint/);
      expect(() => insertVoucher(database, { fecha: '26/11/2026' })).toThrow(/CHECK constraint/);
      expect(() => insertVoucher(database, { cotizacion: '1515.5' })).toThrow(/CHECK constraint/);
      expect(() => insertVoucher(database, { reemplazado_por: '76000000000009' })).toThrow(/CHECK constraint/);
      expect(() =>
        insertVoucher(database, { cotizacion: '1515.500000', cotizacion_fecha: '2026-11-25' }),
      ).not.toThrow();
    });
  });

  it('el número es único solo entre los no reemplazados (índice parcial)', async () => {
    const file = await createdVouchersBase();

    inspect(file, (database) => {
      expect(() => insertVoucher(database, { cae: '76000000000002', numero: 1 })).toThrow(/UNIQUE constraint/);
      expect(() =>
        insertVoucher(database, {
          cae: '76000000000003',
          numero: 1,
          reemplazado_el: NOW,
          reemplazado_por: '76123456789012',
        }),
      ).not.toThrow();
      expect(scalar(database, 'SELECT count(*) FROM comprobantes WHERE numero = 1')).toBe(2);
    });
  });
});

describe('clientes.db v1 (ARQ-12, esquema del 26/11)', () => {
  it('se crea en datos/<CUIT>/clientes.db con el esquema aprobado y sus metadatos', async () => {
    const dataDirectory = temporaryDataDirectory();

    await ensureClientsDatabase({ clock: movableClock(), cuit: CUIT, dataDirectory, version: VERSION });

    inspect(clientsFile(dataDirectory), (database) => {
      expect(structure(database)).toEqual(inMemory(CLIENTS_DDL, structure));
      expect(scalar(database, 'PRAGMA application_id')).toBe(APPLICATION_ID);
      expect(scalar(database, 'PRAGMA user_version')).toBe(SCHEMA_V1);
      expect(
        Object.fromEntries(
          database
            .prepare('SELECT clave, valor FROM metadatos')
            .all()
            .map((r) => [r.clave, r.valor]),
        ),
      ).toEqual({
        base: 'clientes',
        creada_el: NOW,
        creada_por_version: VERSION,
        emisor_cuit: CUIT,
      });
    });
  });

  it('abrirla otra vez no la cambia', async () => {
    const dataDirectory = temporaryDataDirectory();
    const options = { clock: movableClock(), cuit: CUIT, dataDirectory, version: VERSION };

    await ensureClientsDatabase(options);

    const before = fingerprint(clientsFile(dataDirectory));

    await ensureClientsDatabase({ ...options, version: '10.0.0' });

    expect(fingerprint(clientsFile(dataDirectory))).toEqual(before);
  });

  it.runIf(withPermissions)('sale 0600 con umask 022', async () => {
    const previousUmask = process.umask(0o022);

    try {
      const dataDirectory = temporaryDataDirectory();

      await ensureClientsDatabase({ clock: movableClock(), cuit: CUIT, dataDirectory, version: VERSION });

      expect(permissions(clientsFile(dataDirectory))).toBe(0o600);
    } finally {
      process.umask(previousUmask);
    }
  });
});
