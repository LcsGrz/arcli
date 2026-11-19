import { describe, expect, it } from 'vitest';

import { type ReceiverFromPadron, receiverInputFields } from '../receiver-padron';

const FROM_PADRON: ReceiverFromPadron = {
  address: 'Av. Siempre Viva 742',
  cuit: 20111111112,
  ivaCondition: 'responsable-inscripto',
  name: 'Primera SA',
};

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
