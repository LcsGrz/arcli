export const NOTHING_EMITTED_NOTICE = 'No se emitió nada.';

/** Ctrl+C en una pregunta antes de emitir. Con algo ya emitido no se puede usar. */
export const CANCELLED_NOTICE = `Cancelado. ${NOTHING_EMITTED_NOTICE}`;

/** La pregunta antes de emitir, igual con flags y en el modo interactivo: siempre dice en que entorno se emite. */
export function formatEmissionQuestion(subject: string, environment: 'produccion' | 'testing'): string {
  return `¿Emitimos ${subject} en ${environment === 'produccion' ? 'PRODUCCIÓN' : 'testing'}?`;
}
