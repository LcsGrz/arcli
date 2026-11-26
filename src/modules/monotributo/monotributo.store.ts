import type { ArcliEnvironment } from '../config/config.schemas';

import type { MonotributoCategoryLetter, MonotributoTable } from './monotributo';

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

/**
 * Lo que el comando guarda entre ejecuciones. El del disco es `FileMonotributoStore` (src/services/files); los tests lo
 * cambian por uno en memoria.
 */
export interface MonotributoStore {
  /** Fecha (yyyymmdd) del primer intento de consultar ARCA sin `--actualizar`; undefined si nunca se intento. */
  readFirstAttempt(): string | undefined;
  readOwnCategory(): SavedOwnCategory | undefined;
  readTable(): SavedMonotributoTable | undefined;
  saveFirstAttempt(date: string): void;
  saveOwnCategory(category: SavedOwnCategory): void;
  saveTable(saved: SavedMonotributoTable): void;
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
