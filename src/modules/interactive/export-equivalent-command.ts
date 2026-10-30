import { formatArgentineAmountInput } from '../../lib/numbers/argentine-amount';
import { DEFAULT_EXPORT_PAYMENT_TERMS } from '../export/export.mappers';
import { DEFAULT_EXPORT_TYPE, EXPORT_VOUCHER_KIND, type ExportVoucherInput } from '../export/export.types';

/** Comillas solo cuando hacen falta, para que se pueda pegar en bash, zsh o fish. */
function quote(value: string): string {
  return /^[\w./:,-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

/**
 * `arcli fe` que reproduce la factura E armada por el asistente. La actividad va siempre explicita: si la config
 * cambia, el comando pegado sigue informando la misma.
 */
export function buildExportEquivalentCommand(
  input: ExportVoucherInput,
  options: { readonly activity: number; readonly environment: 'produccion' | 'testing' },
): string {
  const parts = ['arcli', EXPORT_VOUCHER_KIND.shortcut, '-m', formatArgentineAmountInput(input.amount ?? 0)];
  const text = (flag: string, value: string | undefined) => {
    if (value?.trim()) parts.push(flag, quote(value.trim()));
  };

  text('--cliente', input.clientName);
  text('--domicilio-cliente', input.clientAddress);
  text('--pais-destino', input.destinationCountry);
  text('--id-impositivo', input.clientTaxId);

  if (input.exportType !== undefined && input.exportType !== DEFAULT_EXPORT_TYPE) {
    parts.push('--tipo-expo', String(input.exportType));
  }

  parts.push('--actividad', String(options.activity));

  if (input.voucherNumber !== undefined) parts.push('--numero', String(input.voucherNumber));

  text('--descripcion', input.description);
  text('--moneda', input.currencyCode);
  if (input.sameCurrency) parts.push('--misma-moneda');
  text('--incoterm', input.incoterm);
  if (input.paymentTerms?.trim() && input.paymentTerms.trim() !== DEFAULT_EXPORT_PAYMENT_TERMS) {
    text('--forma-pago', input.paymentTerms);
  }
  text('--fecha-pago', input.paymentDate);
  // Siempre explicito: si la config cambia de entorno, el comando pegado sigue emitiendo donde se armo.
  parts.push(`--${options.environment}`, '--emitir');

  return parts.join(' ');
}
