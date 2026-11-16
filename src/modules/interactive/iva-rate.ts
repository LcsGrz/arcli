import { DEFAULT_IVA_RATE } from '../billing/billing.amounts';
import type { BillingIvaRate } from '../billing/billing.schemas';
import type { ArcliConfig } from '../config/config.schemas';

type IvaRateConfig = Pick<ArcliConfig, 'alicuotaPorDefecto'>;

/**
 * La alicuota que va si no se elige otra, como el CLI sin `--alicuota`: la deducida del comprobante original (al
 * repetirlo o en una nota sobre el), si hay; si no, la de la config o 21%.
 */
export function defaultIvaRate(config: IvaRateConfig, deduced?: BillingIvaRate): BillingIvaRate {
  return deduced ?? config.alicuotaPorDefecto ?? DEFAULT_IVA_RATE;
}

/**
 * La alicuota para la entrada del CLI. 21% sin alicuota configurada es el default del CLI y no se escribe; con una en
 * la config, va explicita para que el comando equivalente no tome la de la config.
 */
export function explicitIvaRate(
  ivaRate: BillingIvaRate | undefined,
  config: IvaRateConfig,
): BillingIvaRate | undefined {
  return ivaRate === DEFAULT_IVA_RATE && !config.alicuotaPorDefecto ? undefined : ivaRate;
}
