import type { IIva } from '@arcasdk/core/lib/domain/types/voucher.types';
import Big from 'big.js';

import type { BillingIvaCondition } from './billing.schemas';
import type { VoucherKindDefinition } from './billing.types';

const DEFAULT_IVA_ALIQUOT_ID = 5;
const DEFAULT_IVA_RATE = 0.21;
const IVA_TOTAL_MULTIPLIER = new Big(1).plus(DEFAULT_IVA_RATE);

export interface TaxAmounts {
  readonly iva?: IIva[];
  readonly ivaAmount: number;
  readonly netAmount: number;
}

export function resolveTaxAmounts(
  totalAmount: number,
  ivaCondition: BillingIvaCondition,
  voucherKind: VoucherKindDefinition,
): TaxAmounts {
  const shouldApplyIva =
    voucherKind.letter === 'b' || (voucherKind.letter === 'a' && ivaCondition === 'responsable-inscripto');

  if (!shouldApplyIva) {
    return {
      ivaAmount: 0,
      netAmount: totalAmount,
    };
  }

  const netAmount = roundAmount(new Big(totalAmount).div(IVA_TOTAL_MULTIPLIER));
  const ivaAmount = roundAmount(new Big(totalAmount).minus(netAmount));

  return {
    iva: [
      {
        BaseImp: netAmount,
        Id: DEFAULT_IVA_ALIQUOT_ID,
        Importe: ivaAmount,
      },
    ],
    ivaAmount,
    netAmount,
  };
}

function roundAmount(value: Big): number {
  return value.round(2, Big.roundHalfUp).toNumber();
}
