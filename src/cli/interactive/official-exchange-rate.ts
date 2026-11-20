import type { ArcliConfig } from '../../modules/config/config.schemas';
import { configExchangeRateFor, type ExchangeRateSuggestion } from '../../modules/interactive/billing-optionals';
import { startSpinner } from '../spinner';

import type { InteractiveSession } from './session';

/** De que moneda y, con `--misma-moneda`, de que fecha (la 10038 pide la del dia habil anterior a una pasada). */
interface OfficialExchangeRateQuery {
  readonly billingDate?: string;
  readonly currencyCode: string;
  readonly sameCurrency?: boolean;
}

export type OfficialExchangeRate = (query: OfficialExchangeRateQuery) => Promise<number | undefined>;

/**
 * La cotizacion oficial de ARCA, como la consulta el CLI sin `--cm` (`resolveExchangeRate`), una vez por moneda (y
 * fecha, con `--misma-moneda`) en el flujo: la pregunta de la cotizacion y el tope del consumidor final ven la misma. Si
 * la consulta falla (sin red, ARCA caido), `undefined` y no se reintenta: la pregunta arranca vacia y la vista previa
 * vuelve a intentar.
 */
export function officialExchangeRateLoader(
  session: Pick<InteractiveSession, 'billingGateway' | 'service'>,
): OfficialExchangeRate {
  const loaded = new Map<string, Promise<number | undefined>>();

  return (query) => {
    const sameCurrency = query.sameCurrency ?? false;
    const key = sameCurrency ? `${query.currencyCode}|misma-moneda|${query.billingDate ?? ''}` : query.currencyCode;
    const cached = loaded.get(key);

    if (cached) {
      return cached;
    }

    const rate = (async () => {
      const spinner = startSpinner('Consultando la cotización oficial...');

      try {
        const resolved = await session.service.resolveExchangeRate(
          { billingDate: query.billingDate, currencyCode: query.currencyCode, exchangeRate: undefined, sameCurrency },
          session.billingGateway,
        );

        return resolved.exchangeRate;
      } catch {
        return undefined;
      } finally {
        spinner?.stop();
      }
    })();

    loaded.set(key, rate);

    return rate;
  };
}

/**
 * Con que cotizacion arranca escrita la pregunta si te pagan en pesos: la de la config (`cotizacion`, deprecada) si el
 * CLI la tomaria sin `--cm`, y si no, la oficial de ARCA. Asi, sin tocarla, el comando equivalente sin `--cm` emite lo
 * mismo que el asistente.
 */
export function exchangeRateSuggestionLoader(
  config: Pick<ArcliConfig, 'cotizacionPorDefecto' | 'monedaPorDefecto'>,
  official: OfficialExchangeRate,
): (currencyCode: string) => Promise<ExchangeRateSuggestion | undefined> {
  return async (currencyCode) => {
    const configured = configExchangeRateFor(config, currencyCode);

    if (configured !== undefined) {
      return { rate: configured, source: 'config' };
    }

    const rate = await official({ currencyCode });

    return rate === undefined ? undefined : { rate, source: 'arca' };
  };
}
