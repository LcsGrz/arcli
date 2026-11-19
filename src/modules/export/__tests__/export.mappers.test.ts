import { describe, expect, it } from 'vitest';

import {
  assertExportClientIdentification,
  assertExportIncoterm,
  assertExportTextLengths,
  assertExportVoucherDate,
  buildExportPayload,
  resolveExportActivity,
  resolveExportClientCountryCuit,
  resolveExportCurrency,
  resolveExportDestinationCountry,
  resolveExportIncoterm,
  resolveExportLanguage,
  resolveExportNumber,
  resolveExportPointOfSale,
  resolveExportQuotation,
  resolveExportQuotationDate,
  resolveExportType,
  resolveExportVoucherDate,
} from '../export.mappers';
import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
  type ExportCountry,
  type ExportCountryCuit,
} from '../export.types';

const COUNTRIES: readonly ExportCountry[] = [
  { code: 200, name: 'Argentina' },
  { code: 203, name: 'Brasil' },
  { code: 212, name: 'Chile' },
];

const COUNTRY_CUITS: readonly ExportCountryCuit[] = [
  { countryName: 'Brasil - Persona Física', cuit: 50000000059 },
  { countryName: 'Brasil - Otro tipo de Entidad', cuit: 51600000059 },
  { countryName: 'Brasil - Persona Jurídica', cuit: 55000000050 },
  { countryName: 'Chile - Persona Jurídica', cuit: 55000000052 },
  { countryName: 'ESTADOS UNIDOS - Persona Jurídica', cuit: 55000002126 },
  { countryName: 'CHINA REP.POPULAR - Persona Jurídica', cuit: 55000002916 },
];

describe('resolveExportVoucherDate', () => {
  it('usa la fecha argentina de hoy cuando no se indica', () => {
    expect(resolveExportVoucherDate(undefined, new Date('2026-06-01T15:00:00Z'))).toBe('20260601');
  });

  it('acepta la fecha del usuario', () => {
    expect(resolveExportVoucherDate('1/6/2026')).toBe('20260601');
  });
});

describe('resolveExportCurrency', () => {
  it('por defecto la exportacion va en dolares y pide la cotizacion a ARCA', () => {
    expect(resolveExportCurrency({})).toEqual({
      fields: { CanMisMonExt: 'N', Moneda_ctz: 0, Moneda_Id: 'DOL' },
      needsQuotation: true,
    });
  });

  it('en pesos la cotizacion es 1, no hay que consultar ARCA y no va CanMisMonExt (error 1605)', () => {
    expect(resolveExportCurrency({ currencyCode: 'ARS' })).toEqual({
      fields: { Moneda_ctz: 1, Moneda_Id: 'PES' },
      needsQuotation: false,
    });
  });

  it('acepta el alias USD y la cotizacion escrita por el usuario', () => {
    expect(resolveExportCurrency({ currencyCode: 'USD', exchangeRate: 900.5 })).toEqual({
      fields: { CanMisMonExt: 'N', Moneda_ctz: 900.5, Moneda_Id: 'DOL' },
      needsQuotation: false,
    });
  });

  it('pide la cotizacion a ARCA cuando es moneda extranjera y no vino', () => {
    expect(resolveExportCurrency({ currencyCode: 'DOL' }).needsQuotation).toBe(true);
  });

  it('no usa la clave cotizacion de la config: sin --cotizacion-moneda va la de aduana de ARCA (REV-35)', () => {
    expect(resolveExportCurrency({ currencyCode: 'DOL' })).toEqual({
      fields: { CanMisMonExt: 'N', Moneda_ctz: 0, Moneda_Id: 'DOL' },
      needsQuotation: true,
    });
  });

  it('no acepta cotizacion en pesos distinta de 1 ni misma moneda en pesos', () => {
    expect(() => resolveExportCurrency({ currencyCode: 'ARS', exchangeRate: 2 })).toThrow(/cotización tiene que ser 1/);
    expect(() => resolveExportCurrency({ currencyCode: 'ARS', sameCurrency: true })).toThrow(/moneda extranjera/);
  });

  it('acepta cotizaciones menores a 1, como la del guarani: ARCA pide mayor a 0 (errores 1600 y 1602)', () => {
    expect(resolveExportCurrency({ currencyCode: '029', exchangeRate: 0.19 })).toEqual({
      fields: { CanMisMonExt: 'N', Moneda_ctz: 0.19, Moneda_Id: '029' },
      needsQuotation: false,
    });
  });

  it('rechaza una cotizacion en 0 o negativa en moneda extranjera', () => {
    expect(() => resolveExportCurrency({ currencyCode: 'USD', exchangeRate: 0 })).toThrow(
      'La cotización de USD tiene que ser mayor a 0.',
    );
    expect(() => resolveExportCurrency({ currencyCode: '029', exchangeRate: -1 })).toThrow(/mayor a 0/);
  });

  it('marca CanMisMonExt cuando el pago es en la misma moneda', () => {
    expect(resolveExportCurrency({ currencyCode: 'USD', exchangeRate: 900, sameCurrency: true }).fields).toEqual({
      CanMisMonExt: 'S',
      Moneda_ctz: 900,
      Moneda_Id: 'DOL',
    });
  });
});

