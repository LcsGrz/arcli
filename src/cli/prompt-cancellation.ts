/**
 * Ctrl+C dentro de un prompt de @inquirer, o en una espera del asistente (`promptCancellation`). Va aparte de
 * `interactive/prompts` para que lo que solo lo reconoce no dependa de las preguntas.
 */
export function isPromptCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === 'ExitPromptError';
}

/**
 * Un Ctrl+C simulado, que se atiende como uno en una pregunta: una espera del asistente cortada, o una pregunta que no
 * se puede abrir porque nadie ve la salida.
 */
export function promptCancellation(message = 'Cancelado.'): Error {
  return Object.assign(new Error(message), { name: 'ExitPromptError' });
}
