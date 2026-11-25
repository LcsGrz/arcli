import { z } from 'zod';

import type { ArcliConfig } from './config.schemas';

/** Las rutas de los datos de un objeto: `cuit`, `exportacion.cert.testing`. Los grupos, como `emisor`, no. */
type DataPath<T> = {
  [Key in keyof T & string]-?: NonNullable<T[Key]> extends object ? `${Key}.${DataPath<NonNullable<T[Key]>>}` : Key;
}[keyof T & string];

export interface ConfigKeyRow {
  /** Dónde se guarda en el `config.json`. */
  readonly stored: DataPath<ArcliConfig>;
}

/** Las claves públicas. El orden es contrato: es el de `detalles` cuando una clave no existe. */
const CONFIG_KEY_TABLE = {
  alicuota: { stored: 'alicuotaPorDefecto' },
  'cert.produccion': { stored: 'cert.produccion' },
  'cert.testing': { stored: 'cert.testing' },
  concepto: { stored: 'conceptoPorDefecto' },
  condicionVenta: { stored: 'condicionVenta' },
  /** Guarda además `aliasCbu`, con sus propias reglas. */
  cuenta: { stored: 'cbu' },
  cuit: { stored: 'cuit' },
  cotizacion: { stored: 'cotizacionPorDefecto' },
  'emisor.condicionIva': { stored: 'emisor.condicionIva' },
  'emisor.domicilio': { stored: 'emisor.domicilio' },
  'emisor.iibb': { stored: 'emisor.iibb' },
  'emisor.inicioActividades': { stored: 'emisor.inicioActividades' },
  'emisor.logo': { stored: 'emisor.logo' },
  'emisor.razonSocial': { stored: 'emisor.razonSocial' },
  entorno: { stored: 'entornoPorDefecto' },
  emitir: { stored: 'output.emitirPorDefecto' },
  'exportacion.actividad': { stored: 'exportacion.actividad' },
  'exportacion.cert.produccion': { stored: 'exportacion.cert.produccion' },
  'exportacion.cert.testing': { stored: 'exportacion.cert.testing' },
  'exportacion.key.produccion': { stored: 'exportacion.key.produccion' },
  'exportacion.key.testing': { stored: 'exportacion.key.testing' },
  filasPorLista: { stored: 'filasPorLista' },
  ivaReceptor: { stored: 'ivaReceptorPorDefecto' },
  json: { stored: 'output.jsonPorDefecto' },
  'key.produccion': { stored: 'key.produccion' },
  'key.testing': { stored: 'key.testing' },
  moneda: { stored: 'monedaPorDefecto' },
  'monotributo.tope': { stored: 'monotributo.tope' },
  bruto: { stored: 'output.brutoPorDefecto' },
  pdf: { stored: 'pdf' },
  pdfCarpeta: { stored: 'pdfCarpeta' },
  pdfNavegador: { stored: 'pdfNavegador' },
  puntoVenta: { stored: 'puntoVentaPorDefecto' },
  ticketPath: { stored: 'ticketPath' },
  verificarFce: { stored: 'verificarFce' },
  consultarPadron: { stored: 'consultarPadron' },
} as const satisfies Record<string, ConfigKeyRow>;

export type ConfigPublicKey = keyof typeof CONFIG_KEY_TABLE;

/** Lo que guarda `cuenta`, cada uno en su clave del archivo. Como claves de `config establecer` están deprecadas. */
export type AccountStoredKey = 'aliasCbu' | 'cbu';

type StoredKey = AccountStoredKey | (typeof CONFIG_KEY_TABLE)[ConfigPublicKey]['stored'];

/** Datos del esquema sin clave pública a propósito: `comprobantesPorLista` está deprecada y solo se lee. */
type StoredWithoutKey = 'comprobantesPorLista';

/**
 * Los datos de una config que ninguna clave guarda.
 *
 * @internal Exportado solo para su test de tipos.
 */
export type UncoveredData<Config> = Exclude<DataPath<Config>, StoredKey | StoredWithoutKey>;

/**
 * `Keys`, y no compila si queda un dato sin clave: el error lo nombra.
 *
 * @internal Exportado solo para su test de tipos.
 */
export type CoveringKeys<Keys, Uncovered extends never> = Keys | Uncovered;

/** La ruta de un dato en el `config.json`. */
export type CanonicalConfigKey = CoveringKeys<StoredKey, UncoveredData<ArcliConfig>>;

export const configPublicKeySchema = z.enum(Object.keys(CONFIG_KEY_TABLE) as ConfigPublicKey[]);

/** Dónde se guarda cada clave en el `config.json`. */
export function storedKeyOf(key: AccountStoredKey | ConfigPublicKey): CanonicalConfigKey {
  return key === 'aliasCbu' || key === 'cbu' ? key : CONFIG_KEY_TABLE[key].stored;
}
