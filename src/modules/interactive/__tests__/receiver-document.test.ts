import { describe, expect, it } from 'vitest';

import { CONSUMER_DOCUMENT_NUMBER } from '../../billing/arca-codes';
import { receiverDocumentNumber, type ReceiverFromPadron, receiverInputFields } from '../receiver-document';

const FROM_PADRON: ReceiverFromPadron = {
  address: 'Av. Siempre Viva 742',
  cuit: 20111111112,
  ivaCondition: 'responsable-inscripto',
  name: 'Primera SA',
};

describe('receiverDocumentNumber', () => {
  it('a consumidor final manda 0, como --cf, aunque el asistente no haya guardado numero', () => {
    expect(CONSUMER_DOCUMENT_NUMBER).toBe(0);
    expect(receiverDocumentNumber({ documentType: 'consumidor-final' })).toBe(0);
    expect(receiverDocumentNumber({ documentNumber: undefined, documentType: 'consumidor-final' })).toBe(0);
  });

  it('a consumidor final ignora un numero que haya quedado de otro receptor', () => {
    expect(receiverDocumentNumber({ documentNumber: 30709965812, documentType: 'consumidor-final' })).toBe(0);
  });

  it('en CUIT, CUIL y DNI deja el numero cargado', () => {
    expect(receiverDocumentNumber({ documentNumber: 30709965812, documentType: 'cuit' })).toBe(30709965812);
    expect(receiverDocumentNumber({ documentNumber: 20123456786, documentType: 'cuil' })).toBe(20123456786);
    expect(receiverDocumentNumber({ documentNumber: 543210, documentType: 'dni' })).toBe(543210);
  });
});

// Lo que el padron dijo de un CUIT solo va al comprobante si el documento sigue siendo ese CUIT (TEST-21).
describe('receiverInputFields', () => {
  it('con el mismo CUIT usa el nombre, el domicilio y el origen del padrón', () => {
    expect(
      receiverInputFields({
        documentNumber: FROM_PADRON.cuit,
        documentType: 'cuit',
        ivaCondition: 'responsable-inscripto',
        receiver: FROM_PADRON,
      }),
    ).toEqual({ ivaConditionSource: 'padron', receiverAddress: FROM_PADRON.address, receiverName: FROM_PADRON.name });
  });

  it('si después se cambió el CUIT, no arrastra los datos del anterior', () => {
    expect(
      receiverInputFields({
        documentNumber: 27222222223,
        documentType: 'cuit',
        ivaCondition: 'responsable-inscripto',
        receiver: FROM_PADRON,
      }),
    ).toEqual({ ivaConditionSource: undefined, receiverAddress: undefined, receiverName: undefined });
  });

  it('si después se pasó a DNI, tampoco, aunque el número coincida', () => {
    expect(
      receiverInputFields({
        documentNumber: FROM_PADRON.cuit,
        documentType: 'dni',
        ivaCondition: 'consumidor-final',
        receiver: FROM_PADRON,
      }),
    ).toEqual({ ivaConditionSource: undefined, receiverAddress: undefined, receiverName: undefined });
  });

  it('con el mismo CUIT y otra condición elegida a mano, el origen no es el padrón', () => {
    expect(
      receiverInputFields({
        documentNumber: FROM_PADRON.cuit,
        documentType: 'cuit',
        ivaCondition: 'responsable-monotributo',
        receiver: FROM_PADRON,
      }).ivaConditionSource,
    ).toBeUndefined();
  });
});
