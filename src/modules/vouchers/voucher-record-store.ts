import type { LocalDataErrorReason } from '../local-data/local-data-error';

/**
 * El puerto de los comprobantes guardados en esta computadora (ARQ-12). El adaptador sobre SQLite está en
 * src/services/data; lo usa LIBRO-1. Un comprobante se identifica por su CAE, y tipo + punto de venta + número es
 * único entre los que no fueron reemplazados.
 */

/** Tipo, punto de venta y número: lo que ARCA numera. */
export interface VoucherNumber {
  readonly numero: number;
  readonly puntoVenta: number;
  /** El código de ARCA del tipo de comprobante (`11` es Factura C). */
  readonly tipo: number;
}

/**
 * Lo mínimo para guardar un comprobante en 4a; el resto lo suma LIBRO-1 como opcional (columnas que quedan NULL).
 */
export interface VoucherRecord extends VoucherNumber {
  readonly cae: string;
  /** `YYYY-MM-DD`. */
  readonly fecha: string;
  /** Cómo entró: `emitido`, `arca`, `importado` (lista abierta). */
  readonly fuente: string;
  /** `wsfe` o `wsfex` (lista abierta). */
  readonly servicio: string;
  readonly totalCentavos: number;
}

/** Lo guardado, con cuándo se guardó (ISO UTC). */
export interface StoredVoucherRecord extends VoucherRecord {
  readonly savedAt: string;
}

/**
 * Qué pasó al guardar:
 *
 * - `saved`: era nuevo.
 * - `already-saved`: ya estaba con el mismo CAE y número; no cambia nada. Si ese CAE fue reemplazado, `replacedBy`
 *   es el CAE vigente de ese número: el reemplazado no vuelve a valer.
 * - `cae-on-other-number`: el CAE ya estaba con otro número; no se pisa (queda un evento `conflicto-numero`, uno por
 *   CAE y número aunque llegue varias veces).
 * - `replaced`: el número tenía otro CAE; el anterior queda marcado como reemplazado (evento `reemplazo`).
 */
export type SaveOutcome = (
  | { readonly kind: 'already-saved'; readonly replacedBy?: string }
  | { readonly kind: 'cae-on-other-number'; readonly saved: VoucherNumber }
  | { readonly kind: 'replaced'; readonly previousCae: string }
  | { readonly kind: 'saved' }
) &
  SaveSideEffects;

/**
 * Lo que pasó además al guardar, para que quien llama avise (LIBRO-1). Cada clave está solo si pasó:
 *
 * - `recovered`: la base estaba dañada; se apartó y se repuso antes de guardar.
 * - `backupFailed`: lo guardado quedó, pero la copia diaria no se pudo hacer (`reason`, la de `LocalDataError`).
 */
interface SaveSideEffects {
  readonly recovered?: LocalDataRecovery;
  readonly backupFailed?: { readonly reason: LocalDataErrorReason };
}

/** Una base dañada que se apartó y se repuso (ARQ-12 PR 4b). Nada se borra. */
export interface LocalDataRecovery {
  /** Donde quedó la dañada: `comprobantes.danada-<día>-<hora>.db`, en la carpeta de la base (con su `-journal`). */
  readonly setAside: string;
  /** La copia desde la que se repuso (queda donde estaba); sin copia sana, no está y la base nueva salió vacía. */
  readonly restoredFrom?: string;
}

/** Los errores de la base son `LocalDataError` (src/modules/local-data/local-data-error.ts). */
export interface VoucherRecordStore {
  save(record: VoucherRecord): Promise<SaveOutcome>;
  findByCae(cae: string): Promise<StoredVoucherRecord | undefined>;
  /** Solo entre los que no fueron reemplazados. */
  findByNumber(number: VoucherNumber): Promise<StoredVoucherRecord | undefined>;
}
