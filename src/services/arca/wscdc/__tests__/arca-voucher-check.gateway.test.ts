import { describe, expect, it } from 'vitest';

import { AppError } from '../../../../lib/errors/app-error';
import { summarizeError } from '../../../../lib/errors/error-summary';
import type { VoucherCheckRequest } from '../../../../modules/voucher-check/voucher-check';
import { readConstatarAnswer, toCmpReq } from '../arca-voucher-check.gateway';

const REQUEST: VoucherCheckRequest = {
  authorizationCode: '76463926585341',
  date: '20261110',
  issuerCuit: '30709965812',
  mode: 'CAE',
  number: 1234,
  pointOfSale: 3,
  receiver: { documentNumber: '20111111112', documentType: 80 },
  shortcut: 'fa',
  total: 12100,
  voucherType: 1,
};

function failure(result: unknown): unknown {
  try {
    readConstatarAnswer(result, REQUEST);
  } catch (error) {
    return error;
  }

  throw new Error('se esperaba un error');
}

describe('toCmpReq', () => {
  it('va en el orden de CmpDatos del WSDL: es una sequence y node-soap escribe en el orden del objeto', () => {
    expect(Object.keys(toCmpReq(REQUEST))).toEqual([
      'CbteModo',
      'CuitEmisor',
      'PtoVta',
      'CbteTipo',
      'CbteNro',
      'CbteFch',
      'ImpTotal',
      'CodAutorizacion',
      'DocTipoReceptor',
      'DocNroReceptor',
    ]);
  });

  it('sin receptor no manda ni el tipo ni el número de documento', () => {
    expect(toCmpReq({ ...REQUEST, receiver: null })).not.toHaveProperty('DocTipoReceptor');
    expect(toCmpReq({ ...REQUEST, receiver: null })).not.toHaveProperty('DocNroReceptor');
  });
});

describe('readConstatarAnswer', () => {
  it('lee una observación sola, que node-soap no devuelve como lista', () => {
    expect(
      readConstatarAnswer({ Observaciones: { Obs: { Code: '100', Msg: 'No existe.' } }, Resultado: 'R' }, REQUEST),
    ).toMatchObject({ observations: [{ code: 100, message: 'No existe.' }], processedAt: null, result: 'R' });
  });

  it.each([undefined, null, '', {}])(
    'sin respuesta (%j): ARCA_VOUCHER_CHECK_ERROR, nunca un "no constatado"',
    (result) => {
      expect(failure(result)).toMatchObject({ code: 'ARCA_VOUCHER_CHECK_ERROR' });
    },
  );

  it('un Resultado que no es A ni R: ARCA_VOUCHER_CHECK_ERROR', () => {
    expect(failure({ Resultado: 'X' })).toMatchObject({ code: 'ARCA_VOUCHER_CHECK_ERROR' });
  });

  it('el 502 es pasajero aunque ARCA no escriba "Transacción Activa"', () => {
    const error = failure({ Errors: { Err: { Code: 502, Msg: 'Error interno de base de datos' } } });

    expect(error).not.toBeInstanceOf(AppError);
    expect(summarizeError(error)).toMatchObject({ code: 'TRANSIENT_ERROR' });
  });

  it('el 602 (CUIT no activa) no se arregla autorizando: ARCA_VOUCHER_CHECK_ERROR con detalles.errores', () => {
    expect(failure({ Errors: { Err: [{ Code: 602, Msg: 'CUIT no activa.' }] } })).toMatchObject({
      code: 'ARCA_VOUCHER_CHECK_ERROR',
      details: { errores: [{ codigo: 602, mensaje: 'CUIT no activa.' }] },
    });
  });

  it('un constatado con errores los conserva en errors', () => {
    expect(
      readConstatarAnswer({ Errors: { Err: [{ Code: 1, Msg: 'Aviso.' }] }, Resultado: 'A' }, REQUEST),
    ).toMatchObject({ errors: [{ code: 1, message: 'Aviso.' }], result: 'A' });
  });
});
