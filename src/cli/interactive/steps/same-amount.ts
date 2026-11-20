import { formatMoneyLabel } from '../../../modules/billing/billing.labels';
import type { Lens } from '../../../modules/interactive/steps/lens';
import { BACK, type WizardStep } from '../../../modules/interactive/wizard';
import { chooseStep } from '../prompts';

export interface SameAmountStepDef<S> {
  /** El total del comprobante que se repite, en su moneda. */
  readonly original: (state: S) => { readonly currency?: string; readonly total: number };
  /** Donde va el monto: con "Sí", el del original. */
  readonly amount: Lens<S, number>;
  readonly skip?: (state: S) => boolean;
}

/**
 * "¿Mismo monto?" al repetir un comprobante: "Sí" copia el total del original y "No" lo pide en el paso siguiente.
 * Depende del comprobante elegido (`factura`). Lo comparten "Repetir" y "Repetir" E.
 */
export function sameAmountStep<S extends { readonly sameAmount?: boolean }>(def: SameAmountStepDef<S>): WizardStep<S> {
  return {
    dependsOn: ['factura'],
    name: 'mismo-monto',
    run: async (state, { previous }) => {
      const { currency, total } = def.original(state);
      const scope = await chooseStep(
        '¿Mismo monto?',
        [
          { name: `Sí, ${formatMoneyLabel(total, currency)}`, value: 'mismo' as const },
          { name: 'No, ingresar otro monto', value: 'otro' as const },
        ],
        previous?.sameAmount === undefined ? undefined : previous.sameAmount ? 'mismo' : 'otro',
      );

      if (scope === BACK) {
        return BACK;
      }

      return scope === 'mismo'
        ? ({ ...def.amount.set(total, state), sameAmount: true } as Partial<S>)
        : ({ sameAmount: false } as Partial<S>);
    },
    skip: def.skip,
  };
}
