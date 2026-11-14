import { formatArgentineAmountInput } from '../../lib/numbers/argentine-amount';
import { DEFAULT_EXPORT_PAYMENT_TERMS } from '../export/export.mappers';
import {
  DEFAULT_EXPORT_TYPE,
  DEFAULT_EXPORT_UNIT_CODE,
  EXPORT_VOUCHER_KIND,
  type ExportItemInput,
  type ExportVoucherInput,
  isExportNote,
} from '../export/export.types';

/** Comillas solo cuando hacen falta, para que se pueda pegar en bash, zsh o fish. */
function quote(value: string): string {
  return /^[\w./:,-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

/** Un `--item` en el formato del CLI: `codigo|descripcion|cantidad|precio|unidad`, sin las partes por defecto. */
function itemArgument(item: ExportItemInput): string {
  const unit = item.unit ?? DEFAULT_EXPORT_UNIT_CODE;
  const parts = [
    ...(item.code?.trim() ? [item.code.trim()] : []),
    item.description.trim(),
    formatArgentineAmountInput(item.quantity),
    formatArgentineAmountInput(item.unitPrice),
  ];

  // Con codigo van las cinco partes; sin codigo, la unidad solo si no es la de por defecto.
  if (item.code?.trim() || unit !== DEFAULT_EXPORT_UNIT_CODE) parts.push(String(unit));

  return parts.join('|');
}

/**
 * `arcli fe`, `nde` o `nce` que reproduce la E armada por el asistente. En la factura la actividad va siempre
 * explicita: si la config cambia, el comando pegado sigue informando la misma. Las notas la toman del asociado.
 */
export function buildExportEquivalentCommand(
  input: ExportVoucherInput,
  options: { readonly activity?: number; readonly environment: 'produccion' | 'testing' },
): string {
  const kind = input.voucherKind ?? EXPORT_VOUCHER_KIND;
  const parts = ['arcli', kind.shortcut, '-m', formatArgentineAmountInput(input.amount ?? 0)];
  const associated = input.associatedVoucher;

  if (isExportNote(kind) && associated?.number !== undefined) {
    parts.push('--ar', String(associated.number));
    if (associated.pointOfSale !== undefined) parts.push('--apv', String(associated.pointOfSale));
    if (associated.shortcut && associated.shortcut !== EXPORT_VOUCHER_KIND.shortcut)
      parts.push('--ac', associated.shortcut);
  }

  const text = (flag: string, value: string | undefined) => {
    if (value?.trim()) parts.push(flag, quote(value.trim()));
  };

  text('--cliente', input.clientName);
  text('--domicilio-cliente', input.clientAddress);
  text('--pais-destino', input.destinationCountry);
  text('--id-impositivo', input.clientTaxId);
  if (input.clientCountryCuit !== undefined) parts.push('--cuit-pais', String(input.clientCountryCuit));

  if (input.exportType !== undefined && input.exportType !== DEFAULT_EXPORT_TYPE) {
    parts.push('--tipo-expo', String(input.exportType));
  }

  if (options.activity !== undefined) parts.push('--actividad', String(options.activity));

  if (input.voucherNumber !== undefined) parts.push('--numero', String(input.voucherNumber));

  text('--descripcion', input.description);
  for (const item of input.items ?? []) text('--item', itemArgument(item));
  text('--moneda', input.currencyCode);
  if (input.exchangeRate !== undefined) parts.push('--cm', formatArgentineAmountInput(input.exchangeRate));
  if (input.sameCurrency) parts.push('--misma-moneda');
  text('--incoterm', input.incoterm);
  text('--incoterms-desc', input.incotermDescription);
  // Siempre que se eligio: en una nota, sin el flag se hereda el idioma del asociado.
  if (input.language !== undefined) parts.push('--idioma', String(input.language));
  for (const permit of input.permits ?? []) text('--permiso', permit);
  if (input.permitsExisting) parts.push('--permiso-existente');
  if (input.paymentTerms?.trim() && input.paymentTerms.trim() !== DEFAULT_EXPORT_PAYMENT_TERMS) {
    text('--forma-pago', input.paymentTerms);
  }
  text('--fecha-pago', input.paymentDate);
  text('--observaciones', input.observations);
  text('--obs-comerciales', input.commercialObservations);
  // Siempre explicito: si la config cambia de entorno, el comando pegado sigue emitiendo donde se armo.
  parts.push(`--${options.environment}`, '--emitir');

  return parts.join(' ');
}
