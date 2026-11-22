import { InputValidationError } from '../../lib/errors/app-error';

import { formatVoucherSubject } from './billing.mappers';
import type { BillingIvaCondition } from './billing.schemas';
import type { VoucherKindDefinition, VoucherLetter } from './billing.types';

/**
 * Condiciones IVA del receptor admitidas por letra, segun la tabla del manual (WSFEv1 v4.7, p. 203), que marca
 * consumidor final en B, C y 49. ARCA rechaza las demas combinaciones con el error 10243. `yarn test:arca` la compara
 * con la de FEParamGetCondicionIvaReceptor de testing, que trae consumidor final solo como "C/49" aunque aprueba la B.
 */
const IVA_CONDITIONS_BY_LETTER: Record<VoucherLetter, readonly BillingIvaCondition[]> = {
  a: [
    'responsable-inscripto',
    'responsable-monotributo',
    'monotributista-social',
    'monotributo-trabajador-independiente-promovido',
  ],
  b: [
    'sujeto-exento',
    'consumidor-final',
    'sujeto-no-categorizado',
    'proveedor-del-exterior',
    'cliente-del-exterior',
    'iva-liberado',
    'iva-no-alcanzado',
  ],
  c: [
    'responsable-inscripto',
    'responsable-monotributo',
    'monotributista-social',
    'monotributo-trabajador-independiente-promovido',
    'sujeto-exento',
    'consumidor-final',
    'sujeto-no-categorizado',
    'proveedor-del-exterior',
    'cliente-del-exterior',
    'iva-liberado',
    'iva-no-alcanzado',
  ],
};

/**
 * RG 5700/2025: desde $ 10.000.000 hay que identificar al consumidor final (ARCA 10015, WSFEv1 v4.7). El texto de la
 * 10015 nombra solo la B, pero ARCA testing tambien rechaza la C con ese codigo (18/11/2026): no aflojarla en la C.
 */
export const CONSUMER_IDENTIFICATION_THRESHOLD = 10_000_000;

/** Si un total en pesos (total × cotizacion) obliga a identificar al consumidor final (RG 5700/2025). */
export function requiresConsumerIdentification(totalInPesos: number): boolean {
  return totalInPesos >= CONSUMER_IDENTIFICATION_THRESHOLD;
}

export function listAllowedIvaConditions(letter: VoucherLetter): readonly BillingIvaCondition[] {
  return IVA_CONDITIONS_BY_LETTER[letter];
}

export function isIvaConditionAllowed(letter: VoucherLetter, ivaCondition: BillingIvaCondition): boolean {
  return IVA_CONDITIONS_BY_LETTER[letter].includes(ivaCondition);
}

export function validateIvaConditionForVoucher(
  ivaCondition: BillingIvaCondition,
  voucherKind: VoucherKindDefinition,
): void {
  if (isIvaConditionAllowed(voucherKind.letter, ivaCondition)) {
    return;
  }

  const suggestedLetter = (['a', 'b'] as const).find((letter) => isIvaConditionAllowed(letter, ivaCondition));
  const suggestion = suggestedLetter ? ` Usá un comprobante letra ${suggestedLetter.toUpperCase()}.` : '';

  throw new InputValidationError(
    `${formatVoucherSubject(voucherKind)} no admite IVA receptor "${ivaCondition}".${suggestion}`,
  );
}
