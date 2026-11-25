import { SoapClient } from '@arcasdk/core';

import type { ArcliEnvironment } from '../../modules/config/config.schemas';
import type { ServerStatus } from '../../modules/parameters/parameters';

import { avoidWeakDhe } from './tls';

type SoapOptions = NonNullable<Parameters<SoapClient['createClient']>[1]>;

/** Para los tests: node-soap y el WSDL de verdad, con el HTTP reemplazado. */
export type DummyHttpClient = SoapOptions['httpClient'];

interface DummyStatus {
  readonly AppServer: string;
  readonly AuthServer: string;
  readonly DbServer: string;
}

type DummyClient = Record<
  string,
  (params: object, options: { readonly signal: AbortSignal }) => Promise<readonly [Record<string, DummyStatus>]>
>;

/**
 * El `Dummy` de un servicio de facturacion, que no autentica. Con el cliente SOAP del SDK y no con sus servicios, que
 * no se pueden cancelar: un servidor colgado dejaria el proceso vivo despues de la salida.
 */
export async function fetchDummyStatus(options: {
  readonly environment: ArcliEnvironment;
  readonly httpClient?: DummyHttpClient;
  readonly operation: 'FEDummy' | 'FEXDummy';
  readonly signal: AbortSignal;
  /** El que trae el SDK. Cada uno tiene la direccion de su entorno. */
  readonly wsdl: string;
}): Promise<ServerStatus> {
  const { environment, httpClient, operation, signal, wsdl } = options;

  avoidWeakDhe(environment === 'produccion');

  const soapOptions: SoapOptions = { forceSoap12Headers: true, ...(httpClient ? { httpClient } : {}) };
  const client = (await new SoapClient().createClient(wsdl, soapOptions)) as unknown as DummyClient;

  // Armar el cliente lleva un rato: si en el medio se cancelo, no se consulta.
  signal.throwIfAborted();

  const [answer] = await client[`${operation}Async`]({}, { signal });
  const status = answer[`${operation}Result`];

  return { app: status.AppServer, auth: status.AuthServer, db: status.DbServer };
}
