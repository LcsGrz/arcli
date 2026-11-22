import { formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { resolveBillingCurrencyCode } from '../../modules/billing/billing.mappers';
import type { ArcliConfig } from '../../modules/config/config.schemas';
import {
  resolveExportQuotation,
  resolveExportQuotationDate,
  resolveExportVoucherDate,
} from '../../modules/export/export.mappers';
import type { ExportGateway, ExportType } from '../../modules/export/export.types';
import { configExchangeRateFor, type ExchangeRateSuggestion } from '../../modules/interactive/billing-optionals';
import { startSpinner } from '../spinner';

import type { InteractiveSession } from './session';

/** De que moneda y, con `--misma-moneda`, de que fecha (la 10038 pide la del dia habil anterior a una pasada). */
interface OfficialExchangeRateQuery {
  readonly billingDate?: string;
  readonly currencyCode: string;
  readonly sameCurrency?: boolean;
}

export interface OfficialExchangeRate {
  (query: OfficialExchangeRateQuery): Promise<number | undefined>;
  /** La ya consultada, sin consultar: `undefined` si todavia no se consulto, si la consulta sigue o si fallo. */
  readonly known: (query: OfficialExchangeRateQuery) => number | undefined;
}

/**
 * Una consulta de cotizacion por clave en el flujo, con su spinner: la segunda vez sale de lo ya consultado. Si falla
 * (sin red, ARCA caido), `undefined` y no se reintenta.
 */
function cachedRateLoader<Q>(
  keyOf: (query: Q) => string,
  quote: (query: Q) => Promise<number | undefined>,
): ((query: Q) => Promise<number | undefined>) & { readonly known: (query: Q) => number | undefined } {
  const loaded = new Map<string, Promise<number | undefined>>();
  const resolved = new Map<string, number | undefined>();

  const load = (query: Q) => {
    const key = keyOf(query);
    const cached = loaded.get(key);

    if (cached) {
      return cached;
    }

    const rate = (async () => {
      const spinner = startSpinner('Consultando la cotización oficial...');

      try {
        const quoted = await quote(query);

        resolved.set(key, quoted);

        return quoted;
      } catch {
        return undefined;
      } finally {
        spinner?.stop();
      }
    })();

    loaded.set(key, rate);

    return rate;
  };

  return Object.assign(load, { known: (query: Q) => resolved.get(keyOf(query)) });
}

/**
 * La cotizacion oficial de ARCA, como la consulta el CLI sin `--cm` (`resolveExchangeRate`), una vez por moneda (y
 * fecha, con `--misma-moneda`) en el flujo: la pregunta de la cotizacion y el tope del consumidor final ven la misma. Si
 * la consulta falla (sin red, ARCA caido), `undefined` y no se reintenta: la pregunta arranca vacia y la vista previa
 * vuelve a intentar.
 */
export function officialExchangeRateLoader(
  session: Pick<InteractiveSession, 'billingGateway' | 'service'>,
): OfficialExchangeRate {
  return cachedRateLoader<OfficialExchangeRateQuery>(
    (query) =>
      query.sameCurrency ? `${query.currencyCode}|misma-moneda|${query.billingDate ?? ''}` : query.currencyCode,
    async (query) =>
      (
        await session.service.resolveExchangeRate(
          {
            billingDate: query.billingDate,
            currencyCode: query.currencyCode,
            exchangeRate: undefined,
            sameCurrency: query.sameCurrency ?? false,
          },
          session.billingGateway,
        )
      ).exchangeRate,
  );
}

/** De que E es la cotizacion: la fecha de la consulta sale de estos datos, como en `ExportService`. */
export interface ExportExchangeRateQuery {
  readonly currencyCode: string;
  readonly exportType: ExportType;
  readonly sameCurrency?: boolean;
  /** La fecha del comprobante (dd/mm/aaaa), si ya se eligio; si no, hoy. */
  readonly voucherDate?: string;
}

/**
 * La cotizacion de aduana que toma `arcli fe` sin `--cotizacion-moneda`: la de WSFEX (`FEXGetPARAM_MON_CON_COTIZACION`)
 * del dia que pide ARCA (`resolveExportQuotationDate`), una vez por moneda y dia en el flujo, como sugerencia de la
 * pregunta. Si falla o ARCA no la informa, `undefined`: la pregunta arranca vacia y la vista previa vuelve a intentar.
 */
export function exportExchangeRateLoader(
  gateway: Pick<ExportGateway, 'getQuotations'>,
): (query: ExportExchangeRateQuery) => Promise<ExchangeRateSuggestion | undefined> {
  const dateOf = (query: ExportExchangeRateQuery) => {
    const now = new Date();

    return resolveExportQuotationDate({
      exportType: query.exportType,
      isNote: false,
      sameCurrency: query.sameCurrency ?? false,
      today: formatDateAsArcaDate(now),
      voucherDate: resolveExportVoucherDate(query.voucherDate, now),
    }).date;
  };
  const codeOf = (query: ExportExchangeRateQuery) => resolveBillingCurrencyCode(query.currencyCode);

  const load = cachedRateLoader<ExportExchangeRateQuery>(
    (query) => `${codeOf(query)}|${dateOf(query)}`,
    async (query) => {
      const date = dateOf(query);

      return resolveExportQuotation(codeOf(query), await gateway.getQuotations(date), date).rate;
    },
  );

  return async (query) => {
    const rate = await load(query);

    return rate === undefined ? undefined : { rate, source: 'arca' };
  };
}

/**
 * Con que cotizacion arranca escrita la pregunta si te pagan en pesos: la de la config (`cotizacion`, deprecada) si el
 * CLI la tomaria sin `--cm`, y si no, la oficial de ARCA. Asi, sin tocarla, el comando equivalente sin `--cm` emite lo
 * mismo que el asistente.
 */
export function exchangeRateSuggestionLoader(
  config: Pick<ArcliConfig, 'cotizacionPorDefecto' | 'monedaPorDefecto'>,
  official: (query: OfficialExchangeRateQuery) => Promise<number | undefined>,
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
