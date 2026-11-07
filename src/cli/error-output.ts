import { type Command, CommanderError } from 'commander';
import { ZodError } from 'zod';

import { AppError, HELP_SUGGESTION } from '../lib/errors/app-error';
import { describeZodIssues } from '../modules/billing/billing.zod-errors';
import { formatAppError, formatInputIssues, writeTerminalError, writeTerminalJsonError } from '../ui';

import { readJsonDefault } from './global-options';

/** Cualquier error, como panel o JSON. Los de un esquema los describe billing: la UI no conoce sus campos. */
export function formatCliError(error: unknown, useJson: boolean): string {
  return error instanceof ZodError
    ? formatInputIssues(describeZodIssues(error), useJson)
    : formatAppError(error, useJson);
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
function isCommanderExit(error: unknown): error is CommanderError {
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
    suggestion: HELP_SUGGESTION,
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

/**
 * Imprime un error que corto la ejecucion y devuelve el exit code. Ayuda y version no son errores.
 */
export function reportCliError(error: unknown, errorsAsJson: boolean): number {
  if (isCommanderExit(error)) {
    return error.exitCode;
  }

  if (isCommanderUsageError(error)) {
    if (errorsAsJson) {
      writeTerminalJsonError(formatCliError(toUsageError(error), true));
    } else {
      writeTerminalError(() => formatCliError(toUsageError(error), false));
    }

    return error.exitCode;
  }

  if (errorsAsJson) {
    writeTerminalJsonError(formatCliError(error, true));
  } else {
    writeTerminalError(() => formatCliError(error, false));
  }

  return 1;
}
