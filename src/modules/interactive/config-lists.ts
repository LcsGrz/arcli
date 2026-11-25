import { sameSearch } from '../../lib/text/search';
import { ARCA_CURRENCIES, toArcaCurrencyCode } from '../billing/currency-codes';
import type { ConfigPublicKey } from '../config/config-key-table';

import type { ConfigField } from './config-fields';

/**
 * Como se elige un dato de "Modificar configuracion" de una lista donde tambien se escribe (TUI-35, TUI-39):
 * - `choices`: texto libre con sugerencias (la condicion de venta); lo escrito gana a la sugerencia que lo contiene.
 * - `currency`: las monedas de ARCA, sin consultarla.
 * - `activity`: la tabla de actividades de WSFEX, que hay que consultar.
 */
export type ConfigListKind = 'activity' | 'choices' | 'currency';

/** La lista de un dato, o ninguna (se escribe). */
export function configListKind(field: Pick<ConfigField, 'choices' | 'freeText' | 'key'>): ConfigListKind | undefined {
  if (field.choices && field.freeText) {
    return 'choices';
  }

  if (field.key === 'moneda') {
    return 'currency';
  }

  return field.key === 'exportacion.actividad' ? 'activity' : undefined;
}

/** En el texto libre con sugerencias, lo escrito se usa tal cual; en una tabla o un codigo, elige la fila que coincide. */
export function configListPrefersTyped(kind: ConfigListKind): boolean {
  return kind === 'choices';
}

/** La fila de lo guardado: una moneda guardada con su ISO (`USD`) es la fila de su codigo de ARCA (`DOL`). */
export function configListPrevious(kind: ConfigListKind, current: string): string {
  return kind === 'currency' ? toArcaCurrencyCode(current) : current;
}

/**
 * Si lo elegido es lo que ya estaba guardado, para decir "Sin cambios." en lugar de reescribirlo: la sugerencia que se
 * lee igual que el texto guardado ("Contado" y `contado`), la moneda por su codigo de ARCA (DOL y USD) y la actividad
 * por su codigo.
 */
export function isSameConfigChoice(
  kind: ConfigListKind,
  chosen: { readonly label: string; readonly value: string },
  current: string,
): boolean {
  if (kind === 'choices') {
    return sameSearch(chosen.label, current);
  }

  return kind === 'currency' ? chosen.value === toArcaCurrencyCode(current) : chosen.value === current.trim();
}

/** Una moneda de la lista de la config: guarda el codigo de ARCA, y se busca tambien por el ISO. */
export interface ConfigCurrencyOption {
  readonly code: string;
  /** El codigo de ARCA y el ISO (`DOL USD`): cada uno, escrito entero, es la fila exacta. */
  readonly keywords: string;
  readonly name: string;
}

/** Las monedas de la tabla de ARCA (`ARCA_CURRENCIES`), en su orden, como el default `PES`. */
export function configCurrencyOptions(): readonly ConfigCurrencyOption[] {
  return ARCA_CURRENCIES.map((currency) => ({
    code: currency.arca,
    keywords: [currency.arca, currency.iso].filter(Boolean).join(' '),
    name: currency.name,
  }));
}

/**
 * Las claves que cambian con que entorno o certificado se consulta ARCA: si se guardan, la tabla de actividades ya
 * consultada no vale y se vuelve a pedir.
 */
export function changesArcaAccess(key: ConfigPublicKey): boolean {
  return key === 'entorno' || /^(exportacion\.)?(cert|key)\./.test(key);
}
