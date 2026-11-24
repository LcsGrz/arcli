import { ConfigService } from '../../modules/config/config.service';
import type { ConfigOffer } from '../../modules/interactive/steps/config-offer';
import { noticePanel, writeTerminalOutput } from '../../ui';

import { confirm, isPromptCancellation } from './prompts';

/**
 * Despues de emitir, ofrece guardar en la config un dato que se escribio a mano (la actividad de la E, el CBU y
 * el alias de la FCE), para no volver a preguntarlo. El comprobante ya se emitio: Ctrl+C aca es "No", no "No se emitio nada".
 *
 * @internal Exportado para los tests.
 */
export async function offerSavingToConfig(
  message: string,
  values: ConfigOffer['values'],
  removes?: ConfigOffer['removes'],
): Promise<void> {
  try {
    if (!(await confirm(message, 'Sí, guardar', 'No'))) {
      return;
    }
  } catch (error) {
    if (isPromptCancellation(error)) {
      return;
    }

    throw error;
  }

  const service = new ConfigService();

  try {
    if (removes) {
      service.changeValues({ remove: removes.keys, set: values });
    } else {
      for (const [key, value] of values) {
        service.setValue(key, value);
      }
    }
  } finally {
    service.close();
  }

  if (removes) {
    writeTerminalOutput(noticePanel(removes.notice, 'success'));
  }
}

/** Ofrece guardar lo que decidio `modules` (`cbuToSave`, `activityToSave`), si hay algo para ofrecer. */
export async function offerConfig(offer: ConfigOffer | undefined): Promise<void> {
  if (offer) {
    await offerSavingToConfig(offer.message, offer.values, offer.removes);
  }
}
