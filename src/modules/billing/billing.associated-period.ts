import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { assertRules } from '../../lib/rules/rules';
import type { IPeriodoAsoc } from '../../services/arca/arca-sdk.types';

import { parseBillingDateInput } from './billing.dates';
import { formatVoucherSubject } from './billing.mappers';
import { ASSOCIATED_PERIOD_RULES } from './billing.rules';
import type { BillingCommandInput } from './billing.schemas';
import type { VoucherKindDefinition } from './billing.types';

/**
 * PeriodoAsoc es la alternativa a CbtesAsoc para NC/ND que ajustan un periodo y no una factura puntual (10197).
 * No aplica a facturas (10198) ni a comprobantes FCE (10196). Codigos de WSFEv1 v4.7: 10199 y 10203 las dos fechas,
 * 10206 el minimo, 10207 el orden y 10208 el tope. Que no vaya junto con CbtesAsoc tambien es la 10197: el texto dice
 * "o" y ARCA testing rechaza los dos juntos.
 */
export function resolveAssociatedPeriod(
  input: Pick<BillingCommandInput, 'associatedPeriod' | 'associatedVoucher' | 'billingDate'>,
  voucherKind: VoucherKindDefinition,
  billingDate: string,
  today: string,
): IPeriodoAsoc | undefined {
  const period = input.associatedPeriod;

  if (!period) {
    return undefined;
  }

  const subject = formatVoucherSubject(voucherKind);

  if (!voucherKind.requiresAssociatedVoucher) {
    throw new InputValidationError(`${subject} no usa período asociado: solo aplica a notas de crédito o débito.`);
  }

  if (voucherKind.isElectronicCredit) {
    throw new InputValidationError(
      `${subject} no admite período asociado: ARCA solo lo acepta en notas comunes. Usá el comprobante asociado (\`--ac\`).`,
    );
  }

  if (input.associatedVoucher) {
    throw new InputValidationError(
      'Usá un comprobante asociado (`--ac`/`--at`) o un período asociado (`--periodo-desde`/`--periodo-hasta`), pero no ambos.',
    );
  }

  if (!period.desde || !period.hasta) {
    throw new InputValidationError('El período asociado requiere ambas fechas: `--periodo-desde` y `--periodo-hasta`.');
  }

  // Las reglas del periodo (10206 a 10208) son las mismas que usa el asistente al preguntarlo.
  assertRules(
    ASSOCIATED_PERIOD_RULES,
    { ...input, billingDate: formatArcaDateAsArgentineDate(billingDate) },
    { today, voucherKind },
  );

  return {
    FchDesde: parseBillingDateInput(period.desde, today),
    FchHasta: parseBillingDateInput(period.hasta, today),
  };
}
