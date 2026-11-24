import { Arca } from '@arcasdk/core';
import { describe, expect, it } from 'vitest';

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
