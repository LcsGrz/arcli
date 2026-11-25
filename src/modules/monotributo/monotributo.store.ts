import Conf from 'conf';
import { z } from 'zod';

import { requireDataDirectory } from '../../lib/files/require-data-directory';
import type { ArcliEnvironment } from '../config/config.schemas';

import { MONOTRIBUTO_CATEGORY_LETTERS, type MonotributoCategoryLetter, type MonotributoTable } from './monotributo';
import { deserializeMonotributoTable, serializeMonotributoTable } from './monotributo.serialization';

/** La tabla leida de ARCA, con la fecha de consulta (yyyymmdd). */
export interface SavedMonotributoTable {
  readonly consultedOn: string;
  readonly table: MonotributoTable;
}

/** La categoria del padron para un CUIT y entorno: null si ARCA contesto que no es monotributista. */
export interface SavedOwnCategory {
  readonly consultedOn: string;
  readonly cuit: string;
  readonly environment: ArcliEnvironment;
  readonly letter: MonotributoCategoryLetter | null;
}

/** Lo que el comando guarda entre ejecuciones. Los tests lo cambian por uno en memoria. */
export interface MonotributoStore {
  /** Fecha (yyyymmdd) del primer intento de consultar ARCA sin `--actualizar`; undefined si nunca se intento. */
  readFirstAttempt(): string | undefined;
  readOwnCategory(): SavedOwnCategory | undefined;
  readTable(): SavedMonotributoTable | undefined;
  saveFirstAttempt(date: string): void;
  saveOwnCategory(category: SavedOwnCategory): void;
  saveTable(saved: SavedMonotributoTable): void;
}

const dateSchema = z.string().regex(/^\d{8}$/);

const ownCategorySchema = z.object({
  consultadaEl: dateSchema,
  cuit: z.string(),
  entorno: z.enum(['testing', 'produccion']),
  letra: z.enum(MONOTRIBUTO_CATEGORY_LETTERS).nullable(),
});

const savedTableSchema = z.object({ consultadaEl: dateSchema, tabla: z.unknown() });

/**
 * `monotributo.json` en la carpeta de datos: la tabla consultada, la categoria del padron y si ya se intento la
 * primera consulta. Es un cache: si el archivo no se puede leer o no pasa el control, se ignora (y Conf lo vacia).
 */
export class FileMonotributoStore implements MonotributoStore {
  private readonly store: Conf<Record<string, unknown>>;

  public constructor(cwd: string) {
    this.store = new Conf<Record<string, unknown>>({
      clearInvalidConfig: true,
      configName: 'monotributo',
      cwd: requireDataDirectory(cwd),
    });
  }

  public readFirstAttempt(): string | undefined {
    const result = dateSchema.safeParse(this.store.get('primeraConsulta'));

    return result.success ? result.data : undefined;
  }

  public readOwnCategory(): SavedOwnCategory | undefined {
    const result = ownCategorySchema.safeParse(this.store.get('tuCategoria'));

    if (!result.success) return undefined;

    const { consultadaEl, cuit, entorno, letra } = result.data;

    return { consultedOn: consultadaEl, cuit, environment: entorno, letter: letra };
  }

  public readTable(): SavedMonotributoTable | undefined {
    const result = savedTableSchema.safeParse(this.store.get('tablaGuardada'));
    const table = result.success ? deserializeMonotributoTable(result.data.tabla) : undefined;

    return result.success && table ? { consultedOn: result.data.consultadaEl, table } : undefined;
  }

  public saveFirstAttempt(date: string): void {
    this.store.set('primeraConsulta', date);
  }

  public saveOwnCategory(category: SavedOwnCategory): void {
    this.store.set('tuCategoria', {
      consultadaEl: category.consultedOn,
      cuit: category.cuit,
      entorno: category.environment,
      letra: category.letter,
    });
  }

  public saveTable(saved: SavedMonotributoTable): void {
    this.store.set('tablaGuardada', { consultadaEl: saved.consultedOn, tabla: serializeMonotributoTable(saved.table) });
  }
}

/** Un store en memoria, para tests y para cuando no se puede escribir en la carpeta de config. */
export class MemoryMonotributoStore implements MonotributoStore {
  private firstAttempt?: string;
  private ownCategory?: SavedOwnCategory;
  private table?: SavedMonotributoTable;

  public constructor(
    initial: { firstAttempt?: string; ownCategory?: SavedOwnCategory; table?: SavedMonotributoTable } = {},
  ) {
    this.firstAttempt = initial.firstAttempt;
    this.ownCategory = initial.ownCategory;
    this.table = initial.table;
  }

  public readFirstAttempt(): string | undefined {
    return this.firstAttempt;
  }

  public readOwnCategory(): SavedOwnCategory | undefined {
    return this.ownCategory;
  }

  public readTable(): SavedMonotributoTable | undefined {
    return this.table;
  }

  public saveFirstAttempt(date: string): void {
    this.firstAttempt = date;
  }

  public saveOwnCategory(category: SavedOwnCategory): void {
    this.ownCategory = category;
  }

  public saveTable(saved: SavedMonotributoTable): void {
    this.table = saved;
  }
}
