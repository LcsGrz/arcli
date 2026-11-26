/**
 * Ctrl+C dentro de un prompt de @inquirer, o en una espera del asistente (`promptCancellation`). Va aparte de
 * `interactive/prompts` para que lo que solo lo reconoce no dependa de las preguntas.
 */
export function isPromptCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === 'ExitPromptError';
}

/** Lo que tira una espera del asistente cortada con Ctrl+C: se atiende como un Ctrl+C en una pregunta. */
export function promptCancellation(): Error {
  return Object.assign(new Error('Cancelado.'), { name: 'ExitPromptError' });
}