describe('resolveExportQuotationDate', () => {
  const base = { exportType: 2 as const, isNote: false, sameCurrency: false, today: '20261118' };

  it('en la factura de servicios es el dia anterior a la fecha del comprobante (error 2053)', () => {
    expect(resolveExportQuotationDate({ ...base, voucherDate: '20261116' })).toEqual({
      date: '20261115',
      rule: 'previous-business-day',
    });
  });

  it('con fecha posterior a la de la solicitud es el dia anterior a hoy', () => {
    expect(resolveExportQuotationDate({ ...base, voucherDate: '20261120' }).date).toBe('20261117');
  });

  it('con el pago en la misma moneda tambien es el dia anterior, en cualquier tipo', () => {
    expect(
      resolveExportQuotationDate({ ...base, exportType: 1, sameCurrency: true, voucherDate: '20261118' }).date,
    ).toBe('20261117');
  });

  it('en bienes, otros y las notas es la fecha del comprobante', () => {
    expect(resolveExportQuotationDate({ ...base, exportType: 1, voucherDate: '20261118' })).toEqual({
      date: '20261118',
      rule: 'voucher-date',
    });
    expect(resolveExportQuotationDate({ ...base, exportType: 4, voucherDate: '20261118' }).date).toBe('20261118');
    expect(resolveExportQuotationDate({ ...base, isNote: true, voucherDate: '20261118' }).date).toBe('20261118');
  });

  it('con fecha futura en bienes es la de hoy: no hay cotizacion de un dia que no llego', () => {
    expect(resolveExportQuotationDate({ ...base, exportType: 1, voucherDate: '20261121' }).date).toBe('20261118');
  });
});

describe('assertExportVoucherDate (ARCA 1500)', () => {
  const today = '20261118';

  it('acepta de hoy - 5 a hoy + 5', () => {
    for (const voucherDate of ['20261113', '20261118', '20261123']) {
      expect(() => assertExportVoucherDate({ exportType: 1, today, voucherDate })).not.toThrow();
    }
  });

  it('rechaza mas de 5 dias antes o despues, con el rango', () => {
    expect(() => assertExportVoucherDate({ exportType: 1, today, voucherDate: '20261112' })).toThrow(
      /del 13\/11\/2026 al 23\/11\/2026.*error 1500/,
    );
    expect(() => assertExportVoucherDate({ exportType: 4, today, voucherDate: '20261124' })).toThrow(/error 1500/);
  });

  it('en servicios no deja pasar el fin de mes', () => {
    expect(() => assertExportVoucherDate({ exportType: 2, today: '20261128', voucherDate: '20261130' })).not.toThrow();
    expect(() => assertExportVoucherDate({ exportType: 2, today: '20261128', voucherDate: '20261201' })).toThrow(
      /al 30\/11\/2026.*fin de mes/,
    );
    expect(() => assertExportVoucherDate({ exportType: 1, today: '20261128', voucherDate: '20261201' })).not.toThrow();
  });

  it('en servicios, si el fin de mes es el último día de la ventana, el tope es el de los 5 días (TEST-17)', () => {
    // El 25/11 la ventana termina el 30/11, que también es el fin de mes: el error no culpa al fin de mes.
    expect(() => assertExportVoucherDate({ exportType: 2, today: '20261125', voucherDate: '20261130' })).not.toThrow();
    expect(() => assertExportVoucherDate({ exportType: 2, today: '20261125', voucherDate: '20261201' })).toThrow(
      /al 30\/11\/2026, hasta 5 días antes o después de hoy \(error 1500\)/,
    );
  });
});

