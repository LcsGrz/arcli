import { describe, expect, it } from 'vitest';

import {
  buildExportPayload,
  resolveExportActivity,
  resolveExportClientCountryCuit,
  resolveExportCurrency,
  resolveExportDestinationCountry,
  resolveExportIncoterm,
  resolveExportNumber,
  resolveExportQuotation,
  resolveExportType,
  resolveExportVoucherDate,
} from '../export.mappers';
import type { ExportCountry, ExportCountryCuit } from '../export.types';

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
  const config = { cotizacionPorDefecto: 1 };

  it('por defecto la exportacion va en dolares y pide la cotizacion a ARCA', () => {
    expect(resolveExportCurrency({}, config)).toEqual({
      fields: { CanMisMonExt: 'N', Moneda_ctz: 0, Moneda_Id: 'DOL' },
      needsQuotation: true,
    });
  });

  it('en pesos la cotizacion es 1 y no hay que consultar ARCA', () => {
    expect(resolveExportCurrency({ currencyCode: 'ARS' }, config)).toEqual({
      fields: { CanMisMonExt: 'N', Moneda_ctz: 1, Moneda_Id: 'PES' },
      needsQuotation: false,
    });
  });

  it('acepta el alias USD y la cotizacion escrita por el usuario', () => {
    expect(resolveExportCurrency({ currencyCode: 'USD', exchangeRate: 900.5 }, config)).toEqual({
      fields: { CanMisMonExt: 'N', Moneda_ctz: 900.5, Moneda_Id: 'DOL' },
      needsQuotation: false,
    });
  });

  it('pide la cotizacion a ARCA cuando es moneda extranjera y no vino', () => {
    expect(resolveExportCurrency({ currencyCode: 'DOL' }, config).needsQuotation).toBe(true);
  });

  it('usa la cotizacion configurada si es mayor a 1', () => {
    expect(resolveExportCurrency({ currencyCode: 'DOL' }, { cotizacionPorDefecto: 1200 }).fields.Moneda_ctz).toBe(1200);
  });

  it('no acepta cotizacion en pesos distinta de 1 ni misma moneda en pesos', () => {
    expect(() => resolveExportCurrency({ currencyCode: 'ARS', exchangeRate: 2 }, config)).toThrow(
      /cotizacion tiene que ser 1/,
    );
    expect(() => resolveExportCurrency({ currencyCode: 'ARS', sameCurrency: true }, config)).toThrow(
      /moneda extranjera/,
    );
  });

  it('marca CanMisMonExt cuando el pago es en la misma moneda', () => {
    expect(
      resolveExportCurrency({ currencyCode: 'USD', exchangeRate: 900, sameCurrency: true }, config).fields,
    ).toEqual({ CanMisMonExt: 'S', Moneda_ctz: 900, Moneda_Id: 'DOL' });
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
    expect(resolveExportQuotation(' dol ', QUOTATIONS, '2026-10-28')).toEqual(QUOTATIONS[0]);
  });

  it('falla con las monedas que si tienen cotizacion', () => {
    expect(() => resolveExportQuotation('019', QUOTATIONS, '2026-10-28')).toThrow(
      /no informo la cotizacion de 019 para el 2026-10-28\. Las monedas con cotizacion son DOL, 060\./,
    );
  });

  it('pide la cotizacion por flag cuando ARCA no publico ninguna', () => {
    expect(() => resolveExportQuotation('DOL', [], '2027-01-05')).toThrow(
      /no informo la cotizacion de DOL para el 2027-01-05\. Informe la cotizacion con --cotizacion-moneda\./,
    );
  });
});

describe('resolveExportDestinationCountry', () => {
  it('busca por codigo y por nombre', () => {
    expect(resolveExportDestinationCountry('203', COUNTRIES)).toEqual({ code: 203, name: 'Brasil' });
    expect(resolveExportDestinationCountry(' brasil ', COUNTRIES)).toEqual({ code: 203, name: 'Brasil' });
  });

  it('rechaza Argentina: no es un destino de exportacion', () => {
    expect(() => resolveExportDestinationCountry('Argentina', COUNTRIES)).toThrow(/no es un destino de exportacion/);
  });

  it('rechaza un pais que no esta en la tabla', () => {
    expect(() => resolveExportDestinationCountry('Marte', COUNTRIES)).toThrow(/no existe en la tabla/);
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

  it('avisa cuando el pais no tiene CUIT en la tabla', () => {
    expect(() =>
      resolveExportClientCountryCuit({ countries: COUNTRY_CUITS, country: { code: 999, name: 'Narnia' } }),
    ).toThrow(/--cuit-pais/);
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

  it('usa 620900 (servicios de informatica) cuando no se indica otra', () => {
    expect(resolveExportActivity(undefined)).toEqual({ id: 620900 });
  });

  it('toma la actividad indicada por el usuario', () => {
    expect(resolveExportActivity(620300, ACTIVITIES)).toEqual({ id: 620300 });
  });

  it('no avisa nada si la actividad esta en la tabla de WSFEX', () => {
    expect(resolveExportActivity(620100, ACTIVITIES)).toEqual({ id: 620100 });
  });

  it('avisa cuando la actividad no esta en la tabla, con las que empiezan igual', () => {
    const resolved = resolveExportActivity(620900, ACTIVITIES);

    expect(resolved.id).toBe(620900);
    expect(resolved.warning).toMatch(/no esta en la tabla de actividades de WSFEX/);
    expect(resolved.warning).toMatch(/error 2105/);
    expect(resolved.warning).toMatch(/Las que empiezan con 620 son 62000, 620100, 620300/);
    expect(resolved.warning).toMatch(/--actividad/);
  });

  it('no corta la emision cuando la tabla viene vacia (ARCA no informa actividades)', () => {
    expect(resolveExportActivity(620900, [])).toEqual({ id: 620900 });
  });

  it('rechaza codigos que no son enteros positivos', () => {
    expect(() => resolveExportActivity(0)).toThrow(/entero positivo/);
    expect(() => resolveExportActivity(1.5)).toThrow(/entero positivo/);
  });
});

describe('resolveExportNumber', () => {
  it('toma el indicado por el usuario', () => {
    expect(resolveExportNumber({ label: 'El numero', last: 10, provided: 3 })).toBe(3);
  });

  it('sigue al ultimo de ARCA', () => {
    expect(resolveExportNumber({ label: 'El numero', last: 10 })).toBe(11);
    expect(resolveExportNumber({ label: 'El numero', last: 0 })).toBe(1);
  });

  it('no permite pasar el maximo de ARCA', () => {
    expect(() => resolveExportNumber({ label: 'El numero', last: 99_999_999 })).toThrow(/maximo/);
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
      Fecha_pago: '20260601',
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

  it('pide el flag de permiso existente cuando hay permisos', () => {
    expect(() => buildExportPayload({ ...input, permits: ['P1'] }, resolution)).toThrow(/--permiso-existente/);
  });

  it('pide los datos del cliente antes de emitir', () => {
    expect(() => buildExportPayload({ ...input, clientName: ' ' }, resolution)).toThrow(/--cliente/);
    expect(() => buildExportPayload({ ...input, clientAddress: undefined }, resolution)).toThrow(/--domicilio-cliente/);
    expect(() => buildExportPayload({ ...input, amount: undefined }, resolution)).toThrow(/--monto/);
  });
});
