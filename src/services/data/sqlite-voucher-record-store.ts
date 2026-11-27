import { basename, dirname, join } from 'node:path';
import { z } from 'zod';

import type { Clock } from '../../lib/time/clock';
import type { ArcliEnvironment } from '../../modules/config/config.schemas';
import { LocalDataError } from '../../modules/local-data/local-data-error';
import { resolveLocalDataFiles } from '../../modules/local-data/local-data-files';
import type {
  SaveOutcome,
  StoredVoucherRecord,
  VoucherNumber,
  VoucherRecord,
  VoucherRecordStore,
} from '../../modules/vouchers/voucher-record-store';

import {
  type DatabaseSpec,
  DEFAULT_BUSY_TIMEOUT_MS,
  openExistingDatabase,
  openOrCreateDatabase,
  toLocalDataError,
} from './database-file';
import { inImmediateTransaction, latestVersion, type MigrationContext, type SqliteMigration } from './migrations';
import { loadSqliteDriver, type SqliteConnection } from './sqlite-driver';
import { VOUCHERS_MIGRATIONS } from './vouchers-schema';
import { withWriteRetry } from './write-retry';

export interface SqliteVoucherRecordStoreOptions {
  readonly clock: Clock;
  readonly cuit: string;
  /** La carpeta de datos (la de la config): la base va en `datos/<CUIT>/<entorno>/comprobantes.db`. */
  readonly dataDirectory: string;
  readonly environment: ArcliEnvironment;
  /** La versión de ARCLI que escribe, para `metadatos`, `migraciones` y cada fila. */
  readonly version: string;
  /** @internal Solo tests: la espera de SQLite por intento, en ms (por defecto 5000). */
  readonly busyTimeoutMs?: number;
  /** @internal Solo tests: pasos que se corren después del esquema v1 (una "menor" de prueba). */
  readonly extraMigrations?: readonly SqliteMigration[];
}

/** Las columnas que lee el puerto, siempre nombradas. */
const RECORD_COLUMNS = 'cae, servicio, tipo_arca, punto_venta, numero, fecha, fuente, total_centavos, guardado_el';

/** Tolerante: una columna de más (una menor nueva) no molesta; una que falta o con otro tipo es una base dañada. */
const storedRowSchema = z.object({
  cae: z.string(),
  fecha: z.string(),
  fuente: z.string(),
  guardado_el: z.string(),
  numero: z.number(),
  punto_venta: z.number(),
  servicio: z.string(),
  tipo_arca: z.number(),
  total_centavos: z.number(),
});

function decodeRecord(row: unknown): StoredVoucherRecord {
  const parsed = storedRowSchema.safeParse(row);

  if (!parsed.success) {
    throw new LocalDataError('damaged', 'Un comprobante guardado no tiene la forma esperada.', {
      cause: parsed.error,
    });
  }

  const { data } = parsed;

  return {
    cae: data.cae,
    fecha: data.fecha,
    fuente: data.fuente,
    numero: data.numero,
    puntoVenta: data.punto_venta,
    savedAt: data.guardado_el,
    servicio: data.servicio,
    tipo: data.tipo_arca,
    totalCentavos: data.total_centavos,
  };
}

const sameNumber = (number: VoucherNumber, row: Readonly<Record<string, unknown>>) =>
  row.tipo_arca === number.tipo && row.punto_venta === number.puntoVenta && row.numero === number.numero;

interface SaveContext extends MigrationContext {
  readonly schema: number;
}

function addEvent(
  connection: SqliteConnection,
  context: SaveContext,
  cae: string,
  tipo: string,
  datos: Record<string, unknown>,
): void {
  connection.run(
    'INSERT INTO eventos (cae, tipo, ocurrido_el, version_arcli, datos) VALUES (:cae, :tipo, :ocurrido_el, :version_arcli, :datos)',
    { cae, datos: JSON.stringify(datos), ocurrido_el: context.now, tipo, version_arcli: context.version },
  );
}

/**
 * Las reglas de `save`, adentro de un `BEGIN IMMEDIATE`: el CAE ya guardado con otro número no se pisa
 * (`conflicto-numero`); otro CAE para un número guardado marca el anterior como reemplazado (`reemplazo`). Nunca
 * INSERT OR REPLACE ni borrar filas.
 */