describe('resolveExportType', () => {
  it('por defecto es exportacion de servicios', () => {
    expect(resolveExportType(undefined)).toBe(2);
  });

  it('respeta el tipo indicado por el usuario', () => {
    expect(resolveExportType(1)).toBe(1);
    expect(resolveExportType(4)).toBe(4);
  });

  it('rechaza un tipo que ARCA no tiene', () => {
    expect(() => resolveExportType(3 as never)).toThrow(/--tipo-expo/);
  });
});

describe('resolveExportQuotation', () => {
  const QUOTATIONS = [
    { code: 'DOL', date: '20261027', rate: 1174 },
    { code: '060', date: '20261027', rate: 1300.5 },
  ];

  it('encuentra la moneda sin importar mayusculas ni espacios', () => {
    expect(resolveExportQuotation(' dol ', QUOTATIONS, '20261028')).toEqual(QUOTATIONS[0]);
  });

  it('falla con las monedas que si tienen cotizacion', () => {
    expect(() => resolveExportQuotation('019', QUOTATIONS, '20261028')).toThrow(
      /no informó la cotización de 019 para el 28\/10\/2026\. Las monedas con cotización son DOL, 060\./,
    );
  });

  it('sin cotizacion para la moneda es ARCA_QUOTATION_ERROR, sin detalles de ARCA', () => {
    expect(() => resolveExportQuotation('019', QUOTATIONS, '20261028')).toThrow(
      expect.objectContaining({ code: 'ARCA_QUOTATION_ERROR', details: undefined }),
    );
  });

  it('pide la cotizacion por flag cuando ARCA no publico ninguna', () => {
    expect(() => resolveExportQuotation('DOL', [], '20270105')).toThrow(
      /no informó la cotización de DOL para el 05\/01\/2027\. Informá la cotización con --cotizacion-moneda\./,
    );
  });
});

describe('resolveExportDestinationCountry', () => {
  it('busca por codigo y por nombre', () => {
    expect(resolveExportDestinationCountry('203', COUNTRIES)).toEqual({ code: 203, name: 'Brasil' });
    expect(resolveExportDestinationCountry(' brasil ', COUNTRIES)).toEqual({ code: 203, name: 'Brasil' });
  });

  it('rechaza Argentina: no es un destino de exportacion', () => {
    expect(() => resolveExportDestinationCountry('Argentina', COUNTRIES)).toThrow(/no es un destino de exportación/);
  });

  it('rechaza un pais que no esta en la tabla', () => {
    expect(() => resolveExportDestinationCountry('Marte', COUNTRIES)).toThrow(/no existe en la tabla/);
  });
});

describe('assertExportClientIdentification', () => {
  const country = { code: 415, name: 'IRLANDA' };

  it('alcanza con el CUIT del pais o con el ID impositivo', () => {
    expect(() => assertExportClientIdentification({ clientCountryCuit: 55000000050, country })).not.toThrow();
    expect(() => assertExportClientIdentification({ clientTaxId: 'IE1234567T', country })).not.toThrow();
  });

  it('sin ninguno de los dos pide uno, como ARCA (error 1580)', () => {
    expect(() => assertExportClientIdentification({ clientTaxId: '  ', country })).toThrow(
      'La tabla de ARCA no tiene CUIT para "IRLANDA" y ARCA pide el CUIT del país o el ID impositivo del cliente (error 1580). Indicá el ID impositivo con `--id-impositivo` o el CUIT del país con `--cuit-pais`.',
    );
  });
});

