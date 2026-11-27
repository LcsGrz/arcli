import { basename, dirname, join } from 'node:path';
import { z } from 'zod';

import { InputValidationError } from '../../lib/errors/app-error';
import type { Clock } from '../../lib/time/clock';
import type { ArcliEnvironment } from '../../modules/config/config.schemas';
import { LocalDataError, type LocalDataErrorReason } from '../../modules/local-data/local-data-error';
import { resolveLocalDataFiles } from '../../modules/local-data/local-data-files';
import type {
  LocalDataRecovery,
  SaveOutcome,
  StoredVoucherRecord,
  VoucherNumber,
  VoucherRecord,
  VoucherRecordStore,
} from '../../modules/vouchers/voucher-record-store';

import { hasDailyBackup, writeBackup } from './backup-files';
import { openRecoveringDatabase } from './damaged';
import { type DatabaseSpec, DEFAULT_BUSY_TIMEOUT_MS, openExistingDatabase, toLocalDataError } from './database-file';
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
  /**
   * Las copias diarias (la primera escritura de cada día argentino). Sin indicar, apagadas hasta que LIBRO-1 conecte la
   * clave de config `copias`. La de antes de migrar se hace siempre, aunque `enabled` sea `false`.
   */
  readonly backups?: { readonly enabled: boolean };
  /** @internal Solo tests: la espera de SQLite por intento, en ms (por defecto 5000). */
  readonly busyTimeoutMs?: number;
  /** @internal Solo tests: pasos que se corren después del esquema v1 (una "menor" de prueba). */
  readonly extraMigrations?: readonly SqliteMigration[];
}

/** Las columnas que lee el puerto, siempre nombradas. */
const RECORD_COLUMNS = [
  'cae',
  'servicio',
  'tipo_arca',
  'punto_venta',
  'numero',
  'fecha',
  'fuente',
  'total_centavos',
  'guardado_el',
].join(', ');

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

/**
 * Lo que entra a la base, validado en el borde del adaptador con los mismos límites que los CHECK del esquema: uno
 * inválido lanza un error claro con el campo, y no un CHECK crudo de SQLite.
 */
const recordSchema = z.object({
  cae: z.string().regex(/^\d+$/, 'tiene que tener solo dígitos'),
  fecha: z.iso.date(),
  fuente: z.string().min(1),
  numero: z.number().int().min(1).max(99_999_999),
  puntoVenta: z.number().int().min(1).max(99_999),
  servicio: z.string().min(1),
  tipo: z.number().int().min(1).max(999),
  totalCentavos: z.number().int().refine(Number.isSafeInteger, 'tiene que ser un entero exacto'),
});

function validateRecord(record: VoucherRecord): void {
  const parsed = recordSchema.safeParse(record);

  if (!parsed.success) {
    const fields = parsed.error.issues.map(({ message, path }) => `${path.join('.')} (${message})`).join(', ');

    throw new InputValidationError(`El comprobante a guardar no es válido: ${fields}.`, {
      campos: parsed.error.issues.map(({ path }) => path.join('.')),
    });
  }
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
  const event = { cae, datos: JSON.stringify(datos), tipo };

  // El mismo CAE con el mismo número equivocado puede llegar muchas veces (un reintento, un lote repetido): con un
  // evento alcanza. `datos` sale siempre con las claves en el mismo orden, así que se compara como texto.
  if (
    tipo === 'conflicto-numero' &&
    connection.get('SELECT id FROM eventos WHERE cae = :cae AND tipo = :tipo AND datos = :datos', event)
  ) {
    return;
  }

  connection.run(
    'INSERT INTO eventos (cae, tipo, ocurrido_el, version_arcli, datos) VALUES (:cae, :tipo, :ocurrido_el, :version_arcli, :datos)',
    { ...event, ocurrido_el: context.now, version_arcli: context.version },
  );
}

/**
 * Las reglas de `save`, adentro de un `BEGIN IMMEDIATE`: el CAE ya guardado con otro número no se pisa
 * (`conflicto-numero`); otro CAE para un número guardado marca el anterior como reemplazado (`reemplazo`). Nunca
 * INSERT OR REPLACE ni borrar filas.
 */
