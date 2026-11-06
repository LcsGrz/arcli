import { conceptLabel, documentTypeLabel, ivaConditionLabel } from './arca-codes';
import { findArcaCurrency } from './currency-codes';

export function formatDateLabel(value: string | undefined): string {
  if (!value) {
    return 'N/D';
  }

  if (/^\d{8}$/.test(value)) {
    return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
  }

  return value.replaceAll('-', '/');
}

export function formatMoneyLabel(value: number | undefined): string {
  if (typeof value !== 'number') {
    return 'N/D';
  }

  const hasDecimals = !Number.isInteger(value);

  return `${new Intl.NumberFormat('es-AR', {
    maximumFractionDigits: 2,
    minimumFractionDigits: hasDecimals ? 2 : 0,
  }).format(value)}$`;
}

export function formatConceptLabel(value: number | undefined): string {
  return conceptLabel(value);
}

export function formatDocumentTypeLabel(value: number | undefined): string {
  return documentTypeLabel(value);
}

export function formatIvaConditionLabel(value: number | undefined): string {
  return ivaConditionLabel(value);
}

/** "Pesos uruguayos (UYU)"; una moneda que no esta en la tabla sale con su codigo. */
export function formatCurrencyLabel(value: string | undefined): string {
  if (!value) {
    return 'N/D';
  }

  const currency = findArcaCurrency(value);

  if (!currency) {
    return value;
  }

  return `${currency.name} (${currency.iso ?? currency.arca})`;
}

export function formatNumericLabel(value: number | undefined): string {
  if (typeof value !== 'number') {
    return 'N/D';
  }

  return new Intl.NumberFormat('es-AR').format(value);
}

export function formatTaxIdLabel(value: string | number | undefined): string {
  if (value === undefined || value === null || value === '') {
    return 'No informado';
  }

  const normalizedValue = String(value).replace(/\D/g, '');

  if (!/^\d{11}$/.test(normalizedValue)) {
    return String(value);
  }

  return `${normalizedValue.slice(0, 2)}-${normalizedValue.slice(2, 10)}-${normalizedValue.slice(10)}`;
}

export function formatDecimalLabel(value: number | undefined): string {
  if (typeof value !== 'number') {
    return 'N/D';
  }

  return new Intl.NumberFormat('es-AR', {
    maximumFractionDigits: 6,
  }).format(value);
}
