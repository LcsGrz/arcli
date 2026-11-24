import { describe, expect, it } from 'vitest';

import { mapBillingResponse } from '../../../modules/billing/billing-response';
import { mapExportResponse } from '../../../modules/export/export.response';
import { readBillingAnswer, readExportAnswer } from '../authorization-answer';

const CAE = '76463926585341';

/** Un objeto que falla al leer `key`. */
function throwing(key: string, rest: object): object {
  return Object.defineProperty({ ...rest }, key, {
    enumerable: true,
    get: () => {
      throw new Error('no se pudo leer');
    },
  });
}

/** El número que informó ARCA, el que va en el PDF. El resto de la respuesta se fija por el comando. */
describe('el número que informó ARCA', () => {
  const billing = (response: unknown) =>
    mapBillingResponse(readBillingAnswer({ cae: CAE, caeFchVto: '20261121', response } as never));
  const exportE = (FEXResultAuth: unknown) =>
    mapExportResponse(readExportAnswer({ FEXAuthorizeResult: { FEXResultAuth } } as never));

  it.each([
    ['en una lista', [{ CbteDesde: 125 }], 125],
    ['en cero', [{ CbteDesde: 0 }], 0],
    ['con el detalle suelto', { CbteDesde: 125 }, undefined],
    ['sin detalle', undefined, undefined],
    ['con un detalle nulo', [null], undefined],
  ])('A, B y C: %s', (_name, FECAEDetResponse, expected) => {
    expect(billing({ FeDetResp: { FECAEDetResponse } }).arcaNumber).toBe(expected);
  });

  it.each([
    ['suelta', { Cae: CAE, Cbte_nro: 12 }, 12],
    ['en una lista', [{ Cae: CAE, Cbte_nro: 12 }], undefined],
  ])('E: con la autorización %s', (_name, authorization, expected) => {
    expect(exportE(authorization).arcaNumber).toBe(expected);
  });

  // Es accesorio: si no se puede leer falla el PDF, no la emisión.
  it('uno que no se puede leer no cuesta el CAE', () => {
    expect(billing({ FeDetResp: { FECAEDetResponse: [throwing('CbteDesde', {})] } })).toHaveProperty('cae', CAE);
    expect(exportE(throwing('Cbte_nro', { Cae: CAE }))).toHaveProperty('cae', CAE);
  });
});

/** Leer un dato que no hace falta no puede hacer fallar una respuesta que se lee. */
describe('los datos que no hacen falta no se leen', () => {
  const approved = { cae: CAE, caeFchVto: '20261121' };
  const detail = { Resultado: 'A' };

  it.each([
    ['el CAE del detalle', [throwing('CAE', detail)], {}],
    ['el vencimiento del detalle', [throwing('CAEFchVto', detail)], {}],
    ['la cabecera', [detail], throwing('FeCabResp', {})],
  ])('A, B y C: %s, si el dato ya está', (_name, FECAEDetResponse, root) => {
    const response = Object.defineProperties(
      { FeDetResp: { FECAEDetResponse } },
      Object.getOwnPropertyDescriptors(root),
    );

    expect(mapBillingResponse(readBillingAnswer({ ...approved, response } as never))).toMatchObject({
      cae: CAE,
      caeVencimiento: '20261121',
      status: 'aprobado',
    });
  });

  it('E: el vencimiento de un rechazo', () => {
    const output = { FEXAuthorizeResult: { FEXResultAuth: throwing('Fch_venc_Cae', { Cae: '', Resultado: 'R' }) } };

    expect(mapExportResponse(readExportAnswer(output as never))).toMatchObject({ cae: null, status: 'rechazado' });
  });
});
