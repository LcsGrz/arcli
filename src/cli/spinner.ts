import ora, { type Ora } from 'ora';

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

  return ora({ discardStdin: false, text }).start();
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
