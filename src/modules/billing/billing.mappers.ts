import { DEFAULT_CURRENCY_CODE } from './billing.constants';
import type { BillingConcept, BillingDocumentType, BillingIvaCondition } from './billing.schemas';
import type { VoucherKindDefinition } from './billing.types';

const BILLING_CONCEPT_MAP: Record<BillingConcept, number> = {
  productos: 1,
  servicios: 2,
  'productos-servicios': 3,
};

const BILLING_DOCUMENT_TYPE_MAP: Record<BillingDocumentType, number> = {
  'consumidor-final': 99,
  cuil: 86,
  cuit: 80,
  dni: 96,
};

const BILLING_IVA_CONDITION_MAP: Record<BillingIvaCondition, number> = {
  'cliente-del-exterior': 9,
  'consumidor-final': 5,
  'iva-liberado': 10,
  'iva-no-alcanzado': 15,
  'monotributista-social': 13,
  'monotributo-trabajador-independiente-promovido': 16,
  'proveedor-del-exterior': 8,
  'responsable-inscripto': 1,
  'responsable-monotributo': 6,
  'sujeto-exento': 4,
  'sujeto-no-categorizado': 7,
};

const BILLING_CURRENCY_CODE_MAP: Record<string, string> = {
  ARS: 'PES',
  PES: 'PES',
  USD: 'USD',
};

export function resolveBillingConceptCode(concept: BillingConcept): number {
  return BILLING_CONCEPT_MAP[concept];
}

export function resolveBillingDocumentTypeCode(documentType: BillingDocumentType): number {
  return BILLING_DOCUMENT_TYPE_MAP[documentType];
}

export function resolveBillingIvaConditionCode(ivaCondition: BillingIvaCondition): number {
  return BILLING_IVA_CONDITION_MAP[ivaCondition];
}

export function resolveBillingCurrencyCode(currencyCode = DEFAULT_CURRENCY_CODE): string {
  const normalizedCode = currencyCode.trim().toUpperCase();

  return BILLING_CURRENCY_CODE_MAP[normalizedCode] ?? normalizedCode;
}

export function formatVoucherLabel(voucherKind: VoucherKindDefinition): string {
  return voucherKind.displayName.toLowerCase();
}

export function formatDocumentFlag(documentType: BillingDocumentType): string {
  switch (documentType) {
    case 'cuit':
      return '--cuit';
    case 'cuil':
      return '--cuil';
    case 'dni':
      return '--dni';
    default:
      return '--consumidor-final';
  }
}