describe('resolveExportClientCountryCuit', () => {
  it('lo resuelve desde el pais de destino, sin el tipo de entidad que agrega la tabla', () => {
    expect(resolveExportClientCountryCuit({ countries: COUNTRY_CUITS, country: { code: 203, name: 'Brasil' } })).toBe(
      55000000050,
    );
  });

  it('prefiere la fila de persona juridica, sin importar el orden de la tabla', () => {
    expect(
      resolveExportClientCountryCuit({
        countries: [
          { countryName: 'Peru - Otro tipo de Entidad', cuit: 51600000001 },
          { countryName: 'Peru - Persona Física', cuit: 50000000001 },
          { countryName: 'Peru - Persona Jurídica', cuit: 55000000001 },
        ],
        country: { code: 217, name: 'Peru' },
      }),
    ).toBe(55000000001);
  });

  it('acepta el CUIT indicado por el usuario', () => {
    expect(
      resolveExportClientCountryCuit({
        countries: COUNTRY_CUITS,
        country: { code: 212, name: 'Chile' },
        cuit: 55000000052,
      }),
    ).toBe(55000000052);
  });

  it('compara sin acentos ni mayusculas', () => {
    expect(
      resolveExportClientCountryCuit({
        countries: COUNTRY_CUITS,
        country: { code: 212, name: 'estados unidos' },
        cuit: 55000002126,
      }),
    ).toBe(55000002126);
  });

  it('rechaza un CUIT de otro pais y sugiere el del destino', () => {
    expect(() =>
      resolveExportClientCountryCuit({
        countries: COUNTRY_CUITS,
        country: { code: 212, name: 'Chile' },
        cuit: 55000000050,
      }),
    ).toThrow(/corresponde a "Brasil" y el destino es "Chile". Para "Chile" la tabla de ARCA trae 55000000052/);
  });

  it('rechaza un CUIT que no esta en la tabla', () => {
    expect(() =>
      resolveExportClientCountryCuit({
        countries: COUNTRY_CUITS,
        country: { code: 212, name: 'Chile' },
        cuit: 55000009999,
      }),
    ).toThrow(/no existe en la tabla/);
  });

  it('sin CUIT en la tabla ni por flag no hay CUIT: la E va con el ID impositivo (error 1580)', () => {
    expect(
      resolveExportClientCountryCuit({ countries: COUNTRY_CUITS, country: { code: 999, name: 'Narnia' } }),
    ).toBeUndefined();
  });

  it('acepta el CUIT cuando las dos tablas nombran distinto al pais', () => {
    expect(
      resolveExportClientCountryCuit({
        countries: COUNTRY_CUITS,
        country: { code: 310, name: 'CHINA' },
        cuit: 55000002916,
      }),
    ).toBe(55000002916);
  });
});

describe('resolveExportIncoterm', () => {
  const incoterms = [{ code: 'FOB', name: 'Free on Board' }];

  it('busca sin importar mayusculas', () => {
    expect(resolveExportIncoterm('fob', incoterms)).toEqual({ code: 'FOB', name: 'Free on Board' });
  });

  it('sin incoterm no valida nada', () => {
    expect(resolveExportIncoterm(undefined, [])).toBeUndefined();
  });

  it('rechaza uno que no esta en la tabla', () => {
    expect(() => resolveExportIncoterm('XYZ', incoterms)).toThrow(/no existe en la tabla/);
  });
});

