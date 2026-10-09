import { Separator } from '@inquirer/select';

import { ConfigService } from '../../modules/config/config.service';
import { listMissingSetupKeys } from '../../modules/interactive/config-fields';
import {
  colorize,
  formatCliError,
  noticePanel,
  renderLogo,
  statusBar,
  writeTerminalError,
  writeTerminalOutput,
} from '../../ui';
import type { GlobalCliOptions } from '../types';

import { runConfigMenu, runGuidedSetup } from './config.flow';
import { runHistoryFlow } from './history.flow';
import { runInvoiceFlow } from './invoice.flow';
import { runNoteFlow } from './note.flow';
import { chooseOne, confirm, isPromptCancellation } from './prompts';
import { runRepeatFlow } from './repeat.flow';
import { createInteractiveSession, type InteractiveSession } from './session';
import { runStatusFlow } from './status.flow';

type MenuOption = 'config' | 'estado' | 'factura' | 'historial' | 'nota-credito' | 'nota-debito' | 'repetir' | 'salir';

function listMissingSetup(): string[] {
  const service = new ConfigService();

  try {
    service.ensureInitialized();

    return listMissingSetupKeys(service.getConfig());
  } finally {
    service.close();
  }
}

function resolveSession(options: GlobalCliOptions): InteractiveSession | undefined {
  try {
    return createInteractiveSession(options);
  } catch (error) {
    writeTerminalError(formatCliError(error, false));
    writeTerminalOutput(noticePanel('Revisala desde "Configuracion" en el menu.', 'warning'));

    return undefined;
  }
}

async function runOption(option: Exclude<MenuOption, 'salir'>, options: GlobalCliOptions): Promise<void> {
  if (option === 'config') {
    await runConfigMenu(options);

    return;
  }

  const session = resolveSession(options);

  if (!session) {
    return;
  }

  if (option === 'factura') await runInvoiceFlow(session);
  if (option === 'repetir') await runRepeatFlow(session);
  if (option === 'nota-credito') await runNoteFlow(session, 'credito');
  if (option === 'nota-debito') await runNoteFlow(session, 'debito');
  if (option === 'historial') await runHistoryFlow(session);
  if (option === 'estado') await runStatusFlow(session);
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
  // Mismo aire debajo del logo que arriba: tres lineas en blanco.
  writeTerminalOutput([renderLogo().trimEnd(), '', '', '', formatHeader(options)].join('\n'));

  // Primera vez: sin CUIT, certificado o punto de venta no se puede hacer nada, asi que se ofrece la guia.
  if (listMissingSetup().length > 0) {
    try {
      if (
        await confirm('Falta completar la configuracion. ¿La hacemos ahora, paso a paso?', 'Si, configurar', 'Despues')
      ) {
        await runGuidedSetup();
        writeTerminalOutput(formatHeader(options));
      }
    } catch (error) {
      if (!isPromptCancellation(error)) {
        throw error;
      }
    }
  }

  for (;;) {
    let option: MenuOption;

    try {
      option = await chooseOne<MenuOption>(
        '¿Que queres hacer?',
        [
          { name: 'Emitir factura', value: 'factura' },
          {
            description: 'Copia una de las ultimas, con fechas nuevas',
            name: 'Repetir una factura anterior',
            value: 'repetir',
          },
          {
            description: 'Descuento, devolucion o anulacion de una factura',
            name: 'Emitir nota de credito',
            value: 'nota-credito',
          },
          { description: 'Cargo adicional sobre una factura', name: 'Emitir nota de debito', value: 'nota-debito' },
          {
            description: 'Los ultimos de cada tipo, o buscar uno por numero',
            name: 'Consultar comprobantes',
            value: 'historial',
          },
          { description: 'Servidores, punto de venta y cotizacion del dolar', name: 'Estado de ARCA', value: 'estado' },
          {
            description: 'Revisar, configuracion guiada, cambiar un dato y PDF',
            name: 'Configuracion',
            value: 'config',
          },
          new Separator(' '),
          { name: 'Salir', value: 'salir' },
        ],
        undefined,
        { escapeLabel: 'salir', escapeValue: 'salir' },
      );
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
