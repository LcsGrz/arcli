import { hasNewOption, isNewOption, type NewOption } from '../../modules/interactive/new-options';
import { colorize } from '../../ui';
import { CLI_VERSION } from '../version';

import type { Choice } from './prompts';

/**
 * Suma "(nuevo)" al final de una opcion que aparecio hace poco (ver `NEW_OPTION_SINCE`), en `highlight`: invita a
 * mirarla. Con varias, la marca va si alguna es nueva, como en un submenu. La respuesta queda sin la marca.
 */
export function markIfNew<T>(
  choice: Choice<T>,
  options: NewOption | readonly NewOption[],
  version: string = CLI_VERSION,
): Choice<T> {
  const isNew = typeof options === 'string' ? isNewOption(options, version) : hasNewOption(options, version);

  return isNew
    ? { ...choice, name: `${choice.name} ${colorize('(nuevo)', 'highlight')}`, short: choice.short ?? choice.name }
    : choice;
}
