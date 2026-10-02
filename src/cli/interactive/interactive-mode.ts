import { ConfigService } from '../../modules/config/config.service';
import { buildConfigDoctorReport } from '../../modules/config/config-doctor';
import {
  colorize,
  formatCliError,
  formatConfigDoctorAsText,
  noticePanel,
  renderLogo,
  statusBar,
  writeTerminalError,
  writeTerminalOutput,
} from '../../ui';
import { buildRuntimeCheck } from '../commands/config.command';
import type { GlobalCliOptions } from '../types';

import { runHistoryFlow } from './history.flow';
import { runInvoiceFlow } from './invoice.flow';
import { runNoteFlow } from './note.flow';
import { chooseOne, isPromptCancellation } from './prompts';
import { createInteractiveSession, type InteractiveSession } from './session';

type MenuOption = 'config' | 'factura' | 'historial' | 'nota' | 'salir';

function runConfigReview(options: GlobalCliOptions): void {
  const service = new ConfigService();

  try {
    service.ensureInitialized();
    writeTerminalOutput(
      formatConfigDoctorAsText(buildConfigDoctorReport(service.getConfig(), buildRuntimeCheck(options))),
    );
  } finally {
    service.close();
  }
}

function resolveSession(options: GlobalCliOptions): InteractiveSession | undefined {
  try {
    return createInteractiveSession(options);
  } catch (error) {
    writeTerminalError(formatCliError(error, false));
    writeTerminalOutput(noticePanel('Revisa la configuracion desde el menu o con "arcli config revisar".', 'warning'));

    return undefined;
  }
}

async function runOption(option: Exclude<MenuOption, 'salir'>, options: GlobalCliOptions): Promise<void> {
  if (option === 'config') {
    runConfigReview(options);

    return;
  }

  const session = resolveSession(options);

  if (!session) {
    return;
  }

  if (option === 'factura') await runInvoiceFlow(session);
  if (option === 'nota') await runNoteFlow(session);
  if (option === 'historial') await runHistoryFlow(session);
}

function formatHeader(options: GlobalCliOptions): string {
  try {
    const { environment, pointOfSale } = createInteractiveSession(options).runtime;

    return statusBar(
      'Modo interactivo',
      `${environment} · PV ${pointOfSale ?? 'sin configurar'}`,
      environment === 'produccion' ? 'danger' : 'warning',
    );
  } catch {
    return statusBar('Modo interactivo', 'falta completar la configuracion', 'warning');
  }
}

/** Asistente paso a paso encima del CLI. Ctrl+C cancela el flujo actual; en el menu, sale. */
export async function runInteractiveMode(options: GlobalCliOptions = {}): Promise<void> {
  writeTerminalOutput([renderLogo().trimEnd(), formatHeader(options)].join('\n'));

  for (;;) {
    let option: MenuOption;

    try {
      option = await chooseOne<MenuOption>('¿Que queres hacer?', [
        { name: 'Emitir factura', value: 'factura' },
        { name: 'Nota de credito o debito sobre una factura', value: 'nota' },
        { name: 'Ver ultimos comprobantes', value: 'historial' },
        { name: 'Revisar configuracion', value: 'config' },
        { name: 'Salir', value: 'salir' },
      ]);
    } catch (error) {
      if (isPromptCancellation(error)) {
        break;
      }

      throw error;
    }

    if (option === 'salir') {
      break;
    }

    try {
      await runOption(option, options);
    } catch (error) {
      if (isPromptCancellation(error)) {
        writeTerminalOutput(colorize('Cancelado. No se emitio nada.', 'muted'));
      } else {
        writeTerminalError(formatCliError(error, false));
      }
    }
  }

  writeTerminalOutput(colorize('¡Hasta la proxima!', 'muted'));
}
