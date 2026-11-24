import { type Command, CommanderError } from 'commander';
import { ZodError } from 'zod';

import { AppError, HELP_SUGGESTION, InputIssuesError } from '../lib/errors/app-error';
import { type SerializedError, serializeError } from '../lib/errors/serialize-error';
import { describeSchemaError, describeZodIssues } from '../modules/billing/billing.zod-errors';
import {
  formatAppError,
  formatInputIssues,
  noticePanel,
  writeTerminalError,
  writeTerminalJsonError,
  writeTerminalOutput,
} from '../ui';

import { describeOutputFailure, type OutputFailures } from './closed-output';
import { EmissionCancelledError } from './emission-cancelled';
import { describeEmittedInThisRun } from './emitted-vouchers';
import { readJsonDefault } from './global-options';
import { isPromptCancellation } from './interactive/prompts';
import { UsageErrorWithSuggestion } from './usage-error';

/** Cualquier error, como panel. Los de un esquema los describe billing: la UI no conoce sus campos. */
export function formatCliError(error: unknown): string {
  if (error instanceof InputIssuesError) {
    return formatInputIssues(error.issues, { message: error.message, suggestion: error.suggestion });
  }

  return error instanceof ZodError ? formatInputIssues(describeZodIssues(error)) : formatAppError(error);
}

/**
 * Cualquier error, como el objeto del `--json`.
 *
 * @internal Exportado para los tests.
 */
export function serializeCliError(error: unknown): SerializedError {
  return serializeError(describeSchemaError(error));
}

/**
 * Los errores salen en JSON con `--json` o, sin el flag, si la config tiene `json=true`, igual que los
 * resultados. La config se lee recien al fallar; si tambien falla (config invalida), sale en texto.
 */
export function shouldPrintErrorAsJson(argv: readonly string[], readDefault = readJsonDefault): boolean {
  if (argv.includes('--json')) {
    return true;
  }

  try {
    return readDefault();
  } catch {
    return false;
  }
}

/** Lo que commander señaliza por `exitOverride` sin que sea un error de uso: ayuda y version, ya impresas. */
const COMMANDER_NON_ERROR_CODES = new Set(['commander.help', 'commander.helpDisplayed', 'commander.version']);

/** Ayuda o version: commander ya las imprimio y solo queda salir con su exit code. */
export function isCommanderExit(error: unknown): error is CommanderError {
  return error instanceof CommanderError && COMMANDER_NON_ERROR_CODES.has(error.code);
}

/** Un error de uso de commander: opcion desconocida, valor faltante, argumento de mas, etc. */
function isCommanderUsageError(error: unknown): error is CommanderError {
  return error instanceof CommanderError && !COMMANDER_NON_ERROR_CODES.has(error.code);
}

/** Los mensajes de error de uso de commander (15.x), que vienen en ingles. */
const COMMANDER_MESSAGES: ReadonlyArray<readonly [RegExp, string]> = [
  [/unknown option '([^']+)'/, 'opción desconocida `$1`'],
  [/unknown command '([^']+)'/, 'comando desconocido `$1`'],
  [/missing required argument '([^']+)'/, 'falta el argumento obligatorio `$1`'],
  [/option '([^']+)' argument missing/, 'falta el valor de la opción `$1`'],
  [/required option '([^']+)' not specified/, 'falta la opción obligatoria `$1`'],
  [/option '([^']+)' argument '([^']*)' is invalid\./, "el valor '$2' de la opción `$1` no es válido."],
  [
    /too many arguments(?: for '([^']+)')?\. Expected (\d+) arguments? but got (\d+): (.*)\./,
    'sobran argumentos: espera $2 y recibió $3 ($4).',
  ],
  [/option '([^']+)' cannot be used with option '([^']+)'/, 'la opción `$1` no se puede usar junto con la opción `$2`'],
  [/ cannot be used with /, ' no se puede usar junto con '],
  [/\(Did you mean ([^?]+)\?\)/, '(¿quisiste decir `$1`?)'],
];

function translateCommanderMessage(message: string): string {
  // Va antes que la tabla: "Did you mean one of" tambien coincide con "Did you mean".
  const suggested = message.replace(/\(Did you mean one of ([^?]+)\?\)/, (_match, options: string) => {
    const quoted = options.split(', ').map((option) => `\`${option}\``);

    return `(¿quisiste decir alguno de ${quoted.join(', ')}?)`;
  });

  return COMMANDER_MESSAGES.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), suggested);
}

