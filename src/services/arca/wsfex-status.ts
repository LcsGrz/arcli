import type { ArcliEnvironment } from '../../modules/config/config.schemas';
import type { ServerStatus } from '../../modules/parameters/parameters';

import { type DummyHttpClient, fetchDummyStatus } from './cancellable-dummy';

const WSDL: Record<ArcliEnvironment, string> = { produccion: 'wsfex-production.wsdl', testing: 'wsfex.wsdl' };

/** `FEXDummy`, que no autentica: vale sin certificado de exportacion. */
export async function fetchWsfexServerStatus(
  environment: ArcliEnvironment,
  signal: AbortSignal,
  httpClient?: DummyHttpClient,
): Promise<ServerStatus> {
  return fetchDummyStatus({ environment, httpClient, operation: 'FEXDummy', signal, wsdl: WSDL[environment] });
}
