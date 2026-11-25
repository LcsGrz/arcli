import { accountKeyDeprecationWarning, ROWS_PER_LIST_DEPRECATION_WARNING } from './config.schemas';
import type { AccountStoredKey, ConfigPublicKey } from './config-key-table';

/**
 * Claves deprecadas que `config establecer` y `config eliminar` todavia aceptan, con la clave que las reemplaza. No
 * son claves publicas: no salen en la ayuda, el autocompletado ni `arcli config`. Se sacan en la 3.0.0.
 */
export const DEPRECATED_CONFIG_KEYS: Readonly<
  Record<
    string,
    {
      /** El aviso de `config eliminar`, si el comando que la reemplaza es otro. */
      readonly removeWarning?: string;
      readonly replacement: ConfigPublicKey;
      /** Todavia guarda solo esta parte de lo que guarda el reemplazo. */
      readonly storedAs?: AccountStoredKey;
      readonly warning: string;
    }
  >
> = {
  aliasCbu: {
    removeWarning: accountKeyDeprecationWarning(
      'aliasCbu',
      '`arcli config establecer cuenta <CBU>`, que deja la cuenta sin alias',
    ),
    replacement: 'cuenta',
    storedAs: 'aliasCbu',
    warning: accountKeyDeprecationWarning('aliasCbu', '`arcli config establecer cuenta <CBU> [ALIAS]`'),
  },
  cbu: {
    removeWarning: accountKeyDeprecationWarning('cbu', '`arcli config eliminar cuenta`'),
    replacement: 'cuenta',
    storedAs: 'cbu',
    warning: accountKeyDeprecationWarning('cbu', '`arcli config establecer cuenta <CBU> [ALIAS]`'),
  },
  comprobantesPorLista: { replacement: 'filasPorLista', warning: ROWS_PER_LIST_DEPRECATION_WARNING },
};

/** `cuenta` es la unica clave con dos valores: el CBU y, si se quiere, su alias. */
export function acceptsAlias(rawKey: string): boolean {
  return rawKey.trim() === 'cuenta';
}
