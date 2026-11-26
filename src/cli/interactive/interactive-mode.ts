import { Separator } from '@inquirer/core';

import { DOCS_SITE_URL } from '../../lib/links';
import { listMissingSetupKeys, resolveActiveEnvironment } from '../../modules/interactive/config-fields';
import { CONFIG_MENU_NEW_OPTIONS } from '../../modules/interactive/new-options';
import type { UpdateCheckResult } from '../../modules/update-check/update-check.service';
import { colorize, noticePanel, renderLogo, writeTerminalOutput, writeTerminalRaw } from '../../ui';
import { withConfigService } from '../config-service';
import { CANCELLED, CANCELLED_NOTICE } from '../emission-texts';
import { ResentSignalError } from '../interruption';
import type { GlobalCliOptions } from '../types';
import { checkCliUpdate } from '../update-check';
import { CLI_VERSION } from '../version';

import { waitForArca } from './arca-wait';
import { type BackgroundQuery, startBackgroundQuery } from './background-query';
import { runConfigMenu, runGuidedSetup } from './config.flow';
import { runInvoiceFlow } from './invoice.flow';
import { topBlock } from './list-select';
import { liveListFits } from './live-list';
import { markIfNew } from './new-mark';
import { runNoteFlow } from './note.flow';
import { type Choice, chooseOne, confirm, isPromptCancellation, type LiveChoices } from './prompts';
import { runQueriesMenu } from './queries.flow';
import { runRepeatFlow } from './repeat.flow';
import { createInteractiveSession, type InteractiveSession } from './session';
import { showAssistantError } from './show-assistant-error';
import { runStatusFlow } from './status.flow';
import { openStatusHeader, type StatusHeader } from './status-header';
import { runUpdateFlow } from './update.flow';

type MenuOption =
  | 'actualizar'
  | 'config'
  | 'consultas'
  | 'estado'
  | 'factura'
  | 'nota-credito'
  | 'nota-debito'
  | 'recibo'
  | 'repetir'
  | 'salir';

/** Las opciones que pueden emitir: cancelar ahi dice que no se emitio nada. En las demas, solo "Cancelado.". */
const EMITTING_OPTIONS: ReadonlySet<MenuOption> = new Set([
  'factura',
  'nota-credito',
  'nota-debito',
  'recibo',
  'repetir',
]);

/** Lo que falta para emitir en el entorno activo: el de la config o el de `--produccion`/`--testing`. */
function listMissingSetup(options: GlobalCliOptions): string[] {
  return withConfigService((service) => {
    service.ensureInitialized();

    const config = service.getConfig();

    return listMissingSetupKeys(config, resolveActiveEnvironment(config, options));
  });
}

async function resolveSession(options: GlobalCliOptions): Promise<InteractiveSession | undefined> {
  try {
    return createInteractiveSession(options);
  } catch (error) {
    await showAssistantError(error);
    writeTerminalOutput(noticePanel('Revisala desde "Configuración" en el menú.', 'warning'));

    return undefined;
  }
}

/** Devuelve si la opcion corrio: sin una sesion, no. */
async function runOption(
  option: Exclude<MenuOption, 'actualizar' | 'config' | 'salir'>,
  options: GlobalCliOptions,
): Promise<boolean> {
  const session = await resolveSession(options);

  if (!session) {
    return false;
  }

  if (option === 'factura') await runInvoiceFlow(session);
  if (option === 'recibo') await runInvoiceFlow(session, true);
  if (option === 'repetir') await runRepeatFlow(session);
  if (option === 'nota-credito') await runNoteFlow(session, 'credito');
  if (option === 'nota-debito') await runNoteFlow(session, 'debito');
  if (option === 'consultas') await runQueriesMenu(session);
  if (option === 'estado') await runStatusFlow(session);

  return true;
}

function updateChoice(update: UpdateCheckResult) {
  const name = `Actualizar a la versión ${update.latestVersion}`;

  return { name: colorize(name, 'highlight'), short: name, value: 'actualizar' as const };
}

