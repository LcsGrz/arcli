/** La aclaracion de una pregunta de texto opcional (`hint`): Enter la deja vacia. */
export const SKIP_HINT = '(Enter para omitirlo)';

/** Como `SKIP_HINT`, si omitirlo ademas borra lo guardado. */
export const skipAndRemoveHint = (saved: string): string => `(Enter para omitirlo: borra ${saved})`;

/** La primera fila de una lista opcional donde tambien se escribe (`chooseOrTypeStep`), si no dice otra: la deja vacia. */
export const SKIP_ROW = 'Omitir';
