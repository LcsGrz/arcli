import { z } from 'zod';

import type { ConfigStore } from '../../modules/config/config-store';
import { MONOTRIBUTO_CATEGORY_LETTERS } from '../../modules/monotributo/monotributo';
import {
  deserializeMonotributoTable,
  serializeMonotributoTable,
} from '../../modules/monotributo/monotributo.serialization';
import type {
  MonotributoStore,
  SavedMonotributoTable,
  SavedOwnCategory,
} from '../../modules/monotributo/monotributo.store';

import { openConfConfigStore } from './conf-config-store';

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
 * primera consulta. Es un cache: si el archivo no se puede leer o no pasa el control, se ignora (y se reemplaza al
 * guardar).
 */
export class FileMonotributoStore implements MonotributoStore {
  private readonly store: ConfigStore;

  public constructor(cwd: string) {
    this.store = openConfConfigStore({ configName: 'monotributo', cwd, invalid: 'empty' });
    // Se abre ya: si la carpeta no se puede usar falla aca, y quien lo abre sigue con uno en memoria.
    this.store.read();
  }

  public readFirstAttempt(): string | undefined {
    const result = dateSchema.safeParse(this.store.read().primeraConsulta);

    return result.success ? result.data : undefined;
  }

  public readOwnCategory(): SavedOwnCategory | undefined {
    const result = ownCategorySchema.safeParse(this.store.read().tuCategoria);

    if (!result.success) return undefined;

    const { consultadaEl, cuit, entorno, letra } = result.data;

    return { consultedOn: consultadaEl, cuit, environment: entorno, letter: letra };
  }

  public readTable(): SavedMonotributoTable | undefined {
    const result = savedTableSchema.safeParse(this.store.read().tablaGuardada);
    const table = result.success ? deserializeMonotributoTable(result.data.tabla) : undefined;

    return result.success && table ? { consultedOn: result.data.consultadaEl, table } : undefined;
  }

  public saveFirstAttempt(date: string): void {
    this.save('primeraConsulta', date);
  }

  public saveOwnCategory(category: SavedOwnCategory): void {
    this.save('tuCategoria', {
      consultadaEl: category.consultedOn,
      cuit: category.cuit,
      entorno: category.environment,
      letra: category.letter,
    });
  }

  public saveTable(saved: SavedMonotributoTable): void {
    this.save('tablaGuardada', { consultadaEl: saved.consultedOn, tabla: serializeMonotributoTable(saved.table) });
  }

  /** Una clave sobre lo que se relee, en un solo `update`: lo que guardo otro proceso queda. */
  private save(key: string, value: unknown): void {
    this.store.update((saved) => ({ ...saved, [key]: value }));
  }
}
