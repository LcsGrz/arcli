import type { ArcliEnvironment } from '../../modules/config/config.schemas';
import type { ServerStatus } from '../../modules/parameters/parameters';

import { type DummyHttpClient, fetchDummyStatus } from './cancellable-dummy';

const WSDL: Record<ArcliEnvironment, string> = { produccion: 'wsfe-production.wsdl', testing: 'wsfe.wsdl' };

/** `FEDummy`, el mismo de `ArcaParametersGateway.getServerStatus`, pero que se puede cancelar. */
export async function fetchWsfeServerStatus(
  environment: ArcliEnvironment,
  signal: AbortSignal,
  httpClient?: DummyHttpClient,
): Promise<ServerStatus> {
  return fetchDummyStatus({ environment, httpClient, operation: 'FEDummy', signal, wsdl: WSDL[environment] });
}
