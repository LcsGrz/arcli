import type * as ArcaSdk from '@arcasdk/core';
import { vi } from 'vitest';

/** Lo que contesta el servidor, dado el XML que se le mando. */
export type SoapServer = (xml: string) => { readonly body: string; readonly status?: number };

interface SoapRepository {
  readonly authRepository: object;
  readonly soapClient: { createClient: (wsdl: string, options: object) => Promise<unknown> };
}

/** El SDK y node-soap de verdad, con el HTTP y WSAA reemplazados: sin red ni certificado. */
export async function createSoapArca(service: 'wsfe' | 'wsfex', server: SoapServer): Promise<ArcaSdk.Arca> {
  // El de verdad, aunque el test reemplace `@arcasdk/core`.
  const { Arca } = await vi.importActual<typeof ArcaSdk>('@arcasdk/core');
  const client = new Arca({ cert: 'x', cuit: 20111111112, key: 'x', production: false });
  const repository = (
    service === 'wsfe'
      ? (client.electronicBillingService as unknown as { electronicBillingRepository: object })
          .electronicBillingRepository
      : (client.wsfexService as unknown as { repository: object }).repository
  ) as SoapRepository;
  const createClient = repository.soapClient.createClient.bind(repository.soapClient);
  const httpClient = {
    request: (_url: string, xml: string, callback: (error: null, response: object, body: string) => void) => {
      const { body, status = 200 } = server(xml);

      callback(null, { data: body, headers: {}, status, statusCode: status }, body);

      return {};
    },
  };

  repository.soapClient.createClient = (wsdl, options) => createClient(wsdl, { ...options, httpClient });
  Object.assign(repository.authRepository, {
    getAuthParams: () => ({ Auth: { Cuit: 1, Sign: 'firma', Token: 'token' } }),
    login: async () => ({}),
  });

  return client;
}
