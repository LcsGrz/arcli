import { describe, expect, it } from 'vitest';

import { CONSUMER_DOCUMENT_NUMBER, receiverDocumentNumber } from '../receiver-document';

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
