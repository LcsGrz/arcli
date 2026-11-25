import { describe, expect, it } from 'vitest';

import { resolveExportCurrency } from '../export.currency';
import { EXPORT_CREDIT_NOTE_KIND, EXPORT_VOUCHER_KIND } from '../export.kinds';
import { buildExportPayload } from '../export.payload';

describe('buildExportPayload', () => {
  const resolution = {
    activity: 620900,
    clientCountryCuit: 50000000016,
    currency: { CanMisMonExt: 'N' as const, Moneda_ctz: 900.5, Moneda_Id: 'DOL' },
    destinationCountry: { code: 203, name: 'Brasil' },
    exportType: 1 as const,
    incoterm: { code: 'FOB', name: 'Free on Board' },
    items: [
      {
        Pro_bonificacion: 0,
        Pro_codigo: '001',
        Pro_ds: 'Servicio',
        Pro_precio_uni: 1000,
        Pro_qty: 1,
        Pro_total_item: 1000,
        Pro_umed: 7,
      },
    ],
    languageId: 1,
    paymentDate: '20260601',
    pointOfSale: 3,
    requestId: 7,
    voucherDate: '20260601',
    voucherKind: EXPORT_VOUCHER_KIND,
    voucherNumber: 12,
  };

  const input = {
    amount: 1000,
    clientAddress: 'Av. Paulista 1000',
    clientName: 'ACME LLC',
    clientTaxId: '123456789',
    emit: true,
  };

  it('arma el Cmp de WSFEX con los mismos nombres que ARCA', () => {
    const payload = buildExportPayload(input, resolution);

    expect(payload).toEqual({
      Actividades: { Actividad: [{ Id: 620900 }] },
      CanMisMonExt: 'N',
      Cbte_nro: 12,
      Cbte_Tipo: 19,
      Cliente: 'ACME LLC',
      Cuit_pais_cliente: 50000000016,
      Domicilio_cliente: 'Av. Paulista 1000',
      Dst_cmp: 203,
      Fecha_cbte: '20260601',
      Forma_pago: 'Transferencia Internacional',
      Id: 7,
      Id_impositivo: '123456789',
      Idioma_cbte: 1,
      Imp_total: 1000,
      Incoterms: 'FOB',
      Incoterms_Ds: 'Free on Board',
      Items: { Item: resolution.items },
      Moneda_ctz: 900.5,
      Moneda_Id: 'DOL',
      Obs: '',
      Obs_comerciales: '',
      Permiso_existente: 'N',
      Punto_vta: 3,
      Tipo_expo: 1,
    });
    // Con Permiso_existente = N, ARCA rechaza el campo Permisos (error 1720).
    expect(payload).not.toHaveProperty('Permisos');
    // Los bloques vacios tambien se rechazan: Cmps_asoc da 1820 y Opcionales no se informa.
    expect(payload).not.toHaveProperty('Cmps_asoc');
    expect(payload).not.toHaveProperty('Opcionales');
  });

  it('sin CUIT del pais no manda Cuit_pais_cliente y va con el ID impositivo (error 1580)', () => {
    const payload = buildExportPayload(input, { ...resolution, clientCountryCuit: undefined });

    expect(payload).not.toHaveProperty('Cuit_pais_cliente');
    expect(payload.Id_impositivo).toBe('123456789');
  });

  it('la factura en pesos no manda CanMisMonExt, que ARCA rechaza en produccion (error 1605)', () => {
    const payload = buildExportPayload(input, {
      ...resolution,
      currency: resolveExportCurrency({ currencyCode: 'PES' }).fields,
    });

    expect(payload).not.toHaveProperty('CanMisMonExt');
    expect(payload).toMatchObject({ Moneda_ctz: 1, Moneda_Id: 'PES' });
  });

  it('en bienes no manda Fecha_pago, que ARCA rechaza (error 1673)', () => {
    expect(buildExportPayload(input, resolution)).not.toHaveProperty('Fecha_pago');
  });

  it('en servicios y otros manda Fecha_pago', () => {
    expect(buildExportPayload(input, { ...resolution, exportType: 2 }).Fecha_pago).toBe('20260601');
    expect(buildExportPayload(input, { ...resolution, exportType: 4 }).Fecha_pago).toBe('20260601');
  });

  it('respeta la forma de pago que informa el usuario', () => {
    expect(buildExportPayload({ ...input, paymentTerms: ' Carta de credito ' }, resolution).Forma_pago).toBe(
      'Carta de credito',
    );
  });

  it('informa los permisos de embarque, sin repetirlos', () => {
    const payload = buildExportPayload({ ...input, permits: ['P1', 'P1'], permitsExisting: true }, resolution);

    expect(payload.Permiso_existente).toBe('S');
    expect(payload.Permisos?.Permiso).toEqual([{ Dst_merc: 203, Id_permiso: 'P1' }]);
  });

  it('en servicios y otros deja vacio Permiso_existente, como pide ARCA (error 1550)', () => {
    const servicios = buildExportPayload(input, { ...resolution, exportType: 2 });
    const otros = buildExportPayload(input, { ...resolution, exportType: 4 });

    expect(servicios.Permiso_existente).toBe('');
    expect(otros.Permiso_existente).toBe('');
    expect(servicios).not.toHaveProperty('Permisos');
  });

  it('rechaza permisos de embarque en servicios y otros, donde ARCA no los admite', () => {
    expect(() =>
      buildExportPayload({ ...input, permits: ['P1'], permitsExisting: true }, { ...resolution, exportType: 2 }),
    ).toThrow(/no lleva permisos de embarque/);
  });

  it('en una nota de bienes informa los permisos con Permiso_existente vacio (tabla de la 1720)', () => {
    const note = {
      ...resolution,
      associatedVoucher: { Cbte_cuit: 20111111112, Cbte_nro: 1, Cbte_punto_vta: 4, Cbte_tipo: 19 },
      voucherKind: EXPORT_CREDIT_NOTE_KIND,
    };
    const payload = buildExportPayload({ ...input, permits: ['P1', 'P1'] }, note);

    expect(payload.Permiso_existente).toBe('');
    expect(payload.Permisos?.Permiso).toEqual([{ Dst_merc: 203, Id_permiso: 'P1' }]);
    expect(buildExportPayload(input, note)).not.toHaveProperty('Permisos');
    expect(() => buildExportPayload({ ...input, permits: ['P1'] }, { ...note, exportType: 2 })).toThrow(
      /no lleva permisos de embarque/,
    );
  });

  it('pide el flag de permiso existente cuando hay permisos', () => {
    expect(() => buildExportPayload({ ...input, permits: ['P1'] }, resolution)).toThrow(/--permiso-existente/);
  });

  it('pide los datos del cliente antes de emitir', () => {
    expect(() => buildExportPayload({ ...input, clientName: ' ' }, resolution)).toThrow(/--cliente/);
    expect(() => buildExportPayload({ ...input, clientAddress: undefined }, resolution)).toThrow(/--domicilio-cliente/);
    expect(() => buildExportPayload({ ...input, amount: undefined }, resolution)).toThrow(/--monto/);
  });

  it('rechaza un monto 0 o negativo (TEST-16)', () => {
    expect(() => buildExportPayload({ ...input, amount: 0 }, resolution)).toThrow(/--monto/);
    expect(() => buildExportPayload({ ...input, amount: -10 }, resolution)).toThrow(/--monto/);
  });

  it('--permiso-existente sin permisos es un error (TEST-16)', () => {
    expect(() => buildExportPayload({ ...input, permitsExisting: true }, resolution)).toThrow(/al menos un permiso/);
    expect(() => buildExportPayload({ ...input, permits: [' '], permitsExisting: true }, resolution)).toThrow(
      /al menos un permiso/,
    );
  });

  it('la nota de servicios pide el asociado (error 2047); la de bienes no (TEST-16)', () => {
    const note = { ...resolution, voucherKind: EXPORT_CREDIT_NOTE_KIND };

    expect(() => buildExportPayload(input, { ...note, exportType: 2 })).toThrow(/error 2047/);
    expect(() => buildExportPayload(input, note)).not.toThrow();
  });
});
