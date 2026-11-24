import ora, { type Ora } from 'ora';

import { asQuery } from '../lib/errors/query-error';
import { usesAsciiBorders } from '../ui';

/**
 * Spinner compartido por los comandos y el modo interactivo.
 * - `discardStdin: false`: por defecto ora toma stdin para descartar teclas y choca con los prompts de @inquirer.
 * - Sin ancho de terminal conocido no se muestra: con 0 columnas ora calcula infinitas lineas para borrar,
 *   escribe sin parar y bloquea el event loop.
 */
export function startSpinner(text: string): Ora | null {
  if (!process.stdout.isTTY || !process.stdout.columns) {
    return null;
  }

  return ora({ discardStdin: false, ...(usesAsciiBorders() ? { spinner: 'line' as const } : {}), text }).start();
}

/** Corre `run` con un spinner que se detiene siempre, tambien si falla. Sin texto, no hay spinner. */
export async function withSpinner<T>(text: string | null, run: () => Promise<T>): Promise<T> {
  const spinner = text === null ? null : startSpinner(text);

  try {
    return await run();
  } finally {
    spinner?.stop();
  }
}

/** Como `withSpinner`, para una consulta: si falla, el error queda marcado y no habla de emitir (`asQuery`). */
export function queryWithSpinner<T>(text: string | null, run: () => Promise<T>): Promise<T> {
  return withSpinner(text, () => asQuery(run));
}
