import { ConfigService } from '../../modules/config/config.service';

import { confirm, isPromptCancellation } from './prompts';

/**
 * Despues de emitir, ofrece guardar en la config un dato que se escribio a mano (la actividad de la E, el CBU de
 * la FCE), para no volver a preguntarlo. El comprobante ya se emitio: Ctrl+C aca es "No", no "No se emitio nada".
 */
export async function offerSavingToConfig(message: string, key: string, value: string): Promise<void> {
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
    service.setValue(key, value);
  } finally {
    service.close();
  }
}