function saveInTransaction(connection: SqliteConnection, record: VoucherRecord, context: SaveContext): SaveOutcome {
  const byCae = connection.get('SELECT tipo_arca, punto_venta, numero FROM comprobantes WHERE cae = :cae', {
    cae: record.cae,
  });

  if (byCae) {
    if (sameNumber(record, byCae)) {
      return { kind: 'already-saved' };
    }

    addEvent(connection, context, record.cae, 'conflicto-numero', {
      numero: record.numero,
      punto_venta: record.puntoVenta,
      tipo_arca: record.tipo,
    });

    return {
      kind: 'cae-on-other-number',
      saved: { numero: Number(byCae.numero), puntoVenta: Number(byCae.punto_venta), tipo: Number(byCae.tipo_arca) },
    };
  }

  const current = connection.get(
    'SELECT cae FROM comprobantes WHERE tipo_arca = :tipo_arca AND punto_venta = :punto_venta AND numero = :numero AND reemplazado_por IS NULL',
    { numero: record.numero, punto_venta: record.puntoVenta, tipo_arca: record.tipo },
  );
  const previousCae = current === undefined ? undefined : String(current.cae);

  if (previousCae !== undefined) {
    connection.run(
      `UPDATE comprobantes SET reemplazado_por = :reemplazado_por, reemplazado_el = :ahora, actualizado_el = :ahora,
        version_arcli_actualizado = :version, esquema_actualizado = :esquema WHERE cae = :cae`,
      {
        ahora: context.now,
        cae: previousCae,
        esquema: context.schema,
        reemplazado_por: record.cae,
        version: context.version,
      },
    );
  }

  connection.run(
    `INSERT INTO comprobantes (cae, servicio, tipo_arca, punto_venta, numero, fecha, fuente, total_centavos,
      guardado_el, actualizado_el, version_arcli_guardado, version_arcli_actualizado, esquema_guardado, esquema_actualizado)
    VALUES (:cae, :servicio, :tipo_arca, :punto_venta, :numero, :fecha, :fuente, :total_centavos,
      :ahora, :ahora, :version, :version, :esquema, :esquema)`,
    {
      ahora: context.now,
      cae: record.cae,
      esquema: context.schema,
      fecha: record.fecha,
      fuente: record.fuente,
      numero: record.numero,
      punto_venta: record.puntoVenta,
      servicio: record.servicio,
      tipo_arca: record.tipo,
      total_centavos: record.totalCentavos,
      version: context.version,
    },
  );

  if (previousCae === undefined) {
    return { kind: 'saved' };
  }

  addEvent(connection, context, record.cae, 'reemplazo', { cae_anterior: previousCae });

  return { kind: 'replaced', previousCae };
}

/**
 * Los comprobantes de un CUIT y entorno en SQLite. No abre nada al armarse: cada operación abre, hace lo suyo y
 * cierra, y la base se crea en el primer `save`. Leer sin base no crea nada. Cada operación entera se reintenta si
 * la base está tomada por otro proceso (abrir también puede escribir: migrar).
 *
 * @internal Lo conecta LIBRO-1.
 */
export function openSqliteVoucherRecordStore(options: SqliteVoucherRecordStoreOptions): VoucherRecordStore {
  const migrations = [...VOUCHERS_MIGRATIONS, ...(options.extraMigrations ?? [])];

  function spec(): DatabaseSpec {
    const files = resolveLocalDataFiles(options.dataDirectory, options.cuit, options.environment);
    const cuitFolder = dirname(files.folder);

    return {
      busyTimeoutMs: options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
      file: files.vouchers,
      folders: [join(options.dataDirectory, 'datos'), cuitFolder, files.folder],
      identity: { base: 'comprobantes', emisor_cuit: basename(cuitFolder), entorno: options.environment },
      migrations,
    };
  }

  const context = (): SaveContext => ({
    now: options.clock.now().toISOString(),
    schema: latestVersion(migrations),
    version: options.version,
  });

  async function read<T>(query: (connection: SqliteConnection) => T): Promise<T | undefined> {
    const databaseSpec = spec();
    const driver = await loadSqliteDriver();

    return withWriteRetry(() => {
      const connection = openExistingDatabase(driver, databaseSpec, context());

      if (connection === undefined) {
        return undefined;
      }

      try {
        return query(connection);
      } catch (error) {
        throw toLocalDataError(error);
      } finally {
        connection.close();
      }
    });
  }

  return {
    async findByCae(cae) {
      return read((connection) => {
        const row = connection.get(`SELECT ${RECORD_COLUMNS} FROM comprobantes WHERE cae = :cae`, { cae });

        return row === undefined ? undefined : decodeRecord(row);
      });
    },

    async findByNumber(number) {
      return read((connection) => {
        const row = connection.get(
          `SELECT ${RECORD_COLUMNS} FROM comprobantes
          WHERE tipo_arca = :tipo_arca AND punto_venta = :punto_venta AND numero = :numero AND reemplazado_por IS NULL`,
          { numero: number.numero, punto_venta: number.puntoVenta, tipo_arca: number.tipo },
        );

        return row === undefined ? undefined : decodeRecord(row);
      });
    },

    async save(record) {
      const databaseSpec = spec();
      const driver = await loadSqliteDriver();

      return withWriteRetry(() => {
        const saveContext = context();
        const connection = openOrCreateDatabase(driver, databaseSpec, saveContext);

        try {
          return inImmediateTransaction(connection, () => saveInTransaction(connection, record, saveContext));
        } catch (error) {
          throw toLocalDataError(error);
        } finally {
          connection.close();
        }
      });
    },
  };
}
