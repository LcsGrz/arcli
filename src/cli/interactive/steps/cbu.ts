import type { ArcliConfig } from '../../../modules/config/config.schemas';
import { type InvoiceState, isFceInvoiceState } from '../../../modules/interactive/invoice-input';
import { cbuToSave } from '../../../modules/interactive/steps/config-offer';
import { validateCbu, validateOptionalCbuAlias } from '../../../modules/interactive/validators';
import { BACK, type WizardStep } from '../../../modules/interactive/wizard';
import { askTextStep } from '../prompts';
import { offerConfig } from '../save-to-config';
import { SKIP_HINT } from '../text-hints';

/**
 * El CBU de la FCE cuando la config no tiene uno y, si tampoco tiene alias, el alias (Enter lo omite, como sin
 * `--alias`), en dos pasos. Los comparten "Emitir factura" y "Repetir".
 */
export function cbuSteps<S extends InvoiceState>(config: Pick<ArcliConfig, 'aliasCbu' | 'cbu'>): Array<WizardStep<S>> {
  const asksCbu = (state: S): boolean => isFceInvoiceState(state) && !config.cbu;

  return [
    {
      name: 'cbu',
      run: async (_state, { previous }) => {
        const cbu = await askTextStep('CBU del emisor (22 dígitos):', {
          previousAnswer: previous?.cbu,
          validate: validateCbu,
        });

        return cbu === BACK ? BACK : ({ cbu, cbuAlias: undefined } as Partial<S>);
      },
      skip: (state) => !asksCbu(state),
    },
    {
      name: 'alias-cbu',
      run: async (_state, { previous }) => {
        const alias = await askTextStep('Alias del CBU:', {
          hint: SKIP_HINT,
          previousAnswer: previous?.cbuAlias,
          validate: validateOptionalCbuAlias,
        });

        return alias === BACK ? BACK : ({ cbuAlias: alias.trim() || undefined } as Partial<S>);
      },
      skip: (state) => !asksCbu(state) || Boolean(config.aliasCbu),
    },
  ];
}

/**
 * Si ARCA autorizo la FCE con un CBU escrito a mano (no habia en la config), ofrece guardarlo, con el alias si se
 * escribio (REV-74, #16): dejada sin emitir o rechazada, no.
 */
export async function offerSavingCbu(
  config: Pick<ArcliConfig, 'cbu'>,
  state: InvoiceState,
  authorized: boolean,
): Promise<void> {
  await offerConfig(cbuToSave(state, config, authorized));
}