/** El error de uso de commander como `INPUT_VALIDATION_ERROR`, en el mismo formato que el resto. */
function toUsageError(error: CommanderError): AppError {
  // Commander arma el mensaje con "error: " adelante y, a veces, una segunda linea "(Did you mean --monto?)".
  const message = translateCommanderMessage(error.message)
    .replace(/^error:\s*/i, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim();

  return new AppError(message, {
    code: 'INPUT_VALIDATION_ERROR',
    suggestion: error instanceof UsageErrorWithSuggestion ? error.suggestion : HELP_SUGGESTION,
  });
}

/**
 * Commander tira los errores de uso en vez de cortar el proceso, para que `index.ts` los maneje como el resto: los
 * escribe `reportCliError`, en panel o en JSON, y commander se calla.
 * Va antes de registrar los comandos: los subcomandos copian esta config al crearse.
 */
export function configureUsageErrors(program: Command): void {
  let failing = false;

  program.exitOverride().configureOutput({
    outputError: () => {
      failing = true;
    },
    writeErr: (text) => {
      // Despues de un error, commander escribe la pista de la ayuda: la sugerencia del panel ya la da.
      if (!failing) {
        process.stderr.write(text);
      }
    },
  });
}

/** Un error, como lo muestra el panel. */
function formatErrorPanel(error: unknown): string {
  if (isCommanderUsageError(error)) {
    return formatCliError(toUsageError(error));
  }

  if (error instanceof EmissionCancelledError) {
    return noticePanel(error.message, 'muted');
  }

  // Ctrl+C en una pregunta que el comando no atrapo: aca no se sabe si ya se emitio algo, asi que no se dice.
  return isPromptCancellation(error) ? noticePanel('Cancelado.', 'muted') : formatCliError(error);
}

/**
 * Imprime un error que corto la ejecucion y devuelve el exit code. Ayuda y version no son errores.
 *
 * Con JSON, si ademas fallo stdout, lo que diria `reportOutputFailure` va en la `sugerencia`: dos documentos en stderr
 * no se podrian parsear.
 */
export function reportCliError(
  error: unknown,
  errorsAsJson: boolean,
  outputFailures: OutputFailures = new Map(),
): number {
  if (isCommanderExit(error)) {
    return error.exitCode;
  }

  const usageError = isCommanderUsageError(error);

  if (errorsAsJson) {
    writeTerminalJsonError(
      addOutputFailure(serializeCliError(usageError ? toUsageError(error) : error), outputFailures),
    );
  } else {
    writeTerminalError(() => formatErrorPanel(error));
  }

  return usageError ? error.exitCode : 1;
}

function addOutputFailure(report: SerializedError, outputFailures: OutputFailures): SerializedError {
  const failure = outputFailures.get('stdout');

  if (!failure) {
    return report;
  }

  const notes = [describeOutputFailure('stdout', failure), ...describeEmittedInThisRun()];

  return { ...report, sugerencia: [report.sugerencia, ...notes].filter(Boolean).join(' ') };
}

/**
 * No se pudo escribir una salida: se dice por la otra, con lo que se emitio. Si fallaron las dos no hay donde.
 *
 * Si la que fallo es stderr, tambien se perdio el error del comando y va con el aviso. Con JSON no se escribe nada:
 * stdout es solo el resultado, y lo dice el exit code.
 */
export function reportOutputFailure(
  failures: OutputFailures,
  options: { readonly commandError: unknown; readonly json: boolean },
): void {
  const [failure, other] = failures;

  if (!failure || other) {
    return;
  }

  const [output] = failure;
  const message = describeOutputFailure(...failure);
  const emitted = describeEmittedInThisRun(output === 'stdout' ? 'no-avisado' : 'todo');
  const formatNotice = (): string => noticePanel([message, ...emitted].join('\n'), 'warning');

  if (output === 'stdout') {
    if (options.json) {
      const suggestion = emitted.join(' ') || undefined;

      writeTerminalJsonError(serializeError(new AppError(message, { code: 'OUTPUT_WRITE_ERROR', suggestion })));
    } else {
      writeTerminalError(formatNotice);
    }
  } else if (!options.json) {
    writeTerminalOutput(formatNotice());

    if (options.commandError !== undefined && !isCommanderExit(options.commandError)) {
      writeTerminalOutput(formatErrorPanel(options.commandError));
    }
  }
}