function saveInTransaction(connection: SqliteConnection, record: VoucherRecord, context: SaveContext): SaveOutcome {
  const byCae = connection.get(
    'SELECT tipo_arca, punto_venta, numero, reemplazado_por FROM comprobantes WHERE cae = :cae',
    { cae: record.cae },
  );
  const number = { numero: record.numero, punto_venta: record.puntoVenta, tipo_arca: record.tipo };
  const currentCae = () =>
    connection.get(
      'SELECT cae FROM comprobantes WHERE tipo_arca = :tipo_arca AND punto_venta = :punto_venta AND numero = :numero AND reemplazado_por IS NULL',
      number,
    )?.cae;

  if (byCae) {
    if (sameNumber(record, byCae)) {
      // Un CAE reemplazado que vuelve no vuelve a valer: se dice cuál es el vigente.
      return byCae.reemplazado_por === null
        ? { kind: 'already-saved' }
        : { kind: 'already-saved', replacedBy: String(currentCae() ?? byCae.reemplazado_por) };
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

  const current = currentCae();
  const previousCae = current === undefined ? undefined : String(current);

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

/** Lo que distingue a comprobantes.db de un CUIT y entorno: ruta, carpetas, dueño, pasos del esquema y copias. */
export function vouchersDatabaseSpec(
  options: Pick<SqliteVoucherRecordStoreOptions, 'busyTimeoutMs' | 'cuit' | 'dataDirectory' | 'environment'>,
  migrations: readonly SqliteMigration[] = VOUCHERS_MIGRATIONS,
): DatabaseSpec {
  const files = resolveLocalDataFiles(options.dataDirectory, options.cuit, options.environment);
  const cuitFolder = dirname(files.folder);

  return {
    backups: { folder: files.backups, prefix: 'comprobantes' },
    lock: join(options.dataDirectory, 'datos', `.turno-${basename(cuitFolder)}-${options.environment}-comprobantes.db`),
    busyTimeoutMs: options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
    file: files.vouchers,
    folders: [join(options.dataDirectory, 'datos'), cuitFolder, files.folder],
    identity: { base: 'comprobantes', emisor_cuit: basename(cuitFolder), entorno: options.environment },
    migrations,
  };
}

/**
 * La copia diaria, después del COMMIT: si `enabled` y es la primera escritura del día argentino. Si falla, lo guardado
 * queda igual y se devuelve la razón, para que quien llama avise.
 */
function dailyBackup(
  connection: SqliteConnection,
  spec: DatabaseSpec,
  now: Date,
): { readonly backupFailed?: { readonly reason: LocalDataErrorReason } } {
  try {
    if (!hasDailyBackup(spec.backups, now)) {
      writeBackup(connection, spec.backups, now, 'daily');
    }

    return {};
  } catch (error) {
    const mapped = toLocalDataError(error);

    return { backupFailed: { reason: mapped instanceof LocalDataError ? mapped.reason : 'unavailable' } };
  }
}

/**
 * Los comprobantes de un CUIT y entorno en SQLite. No abre nada al armarse: cada operación abre, hace lo suyo y
 * cierra, y la base se crea en el primer `save`. Leer sin base no crea nada. Cada operación entera se reintenta si
 * la base está tomada por otro proceso (abrir también puede escribir: migrar). Solo `save` aparta y repone una base
 * dañada (damaged.ts); leer una dañada da `damaged` sin tocarla.
 *
 * @internal Lo conecta LIBRO-1.
 */
export function openSqliteVoucherRecordStore(options: SqliteVoucherRecordStoreOptions): VoucherRecordStore {
  const migrations = [...VOUCHERS_MIGRATIONS, ...(options.extraMigrations ?? [])];
  const spec = () => vouchersDatabaseSpec(options, migrations);

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
      validateRecord(record);

      const databaseSpec = spec();
      const driver = await loadSqliteDriver();
      // Si se repuso la base y después el guardado se reintenta (tomada), el reintento ya la encuentra sana: el dato
      // de la recuperación es del primero.
      let recovered: LocalDataRecovery | undefined;

      return withWriteRetry(async (): Promise<SaveOutcome> => {
        const saveContext = context();
        const opened = await openRecoveringDatabase(driver, databaseSpec, saveContext);
        const { connection } = opened;

        recovered ??= opened.recovered;

        try {
          const outcome = inImmediateTransaction(connection, () => saveInTransaction(connection, record, saveContext));
          const backup = options.backups?.enabled
            ? dailyBackup(connection, databaseSpec, new Date(saveContext.now))
            : {};

          return { ...outcome, ...(recovered === undefined ? {} : { recovered }), ...backup };
        } catch (error) {
          throw toLocalDataError(error);
        } finally {
          connection.close();
        }
      });
    },
  };
}
