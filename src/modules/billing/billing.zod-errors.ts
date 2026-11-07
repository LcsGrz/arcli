import type { ZodError } from 'zod';

import type { InputIssue } from '../../lib/errors/input-issue';

import { BILLING_JSON_KEY_BY_INTERNAL_KEY } from './billing.json-input';

const ZOD_PATH_LABELS: Record<string, string> = {
  associatedPeriod: 'período asociado',
  associatedVoucher: 'comprobante asociado',
  billingDate: 'fecha del comprobante',
  cancellation: 'anulación',
  cbu: 'CBU',
  cbuAlias: 'alias del CBU',
  concept: 'concepto',
  currencyCode: 'moneda',
  documentNumber: 'número de documento',
  documentType: 'tipo de documento',
  dueDay: 'día de vencimiento',
  exchangeRate: 'cotización',
  exemptAmount: 'importe exento',
  ivaRate: 'alícuota de IVA',
  ivaCondition: 'IVA receptor',
  paymentDueDate: 'vencimiento de pago',
  pointOfSale: 'punto de venta',
  sameCurrency: 'misma moneda',
  serviceEndDate: 'servicio hasta',
  serviceStartDate: 'servicio desde',
  totalAmount: 'monto',
  transferMode: 'modalidad de transferencia',
  untaxedAmount: 'importe no gravado',
};

function formatZodIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) {
    return 'Entrada';
  }

  return path.map((segment) => String(segment)).join('.');
}

function humanizeZodIssue(issue: ZodError['issues'][number], label: string): string {
  if (issue.code === 'invalid_type' && issue.input === undefined) {
    return `Falta el dato: ${label}.`;
  }

  if (issue.code === 'too_small' && typeof issue.minimum === 'number') {
    if (formatZodIssuePath(issue.path) === 'totalAmount') {
      return 'El monto debe ser mayor a 0.';
    }

    return `${label[0]?.toUpperCase() ?? ''}${label.slice(1)} debe ser mayor a ${issue.minimum}.`;
  }

  if (issue.code === 'invalid_value') {
    const allowedValues = issue.values.map((value) => String(value)).join(', ');

    return `${label[0]?.toUpperCase() ?? ''}${label.slice(1)} tiene un valor no soportado. Valores válidos: ${allowedValues}.`;
  }

  if (issue.code === 'invalid_type') {
    return `${label[0]?.toUpperCase() ?? ''}${label.slice(1)} tiene un formato inválido.`;
  }

  return issue.message;
}

function formatPublicIssuePath(path: PropertyKey[]): string[] {
  // La clave del JSON sale del esquema de `--cargar`, la misma que se documenta.
  const publicKey = BILLING_JSON_KEY_BY_INTERNAL_KEY[formatZodIssuePath(path)];

  return publicKey ? [publicKey] : path.map((segment) => String(segment));
}

export function describeZodIssues(error: ZodError): InputIssue[] {
  return error.issues.map((issue) => {
    const pathKey = formatZodIssuePath(issue.path);
    const label = ZOD_PATH_LABELS[pathKey] ?? pathKey;

    return { label, mensaje: humanizeZodIssue(issue, label), ruta: formatPublicIssuePath(issue.path) };
  });
}

/** Resumen de una linea, para listar errores por item (por ejemplo, en un lote). */
export function summarizeZodError(error: ZodError): string {
  return describeZodIssues(error)
    .map((issue) => issue.mensaje)
    .join(' ');
}
