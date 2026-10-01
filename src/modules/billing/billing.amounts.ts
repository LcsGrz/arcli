import type { IIva } from '@arcasdk/core/lib/domain/types/voucher.types';
import Big from 'big.js';

import { InputValidationError } from '../../lib/errors/app-error';

import { formatVoucherLabel } from './billing.mappers';
import type { BillingCommandInput, BillingIvaRate } from './billing.schemas';
import type { VoucherKindDefinition } from './billing.types';

/** Ids de alicuota de FEParamGetTiposIva. */
const IVA_RATE_DEFINITIONS: Record<BillingIvaRate, { readonly id: number; readonly rate: string }> = {
  '0': { id: 3, rate: '0' },
  '2.5': { id: 9, rate: '0.025' },
  '5': { id: 8, rate: '0.05' },
  '10.5': { id: 4, rate: '0.105' },
  '21': { id: 5, rate: '0.21' },
  '27': { id: 6, rate: '0.27' },
};

export const DEFAULT_IVA_RATE: BillingIvaRate = '21';

export interface TaxAmounts {
  readonly exemptAmount: number;
  readonly iva?: IIva[];
  readonly ivaAmount: number;
  readonly netAmount: number;
  readonly untaxedAmount: number;
}

type TaxAmountsInput = Pick<BillingCommandInput, 'exemptAmount' | 'ivaRate' | 'totalAmount' | 'untaxedAmount'>;

export function resolveIvaRateLabel(aliquotId: number): string | undefined {
  const entry = Object.entries(IVA_RATE_DEFINITIONS).find(([, definition]) => definition.id === aliquotId);

  return entry ? `${entry[0].replace('.', ',')}%` : undefined;
}

function validateLetterCAmounts(input: TaxAmountsInput, voucherKind: VoucherKindDefinition): void {
  const flags = [
    input.ivaRate ? '--alicuota' : undefined,
    input.exemptAmount ? '--exento' : undefined,
    input.untaxedAmount ? '--nogravado' : undefined,
  ].filter((flag): flag is string => Boolean(flag));

  if (flags.length > 0) {
    throw new InputValidationError(
      `La ${formatVoucherLabel(voucherKind)} no discrimina IVA ni importes exentos o no gravados. Quite ${flags.join(', ')}.`,
    );
  }
}

/**
 * Reparte el total entre no gravado, exento, neto gravado e IVA.
 * ImpTotal = ImpTotConc + ImpOpEx + ImpNeto + ImpIVA (10048); la C no informa IVA (10071).
 */
export function resolveTaxAmounts(input: TaxAmountsInput, voucherKind: VoucherKindDefinition): TaxAmounts {
  if (voucherKind.letter === 'c') {
    validateLetterCAmounts(input, voucherKind);

    return {
      exemptAmount: 0,
      ivaAmount: 0,
      netAmount: input.totalAmount,
      untaxedAmount: 0,
    };
  }

  const exemptAmount = input.exemptAmount ?? 0;
  const untaxedAmount = input.untaxedAmount ?? 0;
  const taxedTotal = new Big(input.totalAmount).minus(exemptAmount).minus(untaxedAmount);

  if (taxedTotal.lt(0)) {
    throw new InputValidationError('El importe exento mas el no gravado no puede superar el monto total.');
  }

  if (taxedTotal.eq(0)) {
    return { exemptAmount, ivaAmount: 0, netAmount: 0, untaxedAmount };
  }

  const definition = IVA_RATE_DEFINITIONS[input.ivaRate ?? DEFAULT_IVA_RATE];
  const netAmount = roundAmount(taxedTotal.div(new Big(1).plus(definition.rate)));
  const ivaAmount = roundAmount(taxedTotal.minus(netAmount));

  // Con neto mayor a cero el array de IVA es obligatorio, incluso al 0% (10070).
  return {
    exemptAmount,
    iva: [
      {
        BaseImp: netAmount,
        Id: definition.id,
        Importe: ivaAmount,
      },
    ],
    ivaAmount,
    netAmount,
    untaxedAmount,
  };
}

function roundAmount(value: Big): number {
  return value.round(2, Big.roundHalfUp).toNumber();
}
