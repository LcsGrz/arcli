#!/usr/bin/env node

import { OWNER_ONLY_UMASK } from '../lib/files/restrict-to-owner';
import { COMPLETE_COMMAND } from '../modules/completion/shell-scripts';
import { renderUpdateNoticePanel } from '../modules/update-check/update-check.presenter';
import { writeTerminalError } from '../ui';

import { settleOutput, watchOutputs } from './closed-output';
import { isInteractiveTerminal } from './commands/interactive.command';
import { isSilentExit, reportCliError, reportOutputFailure, shouldPrintErrorAsJson } from './error-output';
import { normalizeHelpArgv } from './help-argv';
import { wasAssistantOpened } from './interactive/output-guard';
import { finishCut } from './interruption';
import { createProgram } from './program';
import { checkCliUpdate } from './update-check';

const outputFailures = watchOutputs();

// Tickets de ARCA, config y PDFs se crean solo para el usuario (el SDK escribe los tickets con permisos por defecto).
process.umask(OWNER_ONLY_UMASK);

let errorsAsJson: boolean | undefined;
let commandError: unknown;
let outputFailureReported = false;
// Se decide recien al fallar: puede leer la config.
// El asistente no tiene salida JSON: una vez abierto, `json=true` de la config no cuenta.
const shouldPrintErrorsAsJson = (): boolean =>
  (errorsAsJson ??= shouldPrintErrorAsJson(process.argv, wasAssistantOpened() ? () => false : undefined));
const program = createProgram();
// El autocompletado corre en cada Tab: recibe las palabras tal cual y no busca actualizaciones.
const isCompletion = process.argv[2] === COMPLETE_COMMAND;
const argv = isCompletion ? process.argv : normalizeHelpArgv(process.argv, isInteractiveTerminal());
const useJson = process.argv.includes('--json');
// El modo interactivo muestra la actualizacion como primera opcion del menu, no al cerrar.
const isInteractiveMode = argv[2] === 'interactivo';
// El comando no espera a npm: si al terminar no contesto, se cancela y el proximo reintenta.
const updateCheck = new AbortController();
const updateCheckPromise =
  useJson || isInteractiveMode || isCompletion
    ? Promise.resolve(null)
    : checkCliUpdate({ signal: updateCheck.signal }).catch(() => null);

program
  .parseAsync(argv)
  .finally(() => updateCheck.abort())
  .then(async () => {
    const updateResult = await updateCheckPromise;

    if (!updateResult) {
      return;
    }

    await settleOutput('stdout');

    // Si va a ir el JSON de la salida que no se pudo escribir, no va: igual que con cualquier error en JSON.
    if (!outputFailures.has('stdout') || !shouldPrintErrorsAsJson()) {
      writeTerminalError(() => renderUpdateNoticePanel(updateResult));
    }
  })
  .catch(async (error: unknown) => {
    commandError = error;

    // Con JSON se espera a saber si stdout fallo, para que stderr siga siendo un solo documento.
    if (shouldPrintErrorsAsJson() && !isSilentExit(error)) {
      await settleOutput('stdout');
      outputFailureReported = outputFailures.has('stdout');
    }

    process.exitCode = reportCliError(error, shouldPrintErrorsAsJson(), outputFailures);
    // Cortado por una señal no hay `beforeExit`.
    await finishCut(reportLostOutput);
  });

function reportLostOutput(): void {
  if (outputFailures.size === 0) {
    return;
  }

  process.exitCode ||= 1;

  if (!outputFailureReported) {
    reportOutputFailure(outputFailures, { commandError, json: shouldPrintErrorsAsJson() });
  }
}

// Recien aca no queda ninguna escritura pendiente: todo error de las salidas ya se sabe.
process.once('beforeExit', reportLostOutput);
