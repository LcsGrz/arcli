export type VoucherLetter = 'a' | 'b' | 'c';

export type VoucherFamily =
  | 'factura'
  | 'nota-credito'
  | 'nota-debito'
  | 'factura-credito-electronica'
  | 'nota-credito-electronica'
  | 'nota-debito-electronica';

export type VoucherShortcut =
  | 'fa'
  | 'fb'
  | 'fc'
  | 'nca'
  | 'ncb'
  | 'ncc'
  | 'nda'
  | 'ndb'
  | 'ndc'
  | 'fcea'
  | 'fceb'
  | 'fcec'
  | 'ncea'
  | 'nceb'
  | 'ncec'
  | 'ndea'
  | 'ndeb'
  | 'ndec';

export type VoucherDisplayName =
  | 'Factura A'
  | 'Factura B'
  | 'Factura C'
  | 'Nota de credito A'
  | 'Nota de credito B'
  | 'Nota de credito C'
  | 'Nota de debito A'
  | 'Nota de debito B'
  | 'Nota de debito C'
  | 'Factura de credito electronica A'
  | 'Factura de credito electronica B'
  | 'Factura de credito electronica C'
  | 'Nota de credito electronica A'
  | 'Nota de credito electronica B'
  | 'Nota de credito electronica C'
  | 'Nota de debito electronica A'
  | 'Nota de debito electronica B'
  | 'Nota de debito electronica C';

export interface VoucherKindDefinition {
  readonly arcaType: number;
  readonly displayName: VoucherDisplayName;
  readonly family: VoucherFamily;
  readonly isElectronicCredit: boolean;
  readonly letter: VoucherLetter;
  readonly requiresAssociatedVoucher: boolean;
  readonly shortcut: VoucherShortcut;
}
