import type { ExportGateway } from './export.gateway';

/**
 * Una consulta que se hace una vez: los pedidos simultaneos la comparten y los siguientes toman su respuesta. Un error no
 * se guarda: el pedido siguiente vuelve a consultar.
 */
function once<T>(query: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;

  return () => {
    pending ??= query().catch((error: unknown) => {
      pending = undefined;

      throw error;
    });

    return pending;
  };
}

/**
 * El gateway con las tablas de WSFEX en memoria, para una corrida o un comprobante. Solo las tablas: la cotizacion, los
 * numeros, los comprobantes y los permisos se consultan siempre, y `authorize` pasa tal cual.
 */
export function cacheExportTables(gateway: ExportGateway): ExportGateway {
  return {
    authorize: (payload) => gateway.authorize(payload),
    checkPermit: (permit, destinationCountry) => gateway.checkPermit(permit, destinationCountry),
    getActivities: once(() => gateway.getActivities()),
    getCurrencies: once(() => gateway.getCurrencies()),
    getDestinationCountries: once(() => gateway.getDestinationCountries()),
    getDestinationCountryCuits: once(() => gateway.getDestinationCountryCuits()),
    getIncoterms: once(() => gateway.getIncoterms()),
    getLanguages: once(() => gateway.getLanguages()),
    getLastRequestId: () => gateway.getLastRequestId(),
    getLastVoucherNumber: (arcaType, pointOfSale, purpose) =>
      gateway.getLastVoucherNumber(arcaType, pointOfSale, purpose),
    getQuotations: (arcaDate) => gateway.getQuotations(arcaDate),
    getUnits: once(() => gateway.getUnits()),
    getVoucher: (query) => gateway.getVoucher(query),
  };
}
