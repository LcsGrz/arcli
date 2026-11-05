import { describe, expect, it } from 'vitest';

import {
  BILLING_IVA_RATES,
  conceptCode,
  conceptLabel,
  documentTypeCode,
  documentTypeFromCode,
  documentTypeLabel,
  formatIvaConditionName,
  isTaxIdDocumentType,
  ivaConditionCode,
  ivaConditionLabel,
  ivaRateFromId,
  ivaRateId,
} from '../arca-codes';
import {
  type BillingConcept,
  billingDocumentTypeSchema,
  billingIvaConditionSchema,
  type BillingIvaRate,
} from '../billing.schemas';

// Los esquemas de concepto y alicuota son preprocess (aceptan alias), asi que no exponen `options`.
const CONCEPTS: readonly BillingConcept[] = ['productos', 'productos-servicios', 'servicios'];
const IVA_RATES: readonly BillingIvaRate[] = ['0', '2.5', '5', '10.5', '21', '27'];

describe('catálogo de códigos ARCA', () => {
  it('cubre todos los valores de los esquemas, con códigos distintos', () => {
    const concepts = CONCEPTS.map(conceptCode);
    const documents = billingDocumentTypeSchema.options.map(documentTypeCode);
    const conditions = billingIvaConditionSchema.options.map(ivaConditionCode);

    expect(new Set(concepts).size).toBe(CONCEPTS.length);
    expect(new Set(documents).size).toBe(billingDocumentTypeSchema.options.length);
    expect(new Set(conditions).size).toBe(billingIvaConditionSchema.options.length);
    expect([...BILLING_IVA_RATES].sort()).toEqual([...IVA_RATES].sort());
  });

  it.each([
    ['servicios', 2],
    ['productos-servicios', 3],
  ] as const)('concepto %s es %i', (concept, code) => {
    expect(conceptCode(concept)).toBe(code);
    expect(conceptLabel(code)).not.toBe(String(code));
  });

  it('tipo de documento en las dos direcciones', () => {
    expect(documentTypeCode('consumidor-final')).toBe(99);
    expect(documentTypeFromCode(80)).toBe('cuit');
    expect(documentTypeFromCode(1)).toBeUndefined();
    expect(documentTypeLabel(96)).toBe('DNI');
    expect(isTaxIdDocumentType(86)).toBe(true);
    expect(isTaxIdDocumentType(96)).toBe(false);
  });

  it('condición IVA', () => {
    expect(ivaConditionCode('monotributo-trabajador-independiente-promovido')).toBe(16);
    expect(ivaConditionLabel(5)).toBe('Consumidor final');
    expect(formatIvaConditionName('iva-no-alcanzado')).toBe('IVA No Alcanzado');
  });

  it('alícuota en las dos direcciones', () => {
    for (const rate of BILLING_IVA_RATES) {
      expect(ivaRateFromId(ivaRateId(rate))).toBe(rate);
    }
    expect(ivaRateId('10.5')).toBe(4);
  });

  it('un código que no está sale tal cual, y sin código, N/D', () => {
    expect(conceptLabel(42)).toBe('42');
    expect(ivaConditionLabel(undefined)).toBe('N/D');
  });
});
