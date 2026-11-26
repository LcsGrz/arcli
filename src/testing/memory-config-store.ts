import type { ConfigStore, StoredConfig } from '../modules/config/config-store';

interface MemoryConfigStoreOptions {
  /** Lo guardado al empezar. */
  readonly initial?: StoredConfig;
  readonly path?: string;
}

/**
 * La config en memoria, para probar ConfigService sin disco. `beforeUpdate` corre al entrar a cada `update`, antes de
 * releer: simula a otro proceso que escribió entre la lectura de ConfigService y su escritura.
 */
export class MemoryConfigStore implements ConfigStore {
  public readonly path: string;
  /** Cuántas veces se llamó a `update`, escriba o no. */
  public updates = 0;
  /** Lo que escribió cada `update` que escribió, en orden. */
  public readonly writes: StoredConfig[] = [];
  /** Recibe lo guardado y lo puede cambiar, como otro proceso. */
  public beforeUpdate?: (saved: StoredConfig) => void;
  private saved: StoredConfig;

  public constructor({ initial = {}, path = '/arcli-memoria/config.json' }: MemoryConfigStoreOptions = {}) {
    this.path = path;
    this.saved = structuredClone(initial);
  }

  public read(): StoredConfig {
    return structuredClone(this.saved);
  }

  public update(change: (saved: StoredConfig) => StoredConfig | undefined): void {
    this.updates += 1;
    this.beforeUpdate?.(this.saved);

    const next = change(structuredClone(this.saved));

    if (next !== undefined) {
      this.saved = structuredClone(next);
      this.writes.push(structuredClone(next));
    }
  }
}
