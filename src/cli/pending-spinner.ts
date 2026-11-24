import { startSpinner } from './spinner';

/**
 * Como `withSpinner`, para algo que puede no consultar nada: el spinner arranca recien si `run` sigue pendiente, asi sin
 * consultas a ARCA no parpadea. Se detiene siempre, tambien si falla, antes de devolver. Sin texto, no hay spinner.
 */
export async function withPendingSpinner<T>(text: string | null, run: () => Promise<T>): Promise<T> {
  if (text === null) {
    return run();
  }

  let spinner: ReturnType<typeof startSpinner> = null;
  const timer = setTimeout(() => {
    spinner = startSpinner(text);
  }, 0);

  try {
    return await run();
  } finally {
    clearTimeout(timer);
    (spinner as ReturnType<typeof startSpinner>)?.stop();
  }
}
