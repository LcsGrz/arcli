import { conceptCode, documentTypeCode, ivaConditionCode } from './arca-codes';
import { DEFAULT_CURRENCY_CODE } from './billing.constants';
import type { BillingConcept, BillingDocumentType, BillingIvaCondition } from './billing.schemas';
import type { VoucherKindDefinition } from './billing.types';
import { toArcaCurrencyCode } from './currency-codes';

export function resolveBillingConceptCode(concept: BillingConcept): number {
  return conceptCode(concept);
}

export function resolveBillingDocumentTypeCode(documentType: BillingDocumentType): number {
  return documentTypeCode(documentType);
}

export function resolveBillingIvaConditionCode(ivaCondition: BillingIvaCondition): number {
  return ivaConditionCode(ivaCondition);
}

/** Acepta el codigo ISO (`ARS`, `USD`, `UYU`) o el de ARCA (`PES`, `DOL`, `011`) y devuelve el de ARCA. */
export function resolveBillingCurrencyCode(currencyCode = DEFAULT_CURRENCY_CODE): string {
  return toArcaCurrencyCode(currencyCode);
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
