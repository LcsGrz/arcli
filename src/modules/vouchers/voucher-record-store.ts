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
 * - `already-saved`: ya estaba con el mismo CAE y número; no cambia nada.
 * - `cae-on-other-number`: el CAE ya estaba con otro número; no se pisa (queda un evento `conflicto-numero`).
 * - `replaced`: el número tenía otro CAE; el anterior queda marcado como reemplazado (evento `reemplazo`).
 */
export type SaveOutcome =
  | { readonly kind: 'already-saved' }
  | { readonly kind: 'cae-on-other-number'; readonly saved: VoucherNumber }
  | { readonly kind: 'replaced'; readonly previousCae: string }
  | { readonly kind: 'saved' };

/** Los errores de la base son `LocalDataError` (src/modules/local-data/local-data-error.ts). */
export interface VoucherRecordStore {
  save(record: VoucherRecord): Promise<SaveOutcome>;
  findByCae(cae: string): Promise<StoredVoucherRecord | undefined>;
  /** Solo entre los que no fueron reemplazados. */
  findByNumber(number: VoucherNumber): Promise<StoredVoucherRecord | undefined>;
}
