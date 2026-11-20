import type { ArcliConfig } from '../../../modules/config/config.schemas';
import { type InvoiceState, isFceInvoice } from '../../../modules/interactive/invoice-input';
import { cbuToSave, type ConfigOffer } from '../../../modules/interactive/steps/config-offer';
import { BACK, type WizardStep } from '../../../modules/interactive/wizard';
import { askTextStep } from '../prompts';
import { offerSavingToConfig } from '../save-to-config';
import { validateCbu, validateOptionalCbuAlias } from '../validators';

/**
 * El CBU de la FCE cuando la config no tiene uno y, si tampoco tiene alias, el alias (Enter lo omite, como sin
 * `--alias`), en dos pasos. Los comparten "Emitir factura" y "Repetir".
 */
export function cbuSteps<S extends InvoiceState>(config: Pick<ArcliConfig, 'aliasCbu' | 'cbu'>): Array<WizardStep<S>> {
  const asksCbu = (state: S): boolean => isFceInvoice(state) && !config.cbu;

  return [
    {
      name: 'cbu',
      run: async (_state, previous) => {
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
      run: async (_state, previous) => {
        const alias = await askTextStep('Alias del CBU (Enter para omitir):', {
          previousAnswer: previous?.cbuAlias,
          validate: validateOptionalCbuAlias,
        });

        return alias === BACK ? BACK : ({ cbuAlias: alias.trim() || undefined } as Partial<S>);
      },
      skip: (state) => !asksCbu(state) || Boolean(config.aliasCbu),
    },
  ];
}

/** Ofrece guardar en la config un dato escrito a mano, si hay algo para ofrecer. */
export async function offerConfig(offer: ConfigOffer | undefined): Promise<void> {
  if (offer) {
    await offerSavingToConfig(offer.message, offer.values);
  }
}

/**
 * Si la FCE se emitio con un CBU escrito a mano (no habia en la config), ofrece guardarlo, con el alias si se escribio
 * (REV-74, #16): dejado sin emitir, no.
 */
export async function offerSavingCbu(
  config: Pick<ArcliConfig, 'cbu'>,
  state: InvoiceState,
  emitted: boolean,
): Promise<void> {
  await offerConfig(cbuToSave(state, config, emitted));
}
