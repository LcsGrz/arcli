/**
 * El puerto del almacenamiento de la config (ARQ-12 PR 3): el núcleo lee y escribe por acá, y `conf` queda en el
 * adaptador. Sin bloqueo entre procesos: lo suma ARQ-26 detrás del mismo puerto.
 */

/**
 * Lo guardado en el archivo, sin validar.
 *
 * @internal Tests primero (ARQ-12 PR 3): todavía solo lo usan los tests; se saca al usarlo ConfigService.
 */
export type StoredConfig = Record<string, unknown>;

/** @internal Tests primero (ARQ-12 PR 3): todavía solo lo usan los tests; se saca al usarlo ConfigService. */
export interface ConfigStore {
  readonly path: string;
  /** `{}` si no existe o no es un objeto; JSON inválido: SyntaxError. */
  read(): StoredConfig;
  /** Relee, aplica y escribe lo que devuelva (`undefined`: no escribe). Si `change` lanza, no escribe. */
  update(change: (saved: StoredConfig) => StoredConfig | undefined): void;
}
