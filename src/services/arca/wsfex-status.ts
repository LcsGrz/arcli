import { SoapClient } from '@arcasdk/core';

import type { ArcliEnvironment } from '../../modules/config/config.schemas';
import type { ServerStatus } from '../../modules/parameters/parameters';

/** Los WSDL de WSFEX que trae el SDK. Cada uno tiene la direccion de su entorno. */
const WSDL: Record<ArcliEnvironment, string> = { produccion: 'wsfex-production.wsdl', testing: 'wsfex.wsdl' };

type SoapOptions = NonNullable<Parameters<SoapClient['createClient']>[1]>;

interface DummyClient {
  FEXDummyAsync(
    params: object,
    options: { readonly signal: AbortSignal },
  ): Promise<
    readonly [
      {
        readonly FEXDummyResult: { readonly AppServer: string; readonly AuthServer: string; readonly DbServer: string };
      },
    ]
  >;
}

/**
 * `FEXDummy`, que no autentica: vale sin certificado de exportacion. Con el cliente SOAP del SDK y no con
 * `wsfexService.dummy`, que no se puede cancelar: un WSFEX colgado dejaria el proceso vivo despues de la salida.
 */
export async function fetchWsfexServerStatus(
  environment: ArcliEnvironment,
  signal: AbortSignal,
  httpClient?: SoapOptions['httpClient'],
): Promise<ServerStatus> {
  const options: SoapOptions = {
    forceSoap12Headers: true,
    ...(httpClient ? { httpClient } : {}),
  };
  const client = (await new SoapClient().createClient(WSDL[environment], options)) as unknown as DummyClient;

  // Armar el cliente lleva un rato: si en el medio se cancelo, no se consulta.
  signal.throwIfAborted();

  const [{ FEXDummyResult: status }] = await client.FEXDummyAsync({}, { signal });

  return { app: status.AppServer, auth: status.AuthServer, db: status.DbServer };
}
