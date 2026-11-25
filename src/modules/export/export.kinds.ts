/** WSFEX solo emite comprobantes de exportacion, asi que la letra es siempre E. 19 es la Factura E. */
export const EXPORT_VOUCHER_KIND = {
  arcaType: 19,
  displayName: 'Factura de exportación E',
  /** El titulo de la E de Comprobantes en linea, en lugar del "FACTURA" de la plantilla del PDF. */
  pdfTitle: 'FACTURA DE EXPORTACIÓN',
  family: 'factura',
  letter: 'e',
  shortcut: 'fe',
} as const;

/** 20, "Nota de Débito por operaciones con el Exterior". */
export const EXPORT_DEBIT_NOTE_KIND = {
  arcaType: 20,
  displayName: 'Nota de débito de exportación E',
  pdfTitle: 'NOTA DE DÉBITO DE EXPORTACIÓN',
  family: 'nota-debito',
  letter: 'e',
  shortcut: 'nde',
} as const;

/** 21, "Nota de Crédito por operaciones con el Exterior". */
export const EXPORT_CREDIT_NOTE_KIND = {
  arcaType: 21,
  displayName: 'Nota de crédito de exportación E',
  pdfTitle: 'NOTA DE CRÉDITO DE EXPORTACIÓN',
  family: 'nota-credito',
  letter: 'e',
  shortcut: 'nce',
} as const;

export const EXPORT_VOUCHER_KINDS = [EXPORT_VOUCHER_KIND, EXPORT_DEBIT_NOTE_KIND, EXPORT_CREDIT_NOTE_KIND] as const;

export type ExportVoucherKind = (typeof EXPORT_VOUCHER_KINDS)[number];

/** La E de una familia de A, B y C (`factura`, `nota-credito`, `nota-debito`), si la tiene. */
export function getExportVoucherKindByFamily(family: string): ExportVoucherKind | undefined {
  return EXPORT_VOUCHER_KINDS.find((kind) => kind.family === family);
}

export function getExportVoucherKindByShortcut(shortcut: string): ExportVoucherKind | undefined {
  return EXPORT_VOUCHER_KINDS.find((kind) => kind.shortcut === shortcut.trim().toLowerCase());
}

export function getExportVoucherKindByArcaType(arcaType: number): ExportVoucherKind | undefined {
  return EXPORT_VOUCHER_KINDS.find((kind) => kind.arcaType === arcaType);
}

/** Las notas E llevan comprobante asociado y no llevan permisos, fecha de pago ni `CanMisMonExt`. */
export function isExportNote(kind: ExportVoucherKind): boolean {
  return kind.arcaType !== EXPORT_VOUCHER_KIND.arcaType;
}