/** Un turno, para que lo que no espera nada (`NO_UPDATE_NOTIFIER`) ya se sepa antes de dibujar. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

const SETUP_QUESTION = 'Falta completar la configuración. ¿La hacemos ahora, paso a paso?';

/** Las opciones del menu, sin la de actualizar. */
function menuChoices(): Array<Choice<MenuOption> | Separator> {
  return [
    {
      description: 'Factura A, B o C, de crédito (FCE) o de exportación (E)',
      name: 'Emitir factura',
      value: 'factura',
    },
    markIfNew({ description: 'Recibo A, B o C por un cobro', name: 'Emitir recibo', value: 'recibo' }, [
      'recibo',
      'recibos-a-b',
    ]),
    {
      description: 'Copia una de las últimas, con fechas nuevas',
      name: 'Repetir un comprobante anterior',
      value: 'repetir',
    },
    {
      description: 'Descuento, devolución o anulación de una factura',
      name: 'Emitir nota de crédito',
      value: 'nota-credito',
    },
    { description: 'Cargo adicional sobre una factura', name: 'Emitir nota de débito', value: 'nota-debito' },
    markIfNew(
      {
        description: 'Tus comprobantes, CUITs, cotizaciones, monotributo y tablas de ARCA',
        name: 'Consultas',
        value: 'consultas',
      },
      ['consultas', 'monotributo'],
    ),
    { description: 'Servidores, punto de venta y cotización del dólar', name: 'Estado de ARCA', value: 'estado' },
    markIfNew(
      {
        description: 'Revisar, configuración guiada, cambiar un dato y PDF',
        name: 'Configuración',
        value: 'config',
      },
      CONFIG_MENU_NEW_OPTIONS,
    ),
    new Separator(' '),
    { name: 'Salir', value: 'salir' },
  ];
}

/** Lo de arriba de la pregunta, que se completa mientras espera la respuesta. */
function liveHeader(header: StatusHeader): Omit<LiveChoices<never>, 'firstChoice'> {
  return {
    settleTop: header.settle,
    subscribe: (listener) => header.query?.subscribe(listener) ?? (() => undefined),
    top: header.text,
  };
}

/**
 * Antes de una pregunta: si lo que falta no puede aparecer con la pregunta abierta, espera a ARCA (la primera vez que
 * se ve la barra) y escribe lo que hay. Con Ctrl+C deja de esperar y la barra queda sin verificar. Devuelve si la
 * pregunta tiene que seguir actualizandose.
 */
async function prepareHeader(header: StatusHeader, choices: ReadonlyArray<Choice<MenuOption> | Separator>) {
  const query = header.query;
  const pending = query !== undefined && query.value() === undefined;

  if (pending && liveListFits(choices, header.possibleTexts())) {
    return true;
  }

  if (pending && !header.settled()) {
    try {
      await waitForArca('Consultando el estado de ARCA...', () => query.settled);
    } catch (error) {
      if (!isPromptCancellation(error)) {
        throw error;
      }

      header.cancel();
    }
  }

  writeTerminalRaw(topBlock(header.settle()));

  return false;
}

/** Asistente paso a paso encima del CLI. Ctrl+C cancela el flujo actual; en el menu, sale. */
export async function runInteractiveMode(options: GlobalCliOptions = {}): Promise<void> {
  // En el modo interactivo se consulta npm siempre (no una vez por dia).
  const updateQuery = startBackgroundQuery<null | UpdateCheckResult>(
    (signal) => checkCliUpdate({ maxAgeMs: 0, signal }),
    null,
  );
  const headers: StatusHeader[] = [];
  const openHeader = (margin?: string): StatusHeader => {
    const header = openStatusHeader(options, margin);

    headers.push(header);

    return header;
  };

  try {
    await runAssistant(options, updateQuery, openHeader);
  } finally {
    // Sin esto, una consulta colgada deja el proceso vivo hasta que vence su plazo.
    updateQuery.cancel();
    headers.forEach((header) => header.cancel());
  }
}

