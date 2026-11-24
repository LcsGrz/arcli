/**
 * Los verbos con que los errores dicen que hacer, sin la terminacion: `us` por `Usá` o `usala`. Si a un mensaje le
 * falta su verbo aca, solo se le suma la sugerencia general.
 */
const VERB_STEMS =
  'acort|baj|borr|carg|configur|consult|correg|cre|dej|descifr|eleg|emit|escrib|gener|identific|indic|inform|instal|pas|prob|quit|reintent|renombr|revis|sac|sum|us|volv';

/** Imperativos con voseo, solos (`Sacá`, `Corregí`) o con el dato pegado (`Configuralo`, `sacala`). */
const IMPERATIVE = new RegExp(`(?<!\\p{L})(?:${VERB_STEMS})(?:[áéí]|[aei]l[oa]s?)(?!\\p{L})`, 'iu');

/** Si un mensaje de error ya dice que hacer: una sugerencia general abajo repetiria o distraeria. */
export function saysWhatToDo(message: string): boolean {
  return IMPERATIVE.test(message);
}
