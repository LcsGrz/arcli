import { Arca } from '@arcasdk/core';
import { describe, expect, it } from 'vitest';

import { EmissionUncertainError } from '../../../modules/billing/billing.errors';

/**
 * Lo que hace el SDK real con una respuesta rara a la llamada que emite (ERR-16): de acá salen los dobles de
 * `json-golden.test.ts`. El cliente SOAP es falso; no hay red ni WSAA.
 */
const arca = () => new Arca({ cert: 'x', cuit: 20111111112, key: 'x', production: false });

const VOUCHER = {
  CantReg: 1,
  CbteDesde: 42,
  CbteFch: '20261117',
  CbteHasta: 42,
  CbteTipo: 11,
  Concepto: 1,
  CondicionIVAReceptorId: 5,
  DocNro: 0,
  DocTipo: 99,
  ImpIVA: 0,
  ImpNeto: 1000,
  ImpOpEx: 0,
  ImpTotal: 1000,
  ImpTotConc: 0,
  ImpTrib: 0,
  MonCotiz: 1,
  MonId: 'PES',
  PtoVta: 3,
} as never;

const DETAIL = { CAE: '76463926585341', CAEFchVto: '20261127', Resultado: 'A' };

async function emit(output: unknown): Promise<unknown> {
  const client = arca();

  Object.assign(
    (client.electronicBillingService as unknown as { electronicBillingRepository: object }).electronicBillingRepository,
    {
      getClient: async () => ({ FECAESolicitarAsync: async () => [output] }),
    },
  );

  return client.electronicBillingService.createVoucher(VOUCHER);
}

async function authorize(output: unknown): Promise<unknown> {
  const client = arca();

  Object.assign((client.wsfexService as unknown as { repository: object }).repository, {
    getClient: async () => ({ FEXAuthorizeAsync: async () => [output] }),
  });

  return client.wsfexService.authorize({} as never);
}

/** El SDK y node-soap de verdad, con el HTTP reemplazado: ARCA contesta `body`. */
async function respond(service: 'wsfe' | 'wsfex', body: string, status = 200): Promise<unknown> {
  const client = arca();
  const repository = (
    service === 'wsfe'
      ? (client.electronicBillingService as unknown as { electronicBillingRepository: object })
          .electronicBillingRepository
      : (client.wsfexService as unknown as { repository: object }).repository
  ) as {
    authRepository: object;
    soapClient: { createClient: (wsdl: string, options: object) => Promise<unknown> };
  };
  const createClient = repository.soapClient.createClient.bind(repository.soapClient);
  const httpClient = {
    request: (_url: string, _xml: string, callback: (error: null, response: object, body: string) => void) => {
      callback(null, { data: body, headers: {}, status, statusCode: status }, body);

      return {};
    },
  };

  repository.soapClient.createClient = (wsdl, options) => createClient(wsdl, { ...options, httpClient });
  Object.assign(repository.authRepository, {
    getAuthParams: () => ({ Auth: { Cuit: 1, Sign: 'firma', Token: 'token' } }),
    login: async () => ({}),
  });

  return service === 'wsfe'
    ? client.electronicBillingService.createVoucher(VOUCHER)
    : client.wsfexService.authorize({ Cmp: {} } as never);
}

const ENVELOPE = '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>';

describe.each(['wsfe', 'wsfex'] as const)('%s: lo que contesta ARCA no es SOAP', (service) => {
  /** La causa que se muestra, con el rechazo del SDK tal cual. */
  async function reasonOf(body: string, status?: number): Promise<unknown> {
    const cause: unknown = await respond(service, body, status).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    const error = new EmissionUncertainError({ cause, environment: 'testing', pointOfSale: 3, shortcut: 'fc' });

    expect(error.message).not.toContain('[object Object]');

    return error.details?.causa;
  }

  it.each([
    ['una página HTML mal cerrada', '<html><body><br>503</p>'],
    ['texto', 'Service Unavailable'],
    ['XML cortado', `${ENVELOPE}<FECAES`],
  ])('%s: XML inválido', async (_name, body) => {
    await expect(reasonOf(body)).resolves.toBe('hubo un error inesperado al emitir (Invalid XML)');
    await expect(reasonOf(body, 503)).resolves.toBe('hubo un error inesperado al emitir (Invalid XML)');
  });

  it('una página HTML bien cerrada: el mensaje de node-soap', async () => {
    await expect(reasonOf('<html><body>503</body></html>')).resolves.toBe('Cannot parse response');
  });

  it('un SOAP fault: su mensaje', async () => {
    const fault = '<soap:Fault><faultcode>soap:Server</faultcode><faultstring>Error</faultstring></soap:Fault>';

    await expect(reasonOf(`${ENVELOPE}${fault}</soap:Body></soap:Envelope>`)).resolves.toBe('soap:Server: Error');
  });
});

describe('el SDK ante una respuesta rara a la emisión', () => {
  it.each([
    ['sin cuerpo', undefined],
    ['nula', null],
    ['sin FECAESolicitarResult', {}],
  ])('FECAESolicitar %s: tira un TypeError adentro de la llamada', async (_name, output) => {
    await expect(emit(output)).rejects.toBeInstanceOf(TypeError);
  });

  it('con el detalle suelto, sin lista, pierde el CAE', async () => {
    const result = { FeDetResp: { FECAEDetResponse: DETAIL } };

    await expect(emit({ FECAESolicitarResult: result })).resolves.toEqual({ cae: '', caeFchVto: '', response: result });
  });

  it.each(['R', 'P', 'O', ''])(
    'con el resultado %j no devuelve el CAE, aunque esté en el detalle',
    async (Resultado) => {
      const result = { FeDetResp: { FECAEDetResponse: [{ ...DETAIL, Resultado }] } };

      await expect(emit({ FECAESolicitarResult: result })).resolves.toEqual({
        cae: '',
        caeFchVto: '',
        response: result,
      });
    },
  );

  it('con una lista, lo lee y deja pasar lo accesorio como vino', async () => {
    const result = {
      FeDetResp: { FECAEDetResponse: [{ ...DETAIL, Observaciones: { Obs: [null] } }] },
      Events: { Evt: { Code: 1 } },
    };

    await expect(emit({ FECAESolicitarResult: result })).resolves.toEqual({
      cae: DETAIL.CAE,
      caeFchVto: DETAIL.CAEFchVto,
      response: result,
    });
  });

  it.each([[undefined], [null], [{}]])('FEXAuthorize devuelve lo que vino, también %o', async (output) => {
    await expect(authorize(output)).resolves.toBe(output);
  });
});