async function runAssistant(
  options: GlobalCliOptions,
  updateQuery: BackgroundQuery<null | UpdateCheckResult>,
  openHeader: (margin?: string) => StatusHeader,
): Promise<void> {
  // Dos lineas en blanco entre el logo y la barra. Debajo, una linea en blanco fija: al responder el menu, @inquirer
  // saca las lineas de su prefijo y sin esta la respuesta quedaria pegada a la barra (ver `compactTop` en el menu).
  writeTerminalRaw(`\n\n${renderLogo(CLI_VERSION)}\n\n\n`);

  let header = openHeader();
  // El menu va justo debajo de la barra solo la primera vez; despues, debajo de lo que mostro cada flujo.
  let menuUnderHeader = true;

  // Con lo que se haga ahi puede cambiar el entorno: la consulta de antes ya no vale y la barra se arma de nuevo, para
  // no seguir diciendo TESTING cuando la proxima factura ya sale en produccion.
  const runAndReopenHeader = async (run: () => Promise<void>): Promise<void> => {
    header.cancel();
    await run();
    header = openHeader('\n');
    menuUnderHeader = true;
    await nextTurn();
  };

  await nextTurn();

  const choices = menuChoices();
  // La primera vez, si no entra lo que falta, se espera a npm como a ARCA: despues, recien en el proximo menu.
  const waitsForUpdate = !liveListFits(choices, header.possibleTexts());
  let headerIsLive = await prepareHeader(header, choices);

  if (waitsForUpdate) {
    await updateQuery.settled;
  }

  // Primera vez: sin CUIT, certificado o punto de venta no se puede hacer nada, asi que se ofrece la guia.
  if (listMissingSetup(options).length > 0) {
    menuUnderHeader = false;

    try {
      if (
        await confirm(
          SETUP_QUESTION,
          'Sí, configurar',
          'Después',
          headerIsLive ? { ...liveHeader(header), firstChoice: () => undefined } : undefined,
        )
      ) {
        await runAndReopenHeader(() => runGuidedSetup(options));
      }
    } catch (error) {
      if (!isPromptCancellation(error)) {
        throw error;
      }
    }

    headerIsLive = await prepareHeader(header, choices);
  }

  for (;;) {
    let option: MenuOption;
    // La que ya se sabe es una opcion mas; la que llega despues aparece con el menu abierto, si entra.
    const update = updateQuery.value() ?? undefined;
    const updateIsLive = updateQuery.value() === undefined && liveListFits(choices, header.possibleTexts());

    try {
      option = await chooseOne<MenuOption>(
        '¿Qué querés hacer?',
        [...(update ? [updateChoice(update), new Separator(' ')] : []), ...choices],
        undefined,
        {
          compactTop: menuUnderHeader,
          escapeLabel: 'salir',
          escapeValue: 'salir',
          live: headerIsLive || updateIsLive ? liveMenu(header, updateIsLive ? updateQuery : undefined) : undefined,
        },
      );
      menuUnderHeader = false;
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
      if (option === 'actualizar') {
        const chosen = updateQuery.value();

        if (chosen && (await runUpdateFlow(chosen))) {
          return;
        }
      } else if (option === 'config') {
        await runAndReopenHeader(() => runConfigMenu(options));
      } else {
        const ran = await runOption(option, options);

        // Esa pantalla ya mostro como esta ARCA.
        if (ran && option === 'estado') {
          header.dismissResult();
        }
      }
    } catch (error) {
      // El proceso esta por terminar por la segunda señal: no se escribe nada mas.
      if (error instanceof ResentSignalError) {
        throw error;
      }

      if (isPromptCancellation(error)) {
        writeTerminalOutput(colorize(EMITTING_OPTIONS.has(option) ? CANCELLED_NOTICE : CANCELLED, 'muted'));
      } else {
        await showAssistantError(error);
      }
    }

    headerIsLive = await prepareHeader(header, choices);
  }

  writeTerminalOutput(colorize(`¡Hasta la próxima! Guías y ayuda: ${DOCS_SITE_URL}`, 'muted'));
}

/** El menu que se completa mientras espera: la barra (o el aviso) y la version nueva. */
function liveMenu(
  header: StatusHeader,
  updateQuery: BackgroundQuery<null | UpdateCheckResult> | undefined,
): LiveChoices<MenuOption> {
  const live = liveHeader(header);
  let choice: Choice<MenuOption> | undefined;

  return {
    ...live,
    firstChoice: () => {
      const update = updateQuery?.value();

      return (choice ??= update ? updateChoice(update) : undefined);
    },
    subscribe: (listener) => {
      const stops = [live.subscribe(listener), updateQuery?.subscribe(listener)];

      return () => stops.forEach((stop) => stop?.());
    },
  };
}
