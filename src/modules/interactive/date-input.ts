import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { parseDateInputAsArcaDate } from '../../lib/dates/relative-date';

/**
 * Una fecha escrita en el asistente (`10`, `15/11`, `15/11/26`, `hoy`, `-3`), completa en dd/mm/aaaa: el comando
 * equivalente pegado otro dia u otro mes sigue dando la misma fecha. La fecha ya paso por el validador de su pregunta.
 */
export function completeDateInput(value: string, now: Date): string {
  return formatArcaDateAsArgentineDate(parseDateInputAsArcaDate(value, 'day', now));
}
