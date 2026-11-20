import { startSpinner } from '../spinner';

import type { InteractiveSession } from './session';

/**
 * La cotizacion oficial de ARCA de cada moneda, como la consulta el CLI sin `--cm` (`resolveExchangeRate`), una vez
 * por moneda en el flujo. Si la consulta falla (sin red, ARCA caido), `undefined`: la pregunta arranca vacia y la vista
 * previa vuelve a intentar.
 */
export function officialExchangeRateLoader(
  session: Pick<InteractiveSession, 'billingGateway' | 'service'>,
): (currencyCode: string) => Promise<number | undefined> {
  const loaded = new Map<string, Promise<number | undefined>>();

  return (currencyCode) => {
    const cached = loaded.get(currencyCode);

    if (cached) {
      return cached;
    }

    const rate = (async () => {
      const spinner = startSpinner('Consultando la cotización oficial...');

      try {
        const resolved = await session.service.resolveExchangeRate(
          { currencyCode, exchangeRate: undefined, sameCurrency: false },
          session.billingGateway,
        );

        return resolved.exchangeRate;
      } catch {
        return undefined;
      } finally {
        spinner?.stop();
      }
    })();

    loaded.set(currencyCode, rate);

    return rate;
  };
}
