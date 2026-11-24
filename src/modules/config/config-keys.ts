import { type ConfigPublicKey, ROWS_PER_LIST_DEPRECATION_WARNING } from './config.schemas';
import type { CanonicalConfigKey } from './config-value-parser';

/** Donde se guarda cada clave publica en el config.json. */
export const CONFIG_KEY_ALIASES: Record<ConfigPublicKey, CanonicalConfigKey> = {
  alicuota: 'alicuotaPorDefecto',
  aliasCbu: 'aliasCbu',
  cbu: 'cbu',
  'cert.produccion': 'cert.produccion',
  'cert.testing': 'cert.testing',
  concepto: 'conceptoPorDefecto',
  condicionVenta: 'condicionVenta',
  cotizacion: 'cotizacionPorDefecto',
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
  Record<string, { readonly replacement: ConfigPublicKey; readonly warning: string }>
> = {
  comprobantesPorLista: { replacement: 'filasPorLista', warning: ROWS_PER_LIST_DEPRECATION_WARNING },
};
