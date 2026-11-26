import {
  type MonotributoAction,
  monotributoActionChoices,
  monotributoBlockKeys,
  monotributoCategoryChoices,
} from '../../modules/interactive/monotributo-menu';
import { BACK } from '../../modules/interactive/wizard';
import {
  formatMonotributoBlockAsText,
  formatMonotributoCategoryAsText,
  formatMonotributoNotices,
  formatMonotributoSummaryAsText,
  MONOTRIBUTO_BLOCKS,
  type MonotributoReport,
} from '../../modules/monotributo/monotributo.presenter';
import { writeTerminalOutput } from '../../ui';
import { loadMonotributoReport } from '../monotributo-report';

import { waitForArca } from './arca-wait';
import { browseBlocks, chooseStep } from './prompts';
import type { InteractiveSession } from './session';

/** La pagina y el padron, en una sola espera: sin nada que consultar (la tabla guardada), sin spinner. */
function load(session: InteractiveSession, refresh: boolean): Promise<MonotributoReport> {
  return waitForArca(
    'Consultando el monotributo en ARCA...',
    (signal) =>
      loadMonotributoReport({
        config: session.runtime.config,
        createArca: () => session.arca,
        environment: session.runtime.environment,
        quiet: true,
        refresh,
        signal,
      }),
    { pending: true },
  );
}

/** Los avisos y la tabla, como `arcli monotributo` pero sin las sugerencias de comandos: abajo va el menu. */
function showSummary(report: MonotributoReport): void {
  const notices = formatMonotributoNotices(report.notices);

  writeTerminalOutput([...(notices ? [notices] : []), formatMonotributoSummaryAsText(report)].join('\n\n'));
}

async function showCategory(report: MonotributoReport): Promise<void> {
  const letter = await chooseStep(
    '¿Qué categoría?',
    monotributoCategoryChoices(report.table, report.ownCategory),
    report.ownCategory ?? undefined,
  );

  if (letter !== BACK) {
    writeTerminalOutput(formatMonotributoCategoryAsText(report, letter));
  }
}

/**
 * "Categorías del monotributo", como `arcli monotributo`: la tabla y despues "¿Y ahora?" para ver una categoría,
 * todas las columnas (un bloque por vez, con ←/→) o volver a leerla en ARCA.
 */
export async function runMonotributoQuery(session: InteractiveSession): Promise<void> {
  let report = await load(session, false);
  let last: MonotributoAction | undefined;

  showSummary(report);

  for (;;) {
    const action = await chooseStep('¿Y ahora?', monotributoActionChoices(), last);

    if (action === BACK) {
      return;
    }

    last = action;

    switch (action) {
      case 'categoria':
        await showCategory(report);
        break;
      case 'columnas':
        await browseBlocks(
          'Todas las columnas',
          MONOTRIBUTO_BLOCKS,
          (block) => formatMonotributoBlockAsText(report, block, { navigation: 'flechas' }),
          monotributoBlockKeys(),
        );
        break;
      case 'actualizar':
        report = await load(session, true);
        showSummary(report);
        break;
    }
  }
}
