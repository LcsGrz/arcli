import {
  accountKeyDeprecationWarning,
  type ConfigPublicKey,
  ROWS_PER_LIST_DEPRECATION_WARNING,
} from './config.schemas';
import type { CanonicalConfigKey } from './config-value-parser';

/** Lo que guarda `cuenta`, cada uno en su clave del archivo. Como claves de `config establecer` estan deprecadas. */
export type AccountStoredKey = 'aliasCbu' | 'cbu';

/** Donde se guarda cada clave en el config.json. `cuenta` guarda ademas `aliasCbu`. */
export const CONFIG_KEY_ALIASES: Record<AccountStoredKey | ConfigPublicKey, CanonicalConfigKey> = {
  alicuota: 'alicuotaPorDefecto',
  aliasCbu: 'aliasCbu',
  cbu: 'cbu',
  'cert.produccion': 'cert.produccion',
  'cert.testing': 'cert.testing',
  concepto: 'conceptoPorDefecto',
  condicionVenta: 'condicionVenta',
  cotizacion: 'cotizacionPorDefecto',
  cuenta: 'cbu',
  cuit: 'cuit',
  'emisor.condicionIva': 'emisor.condicionIva',
  'emisor.domicilio': 'emisor.domicilio',
  'emisor.iibb': 'emisor.iibb',
  'emisor.inicioActividades': 'emisor.inicioActividades',
  'emisor.logo': 'emisor.logo',
  'emisor.razonSocial': 'emisor.razonSocial',
  entorno: 'entornoPorDefecto',
  emitir: 'output.emitirPorDefecto',
  'exportacion.actividad': 'exportacion.actividad',
  'exportacion.cert.produccion': 'exportacion.cert.produccion',
  'exportacion.cert.testing': 'exportacion.cert.testing',
  'exportacion.key.produccion': 'exportacion.key.produccion',
  'exportacion.key.testing': 'exportacion.key.testing',
  filasPorLista: 'filasPorLista',
  ivaReceptor: 'ivaReceptorPorDefecto',
  json: 'output.jsonPorDefecto',
  'key.produccion': 'key.produccion',
  'key.testing': 'key.testing',
  moneda: 'monedaPorDefecto',
  'monotributo.tope': 'monotributo.tope',
  bruto: 'output.brutoPorDefecto',
  pdf: 'pdf',
  pdfCarpeta: 'pdfCarpeta',
  pdfNavegador: 'pdfNavegador',
  puntoVenta: 'puntoVentaPorDefecto',
  ticketPath: 'ticketPath',
  verificarFce: 'verificarFce',
  consultarPadron: 'consultarPadron',
};

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