describe('resolveExportActivity', () => {
  const ACTIVITIES = [
    { id: 62000, name: 'EXTRACCION DE GAS NATURAL' },
    { id: 620100, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA' },
    { id: 620300, name: 'SERVICIOS DE CONSULTORES EN TECNOLOGIA DE LA INFORMACION' },
  ];

  it('toma la actividad indicada si esta en la tabla de WSFEX', () => {
    expect(resolveExportActivity(620300, ACTIVITIES)).toBe(620300);
  });

  it('corta cuando la actividad no esta en la tabla, con las que empiezan igual', () => {
    expect(() => resolveExportActivity(620900, ACTIVITIES)).toThrow(
      /no está en la tabla de actividades de WSFEX y ARCA la rechaza \(error 2105\)\. Las que empiezan con 620 son 62000, 620100, 620300\. Indicá la que corresponda con `--actividad`/,
    );
  });

  it('no valida contra la tabla cuando ARCA no informa actividades', () => {
    expect(resolveExportActivity(620900, [])).toBe(620900);
  });

  it('rechaza codigos que no son enteros positivos', () => {
    expect(() => resolveExportActivity(0)).toThrow(/entero positivo/);
    expect(() => resolveExportActivity(1.5)).toThrow(/entero positivo/);
  });
});

describe('resolveExportNumber', () => {
  const base = { label: 'El numero', max: 99_999_999 };

  it('toma el indicado por el usuario', () => {
    expect(resolveExportNumber({ ...base, last: 10, provided: 3 })).toBe(3);
  });

  it('sigue al ultimo de ARCA', () => {
    expect(resolveExportNumber({ ...base, last: 10 })).toBe(11);
    expect(resolveExportNumber({ ...base, last: 0 })).toBe(1);
  });

  it('el indicado por el usuario empieza en 1 (TEST-16)', () => {
    expect(resolveExportNumber({ ...base, last: 10, provided: 1 })).toBe(1);
    expect(() => resolveExportNumber({ ...base, last: 10, provided: 0 })).toThrow(/entero positivo/);
    expect(() => resolveExportNumber({ ...base, last: 10, provided: -3 })).toThrow(/entero positivo/);
  });

  it('no permite pasar el maximo de ARCA, tampoco con el indicado por el usuario (1520)', () => {
    expect(() => resolveExportNumber({ ...base, last: 99_999_999 })).toThrow(/máximo/);
    expect(() => resolveExportNumber({ ...base, code: 1520, last: 0, provided: 100_000_000 })).toThrow(
      /99999999.*error 1520/,
    );
    expect(resolveExportNumber({ ...base, last: 0, provided: 99_999_999 })).toBe(99_999_999);
  });
});

describe('resolveExportLanguage (TEST-16)', () => {
  const languages = [{ id: 1 }, { id: 2 }];

  it('valida el idioma contra la tabla de ARCA', () => {
    expect(resolveExportLanguage(2, languages)).toBe(2);
    expect(() => resolveExportLanguage(9, languages)).toThrow(/idioma 9 no existe/);
  });

  it('sin tabla no valida, y sin idioma va el de siempre', () => {
    expect(resolveExportLanguage(9, [])).toBe(9);
    expect(resolveExportLanguage(undefined, languages)).toBe(1);
  });
});

describe('resolveExportPointOfSale (1510)', () => {
  it('va de 1 a 99.998', () => {
    expect(resolveExportPointOfSale(99_998, {})).toBe(99_998);
    expect(resolveExportPointOfSale(1, {})).toBe(1);
    expect(() => resolveExportPointOfSale(0, {})).toThrow(/entero positivo/);
    expect(() => resolveExportPointOfSale(undefined, { puntoVentaPorDefecto: 0 })).toThrow(/entero positivo/);
    expect(() => resolveExportPointOfSale(99_999, {})).toThrow(/1 a 99998.*error 1510/);
  });
});

describe('assertExportIncoterm', () => {
  it('la factura de bienes lleva incoterm (1640); servicios, otros y las notas no', () => {
    expect(() => assertExportIncoterm({ exportType: 1, isNote: false })).toThrow(/error 1640/);
    expect(() => assertExportIncoterm({ exportType: 1, incoterm: 'FOB', isNote: false })).not.toThrow();
    expect(() => assertExportIncoterm({ exportType: 2, isNote: false })).not.toThrow();
    expect(() => assertExportIncoterm({ exportType: 1, isNote: true })).not.toThrow();
  });

  it('la descripcion del incoterm va con incoterm (1641)', () => {
    expect(() => assertExportIncoterm({ exportType: 2, incotermDescription: 'Puerto', isNote: false })).toThrow(
      /error 1641/,
    );
  });
});

describe('assertExportTextLengths', () => {
  it('frena los textos mas largos que los de ARCA, con el codigo y el flag', () => {
    expect(() => assertExportTextLengths({ clientName: 'a'.repeat(200), emit: false })).not.toThrow();
    expect(() => assertExportTextLengths({ clientName: 'a'.repeat(201), emit: false })).toThrow(
      /200 caracteres y tiene 201.*error 1651.*--cliente/,
    );
    expect(() => assertExportTextLengths({ clientAddress: 'a'.repeat(301), emit: false })).toThrow(/error 1661/);
    expect(() => assertExportTextLengths({ emit: false, observations: 'a'.repeat(1001) })).toThrow(/error 1665/);
    expect(() => assertExportTextLengths({ commercialObservations: 'a'.repeat(4001), emit: false })).toThrow(
      /--obs-comerciales/,
    );
    expect(() => assertExportTextLengths({ emit: false, incotermDescription: 'a'.repeat(21) })).toThrow(/error 1642/);
    expect(() => assertExportTextLengths({ emit: false, paymentTerms: 'a'.repeat(51) })).toThrow(/--forma-pago/);
    expect(() => assertExportTextLengths({ clientTaxId: 'a'.repeat(51), emit: false })).toThrow(/--id-impositivo/);
  });

  it('cuenta caracteres, no unidades UTF-16', () => {
    expect(() => assertExportTextLengths({ emit: false, incotermDescription: '🚢'.repeat(20) })).not.toThrow();
  });
});

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
