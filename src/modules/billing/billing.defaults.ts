import { type ArcliConfig, isPadronLookupEnabled } from '../config/config.schemas';

import { DEFAULT_EXCHANGE_RATE } from './billing.constants';
import type { BillingCommandInput } from './billing.schemas';

/** Lo que la config completa cuando no lo dicen ni los flags ni el JSON. */
export interface BillingDefaults {
  readonly defaultIvaRate?: BillingCommandInput['ivaRate'];
  readonly defaultCbu?: string;
  readonly defaultCbuAlias?: string;
  readonly defaultConcept?: BillingCommandInput['concept'];
  readonly defaultCurrencyCode?: string;
  readonly defaultEmit?: boolean;
  readonly defaultExchangeRate?: number;
  /** El punto de venta de la config: el de la nota es el de su asociado propio. */
  readonly defaultPointOfSale?: number;
  /** El CUIT emisor, para saber si un asociado es propio. */
  readonly emitterCuit?: number;
  readonly defaultIvaCondition?: BillingCommandInput['ivaCondition'];
  /** Con un CUIT y sin IVA receptor explicito, se va a consultar el padron: no hace falta un default. */
  readonly lookupIvaConditionInPadron?: boolean;
}

/** El mismo CBU, como lo lee el schema (sin espacios). */
export function isSameCbu(left: string | undefined, right: string | undefined): boolean {
  return left?.trim() === right?.trim();
}

/** El alias guardado, si es del CBU que va en el comprobante: con otro CBU seria el alias de otra cuenta. */
export function savedCbuAlias(
  defaults: Pick<BillingDefaults, 'defaultCbu' | 'defaultCbuAlias'>,
  cbu: string | undefined,
): string | undefined {
  return isSameCbu(defaults.defaultCbu, cbu) ? defaults.defaultCbuAlias : undefined;
}

type BillingVoucherConfig = Pick<
  ArcliConfig,
  'aliasCbu' | 'alicuotaPorDefecto' | 'cbu' | 'cotizacionPorDefecto' | 'monedaPorDefecto'
>;

/** La parte de `billingDefaultsFromConfig` que usa el asistente: alícuota, CBU, alias y moneda. */
export function billingVoucherDefaults(config: BillingVoucherConfig) {
  return {
    defaultCbu: config.cbu,
    defaultCbuAlias: config.aliasCbu,
    defaultCurrencyCode: config.monedaPorDefecto,
    // `conf` guarda el default 1 en el archivo: 1 es lo mismo que no tenerla, y en moneda extranjera no es valida.
    defaultExchangeRate:
      config.cotizacionPorDefecto === DEFAULT_EXCHANGE_RATE ? undefined : config.cotizacionPorDefecto,
    defaultIvaRate: config.alicuotaPorDefecto,
  } satisfies BillingDefaults;
}

/** Los defaults de la config que completan lo que no viene por flags ni por JSON. */
export function billingDefaultsFromConfig(config: ArcliConfig): BillingDefaults {
  return {
    ...billingVoucherDefaults(config),
    defaultConcept: config.conceptoPorDefecto,
    defaultEmit: config.output.emitirPorDefecto,
    defaultIvaCondition: config.ivaReceptorPorDefecto,
    defaultPointOfSale: config.puntoVentaPorDefecto,
    emitterCuit: config.cuit === undefined ? undefined : Number(config.cuit),
    lookupIvaConditionInPadron: isPadronLookupEnabled(config),
  };
}
