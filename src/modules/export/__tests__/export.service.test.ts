import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../lib/errors/app-error';
import { exportAnswer } from '../../../testing/arca-answers';
import { EmissionUncertainError } from '../../billing/billing.errors';
import { arcliConfigSchema } from '../../config/config.schemas';
import { ExportService } from '../export.service';
import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  type ExportGateway,
  type ExportIssuedVoucher,
  type ExportVoucherInput,
} from '../export.types';

const NOW = new Date('2026-06-01T15:00:00Z');

const RUNTIME = {
  config: arcliConfigSchema.parse({ cuit: '20111111112', exportacion: { actividad: 620100 }, puntoVentaPorDefecto: 3 }),
  cuit: 20111111112,
  environment: 'testing' as const,
};

function createGateway(overrides: Partial<ExportGateway> = {}): ExportGateway {
  return {
    authorize: vi.fn(async () =>
      exportAnswer({
        FEXAuthorizeResult: {
          FEXErr: { ErrCode: 0, ErrMsg: '' },
          FEXEvents: { EventCode: 0, EventMsg: '' },
          FEXResultAuth: {
            Cae: '75123456789012',
            Cbte_nro: 42,
            Cbte_tipo: 19,
            Cuit: 20111111112,
            Fch_cbte: '20260601',
            Fch_venc_Cae: '20260611',
            Id: 8,
            Motivos_Obs: '',
            Punto_vta: 3,
            Reproceso: 'N',
            Resultado: 'A',
          },
        },
      }),
    ),
    getDestinationCountries: vi.fn(async () => [
      { code: 203, name: 'Brasil' },
      { code: 212, name: 'Chile' },
    ]),
    checkPermit: vi.fn(async () => 'OK'),
    getActivities: vi.fn(async () => [
      { id: 46201, name: 'VENTA AL POR MAYOR DE MATERIAS PRIMAS' },
      { id: 620100, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA' },
    ]),
    getCurrencies: vi.fn(async () => [
      { code: 'DOL', name: 'Dólar Estadounidense' },
      { code: 'PES', name: 'Pesos Argentinos' },
    ]),
    getDestinationCountryCuits: vi.fn(async () => [
      { countryName: 'Brasil - Persona Física', cuit: 50000000059 },
      { countryName: 'Brasil - Persona Jurídica', cuit: 55000000050 },
      { countryName: 'Chile - Persona Jurídica', cuit: 55000000052 },
    ]),
    getIncoterms: vi.fn(async () => [{ code: 'FOB', name: 'Free on Board' }]),
    getLanguages: vi.fn(async () => [
      { id: 1, name: 'Espanol' },
      { id: 2, name: 'Ingles' },
    ]),
    getLastRequestId: vi.fn(async () => 7),
    getLastVoucherNumber: vi.fn(async () => 41),
    getVoucher: vi.fn(async () => ASSOCIATED_INVOICE),
    // Como WSFEX: la cotizacion del dia pedido.
    getQuotations: vi.fn(async (arcaDate: string) => [{ code: 'DOL', date: arcaDate, rate: 900.5 }]),
    getUnits: vi.fn(async () => [
      { id: 1, name: 'Kilogramo' },
      { id: 7, name: 'Unidad' },
    ]),
    ...overrides,
  };
}

/** Una factura E de servicios a Brasil, como la devuelve FEXGetCMP. */
const ASSOCIATED_INVOICE: ExportIssuedVoucher = {
  activities: [620100],
  arcaType: 19,
  clientAddress: 'Av. Paulista 1000',
  clientCountryCuit: 55000000050,
  clientName: 'ACME LLC',
  clientTaxId: '123456789',
  currencyCode: 'DOL',
  date: '20260520',
  destinationCountry: 203,
  exchangeRate: 880.25,
  exportType: 2,
  language: 1,
  number: 12,
  paymentTerms: 'Transferencia Internacional',
  pointOfSale: 3,
  result: 'A',
  total: 1500,
};

const INPUT: ExportVoucherInput = {
  amount: 1500,
  clientAddress: 'Av. Paulista 1000',
  clientName: 'ACME LLC',
  clientTaxId: '123456789',
  currencyCode: 'USD',
  destinationCountry: 'brasil',
  emit: true,
  incoterm: 'fob',
  items: [{ code: '001', description: 'Servicio de consultoria', quantity: 1, unit: 'unidad', unitPrice: 1500 }],
  voucherNumber: 42,
};

describe('ExportService.resolve', () => {
  const service = new ExportService({ clock: { now: () => NOW } });

  it('lee el reloj en cada resolucion, no al crear el servicio', async () => {
    let now = new Date('2026-06-02T02:59:59Z');
    const longLived = new ExportService({ clock: { now: () => now } });
    const before = await longLived.resolve(INPUT, createGateway(), RUNTIME);

    now = new Date('2026-06-02T03:00:00Z');

    const after = await longLived.resolve(INPUT, createGateway(), RUNTIME);

    expect([before.payload.Fecha_cbte, after.payload.Fecha_cbte]).toEqual(['20260601', '20260602']);
  });

  it('lee el reloj una vez por resolucion: la medianoche no cae en el medio', async () => {
    // La primera lectura es del 01/06; las que sigan, de otro año, para que tambien cambie la fecha sin año.
    const now = vi.fn(() => new Date('2030-06-02T03:00:00Z')).mockReturnValueOnce(new Date('2026-06-02T02:59:59Z'));
    const gateway = createGateway();
    const resolved = await new ExportService({ clock: { now } }).resolve(
      { ...INPUT, paymentDate: '10/6', voucherDate: '2/6/2026' },
      gateway,
      RUNTIME,
    );

    expect(now).toHaveBeenCalledTimes(1);
    expect(resolved.payload).toMatchObject({ Fecha_cbte: '20260602', Fecha_pago: '20260610' });
    expect(gateway.getQuotations).toHaveBeenCalledWith('20260531');
    expect(resolved.warnings).toContainEqual(expect.stringContaining('(02/06/2026) es futura'));
  });

  it('arma el payload con la numeracion, la cotizacion y las tablas de ARCA', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve({ ...INPUT, exportType: 1 }, gateway, RUNTIME);

    expect(resolved.payload).toMatchObject({
      Cbte_nro: 42,
      Cbte_Tipo: 19,
      Cliente: 'ACME LLC',
      Cuit_pais_cliente: 55000000050,
      Dst_cmp: 203,
      Fecha_cbte: '20260601',
      Id: 8,
      Idioma_cbte: 1,
      Imp_total: 1500,
      Incoterms: 'FOB',
      Incoterms_Ds: 'Free on Board',
      Moneda_ctz: 900.5,
      Moneda_Id: 'DOL',
      Punto_vta: 3,
      Tipo_expo: 1,
    });
    // Sin --actividad sale de exportacion.actividad: WSFEX rechaza Actividades sin Actividad (error 2100).
    expect(resolved.payload.Actividades).toEqual({ Actividad: [{ Id: 620100 }] });
    expect(resolved.payload.Items.Item).toEqual([
      {
        Pro_bonificacion: 0,
        Pro_codigo: '001',
        Pro_ds: 'Servicio de consultoria',
        Pro_precio_uni: 1500,
        Pro_qty: 1,
        Pro_total_item: 1500,
        Pro_umed: 7,
      },
    ]);
    expect(resolved.display).toEqual({
      countryCuitName: 'Brasil - Persona Jurídica',
      countryName: 'Brasil',
      currencyName: 'Dólar Estadounidense',
      incotermName: 'Free on Board',
      languageName: 'Espanol',
      unitNames: { 1: 'Kilogramo', 7: 'Unidad' },
    });
    expect(gateway.getQuotations).toHaveBeenCalledWith('20260601');
    // Sin permisos de embarque el Cmp no lleva Permisos: ARCA lo rechaza (1720) con Permiso_existente = N.
    expect(resolved.payload).not.toHaveProperty('Permisos');
  });

  it('sin permisos de embarque no consulta FEXCheck_Permiso', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve({ ...INPUT, exportType: 1 }, gateway, RUNTIME);

    expect(gateway.checkPermit).not.toHaveBeenCalled();
    expect(resolved.display.permitChecks).toBeUndefined();
  });

  it('consulta cada permiso de embarque con el destino y guarda lo que contesto ARCA', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve(
      { ...INPUT, exportType: 1, permits: ['P1', 'P2'], permitsExisting: true },
      gateway,
      RUNTIME,
    );

    expect(gateway.checkPermit).toHaveBeenCalledWith('P1', 203);
    expect(gateway.checkPermit).toHaveBeenCalledWith('P2', 203);
    expect(resolved.display.permitChecks).toEqual([
      { permit: 'P1', status: 'valido' },
      { permit: 'P2', status: 'valido' },
    ]);
  });

  it('un permiso que ARCA no reconoce corta antes de emitir', async () => {
    const gateway = createGateway({ checkPermit: vi.fn(async () => 'NO') });

    await expect(
      service.resolve({ ...INPUT, exportType: 1, permits: ['P1'], permitsExisting: true }, gateway, RUNTIME),
    ).rejects.toThrow('ARCA dice que el permiso de embarque P1 no es válido para el destino 203 - Brasil');
    expect(gateway.authorize).not.toHaveBeenCalled();
  });

  it('si FEXCheck_Permiso falla, sigue con un aviso', async () => {
    const gateway = createGateway({ checkPermit: vi.fn().mockRejectedValue(new Error('timeout')) });
    const resolved = await service.resolve(
      { ...INPUT, exportType: 1, permits: ['P1'], permitsExisting: true },
      gateway,
      RUNTIME,
    );

    expect(resolved.display.permitChecks).toEqual([{ permit: 'P1', status: 'sin-verificar' }]);
    expect(resolved.warnings).toContain(
      'No se pudo verificar el permiso de embarque P1 en ARCA (timeout): revisalo antes de emitir.',
    );
  });

  it('en una exportacion de servicios deja vacio Permiso_existente, como pide ARCA (1550)', async () => {
    const resolved = await service.resolve({ ...INPUT, exportType: 2 }, createGateway(), RUNTIME);

    expect(resolved.payload.Permiso_existente).toBe('');
    expect(resolved.payload).not.toHaveProperty('Permisos');
  });

  it('en servicios manda la fecha de pago de `--fecha-pago` sin avisos', async () => {
    const resolved = await service.resolve(
      { ...INPUT, exportType: 2, paymentDate: '15/06/2026' },
      createGateway(),
      RUNTIME,
    );

    expect(resolved.payload.Fecha_pago).toBe('20260615');
    expect(resolved.warnings).toEqual([]);
  });

  it('en bienes no manda la fecha de pago (ARCA la rechaza, 1673) y avisa si vino `--fecha-pago`', async () => {
    const withoutDate = await service.resolve({ ...INPUT, exchangeRate: 900, exportType: 1 }, createGateway(), RUNTIME);
    const withDate = await service.resolve(
      { ...INPUT, exchangeRate: 900, exportType: 1, paymentDate: '15/06/2026' },
      createGateway(),
      RUNTIME,
    );

    expect(withoutDate.payload).not.toHaveProperty('Fecha_pago');
    expect(withoutDate.warnings).toEqual([]);
    expect(withDate.payload).not.toHaveProperty('Fecha_pago');
    expect(withDate.warnings).toEqual([
      'La factura E de bienes (`--tipo-expo 1`) no lleva fecha de pago: ARCA la rechaza (error 1673). `--fecha-pago` no se usa.',
    ]);
  });

  it('sin moneda ni tipo usa los defaults: servicios, dolares y transferencia internacional', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve({ ...INPUT, currencyCode: undefined }, gateway, RUNTIME);

    expect(resolved.payload).toMatchObject({
      Forma_pago: 'Transferencia Internacional',
      Moneda_Id: 'DOL',
      Moneda_ctz: 900.5,
      Permiso_existente: '',
      Tipo_expo: 2,
    });
    // En servicios, la del dia habil anterior (error 2053).
    expect(gateway.getQuotations).toHaveBeenCalledWith('20260531');
  });

  it('en bienes pide la cotizacion con la fecha del comprobante en yyyymmdd (Fecha_CTZ)', async () => {
    const gateway = createGateway();

    // Sin --fecha la cotizacion es la del dia del comprobante (hoy en Argentina): la consulta va en yyyymmdd.
    await service.resolve({ ...INPUT, exportType: 1 }, gateway, RUNTIME);
    expect(gateway.getQuotations).toHaveBeenCalledWith('20260601');

    const backdated = createGateway();
    const resolved = await service.resolve({ ...INPUT, exportType: 1, voucherDate: '29/05/2026' }, backdated, RUNTIME);

    expect(resolved.payload.Fecha_cbte).toBe('20260529');
    expect(backdated.getQuotations).toHaveBeenCalledWith('20260529');
  });

  it('en servicios pide la cotizacion del dia anterior a la fecha del comprobante (error 2053)', async () => {
    const gateway = createGateway();

    await service.resolve({ ...INPUT, currencyCode: undefined }, gateway, RUNTIME);
    expect(gateway.getQuotations).toHaveBeenCalledWith('20260531');

    // El caso del rechazo en testing: una E de servicios del 16/11 tiene que ir con la del 15/11.
    const backdated = createGateway();
    const resolved = await new ExportService({
      clock: { now: () => new Date('2026-11-18T15:00:00Z') },
    }).resolve({ ...INPUT, voucherDate: '16/11/2026' }, backdated, RUNTIME);

    expect(backdated.getQuotations).toHaveBeenCalledWith('20261115');
    expect(resolved.payload.Moneda_ctz).toBe(900.5);
    expect(resolved.warnings).toEqual([]);
  });

  it('en servicios, un lunes usa la del ultimo dia habil y avisa de que dia es', async () => {
    // WSFEX devuelve la ultima publicada hasta el dia pedido: el domingo trae la del viernes.
    const gateway = createGateway({
      getQuotations: vi.fn(async () => [{ code: 'DOL', date: '20261113', rate: 1179.27 }]),
    });
    const resolved = await new ExportService({
      clock: { now: () => new Date('2026-11-16T15:00:00Z') },
    }).resolve(INPUT, gateway, RUNTIME);

    expect(gateway.getQuotations).toHaveBeenCalledWith('20261115');
    expect(resolved.payload.Moneda_ctz).toBe(1179.27);
    expect(resolved.warnings).toEqual([
      'En servicios ARCA exige la cotización de DOL del día hábil anterior a la fecha del comprobante (error 2053): se usa la del 13/11/2026 (1.179,27), la última que publicó hasta el 15/11/2026.',
    ]);
  });

  it('con --misma-moneda tambien pide la del dia anterior, en bienes y otros', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve({ ...INPUT, exportType: 1, sameCurrency: true }, gateway, RUNTIME);

    expect(gateway.getQuotations).toHaveBeenCalledWith('20260531');
    expect(resolved.payload).toMatchObject({ CanMisMonExt: 'S', Moneda_ctz: 900.5 });
  });

  it('en bienes usa la ultima cotizacion publicada y avisa de que dia es', async () => {
    const gateway = createGateway({
      getQuotations: vi.fn(async () => [{ code: 'DOL', date: '20260529', rate: 895 }]),
    });
    const resolved = await service.resolve({ ...INPUT, currencyCode: undefined, exportType: 1 }, gateway, RUNTIME);

    expect(resolved.payload.Moneda_ctz).toBe(895);
    expect(resolved.warnings).toEqual([
      'Sin `--cm` se usa la cotización oficial de ARCA para DOL (895), la de aduana del 29/05/2026: ARCA no publicó la del 01/06/2026. Para usar otra, `--cotizacion-moneda`.',
    ]);
  });

  it('en bienes y otros avisa que la cotizacion es la oficial, tambien si es la del dia (ARQ-22)', async () => {
    for (const exportType of [1, 4] as const) {
      const { warnings } = await service.resolve({ ...INPUT, exportType }, createGateway(), RUNTIME);

      expect(warnings).toEqual([
        'Sin `--cm` se usa la cotización oficial de ARCA para USD (900,50), la de aduana. Para usar otra, `--cotizacion-moneda`.',
      ]);
    }

    const sameCurrency = await service.resolve(
      { ...INPUT, exportType: 4, sameCurrency: true },
      createGateway(),
      RUNTIME,
    );
    const withRate = await service.resolve({ ...INPUT, exchangeRate: 900, exportType: 4 }, createGateway(), RUNTIME);

    expect([sameCurrency.warnings, withRate.warnings]).toEqual([[], []]);
  });

  it('en servicios no avisa nada cuando la cotizacion es la del dia pedido', async () => {
    const resolved = await service.resolve(INPUT, createGateway(), RUNTIME);

    expect(resolved.warnings).toEqual([]);
  });

  it('falla con las monedas que si tienen cotizacion cuando ARCA no cotiza la pedida', async () => {
    const gateway = createGateway({
      getQuotations: vi.fn(async () => [{ code: '060', date: '20260531', rate: 1300 }]),
    });

    await expect(service.resolve(INPUT, gateway, RUNTIME)).rejects.toThrow(
      /no informó la cotización de DOL para el 31\/05\/2026\. Las monedas con cotización son 060\./,
    );
    await expect(service.resolve(INPUT, gateway, RUNTIME)).rejects.toThrow(/--cotizacion-moneda/);
  });

  it('una moneda que no esta en la tabla de WSFEX es error de entrada (1590), sin pedir la cotizacion', async () => {
    const gateway = createGateway();

    for (const exchangeRate of [undefined, 10]) {
      await expect(
        service.resolve({ ...INPUT, currencyCode: 'XYZ', exchangeRate }, gateway, RUNTIME),
      ).rejects.toMatchObject({
        code: 'INPUT_VALIDATION_ERROR',
        message: 'La moneda XYZ no está en la tabla de monedas de ARCA: la rechaza al emitir (error 1590).',
        suggestion: expect.stringMatching(/`--moneda`/),
      });
    }

    expect(gateway.getQuotations).not.toHaveBeenCalled();
  });

  // ARQ-22: `arcli parametros` es de wsfe, sus tablas no son las de la E.
  it.each<[string, Partial<ExportVoucherInput>, RegExp]>([
    [
      'moneda',
      { currencyCode: 'XYZ' },
      /: va el código de ARCA o su ISO\. Las más comunes de la E: `PES` \(ARS\), `DOL` \(USD\)\.$/,
    ],
    ['incoterm', { incoterm: 'XXX' }, /^Los válidos: `/],
    ['idioma', { language: 99 }, /^Los válidos: \d+ \(/],
    ['país', { destinationCountry: 'Narnia' }, /`arcli` > "Emitir factura" > "Factura de exportación E"/],
    ['CUIT de país', { clientCountryCuit: 1 }, /^Para "Brasil" la tabla de ARCA trae \d+: pasalo con `--cuit-pais`\.$/],
    [
      'unidad',
      { items: [{ description: 'x', quantity: 1, unit: 'xx', unitPrice: INPUT.amount as number }] },
      /^Las más comunes: \d/,
    ],
  ])('%s inválido: la sugerencia dice los válidos y no manda a `parametros`', async (_name, override, hint) => {
    const note = { associatedVoucher: { number: 12 }, incoterm: undefined, voucherKind: EXPORT_CREDIT_NOTE_KIND };

    for (const input of [INPUT, { ...INPUT, ...note }]) {
      const gateway = createGateway({ getVoucher: vi.fn(async () => ASSOCIATED_INVOICE) });
      const error = (await service
        .resolve({ ...input, ...override }, gateway, RUNTIME)
        .catch((reason: unknown) => reason)) as AppError;

      expect(error).toMatchObject({ code: 'INPUT_VALIDATION_ERROR', suggestion: expect.stringMatching(hint) });
      expect(`${error.message} ${error.suggestion}`).not.toContain('parametros');
    }
  });

  it('el CUIT de país heredado que la tabla no trae: la sugerencia no promete el del destino (ARQ-22)', async () => {
    const gateway = createGateway({
      getVoucher: vi.fn(async () => ({ ...ASSOCIATED_INVOICE, clientCountryCuit: 1 })),
    });

    await expect(
      service.resolve(
        {
          amount: 100,
          emit: false,
          associatedVoucher: { number: 12 },
          voucherKind: EXPORT_CREDIT_NOTE_KIND,
        },
        gateway,
        RUNTIME,
      ),
    ).rejects.toMatchObject({
      message: 'El CUIT de país 1 no existe en la tabla de ARCA.',
      suggestion: expect.stringMatching(/pasalo con `--cuit-pais`\.$/),
    });
  });

  it.each<[string, string, Array<{ code: number; name: string }>, string | undefined]>([
    [
      'parecidos, sin tildes',
      'unidos',
      [{ code: 212, name: 'ESTADOS UNIDOS' }],
      'Parecidos: ESTADOS UNIDOS (212). Están todos en el asistente: `arcli` > "Emitir factura" > "Factura de exportación E".',
    ],
    [
      'sin Argentina',
      'argen',
      [{ code: 200, name: 'ARGENTINA' }],
      'Están todos en el asistente: `arcli` > "Emitir factura" > "Factura de exportación E".',
    ],
    [
      'un código',
      '999',
      [{ code: 212, name: 'ESTADOS UNIDOS' }],
      'Están todos en el asistente: `arcli` > "Emitir factura" > "Factura de exportación E".',
    ],
    ['sin tabla', 'unidos', [], undefined],
  ])('país inexistente, %s', async (_name, destinationCountry, countries, suggestion) => {
    const gateway = createGateway({ getDestinationCountries: vi.fn(async () => countries) });

    await expect(service.resolve({ ...INPUT, destinationCountry }, gateway, RUNTIME)).rejects.toMatchObject({
      message: `El país de destino "${destinationCountry}" no existe en la tabla de ARCA. Usá el código o el nombre que informa ARCA.`,
      suggestion,
    });
  });

  it('la moneda sugerida no nombra una que la tabla no trae (ARQ-22)', async () => {
    const gateway = createGateway({ getCurrencies: vi.fn(async () => [{ code: '012', name: 'Real' }]) });

    await expect(service.resolve({ ...INPUT, currencyCode: 'XYZ' }, gateway, RUNTIME)).rejects.toMatchObject({
      suggestion: expect.not.stringMatching(/DOL|USD|EUR|060/),
    });
  });

  it('sin cotizacion para la moneda (el gateway descarta las de 0) es ARCA_QUOTATION_ERROR', async () => {
    const gateway = createGateway({ getQuotations: vi.fn(async () => []) });

    await expect(service.resolve(INPUT, gateway, RUNTIME)).rejects.toMatchObject({
      code: 'ARCA_QUOTATION_ERROR',
      message: expect.stringMatching(/no informó la cotización de DOL para el 31\/05\/2026\. Informá/),
    });
  });

  it('si la tabla no trae CUIT para el destino, va solo con el ID impositivo (error 1580)', async () => {
    const gateway = createGateway({
      getDestinationCountries: vi.fn(async () => [{ code: 415, name: 'IRLANDA' }]),
    });
    const resolved = await service.resolve(
      { ...INPUT, clientTaxId: 'IE1234567T', destinationCountry: 'irlanda' },
      gateway,
      RUNTIME,
    );

    expect(resolved.payload).not.toHaveProperty('Cuit_pais_cliente');
    expect(resolved.payload.Id_impositivo).toBe('IE1234567T');
    expect(resolved.display.countryCuitName).toBeUndefined();
  });

  it('sin CUIT del pais ni ID impositivo pide uno de los dos antes de emitir', async () => {
    const gateway = createGateway({
      getDestinationCountries: vi.fn(async () => [{ code: 415, name: 'IRLANDA' }]),
    });

    await expect(
      service.resolve({ ...INPUT, clientTaxId: undefined, destinationCountry: '415' }, gateway, RUNTIME),
    ).rejects.toThrow(/ARCA pide el CUIT del país o el ID impositivo del cliente \(error 1580\)/);
    expect(gateway.authorize).not.toHaveBeenCalled();
  });

  it('respeta la moneda, el tipo y la forma de pago que vienen por flag', async () => {
    const resolved = await service.resolve(
      { ...INPUT, currencyCode: 'ARS', exportType: 1, paymentTerms: 'Carta de credito' },
      createGateway(),
      RUNTIME,
    );

    expect(resolved.payload).toMatchObject({
      Forma_pago: 'Carta de credito',
      Moneda_ctz: 1,
      Moneda_Id: 'PES',
      Permiso_existente: 'N',
      Tipo_expo: 1,
    });
  });

  it('toma la actividad y el pago en la misma moneda que vienen por flag', async () => {
    const resolved = await service.resolve({ ...INPUT, activity: 46201, sameCurrency: true }, createGateway(), RUNTIME);

    expect(resolved.payload.Actividades).toEqual({ Actividad: [{ Id: 46201 }] });
    // CanMisMonExt es el campo de WSFEX que dice que el pago se cancela en la moneda extranjera del comprobante.
    expect(resolved.payload.CanMisMonExt).toBe('S');
  });

  it('corta antes de emitir si la actividad no esta en la tabla de WSFEX (ARCA la rechaza con 2105)', async () => {
    const gateway = createGateway();

    await expect(service.resolve({ ...INPUT, activity: 620900 }, gateway, RUNTIME)).rejects.toThrow(
      /La actividad 620900 no está en la tabla de actividades de WSFEX.*Las que empiezan con 620 son 620100/,
    );
    expect(gateway.authorize).not.toHaveBeenCalled();
  });

  it('con las tablas de incoterms y actividades vacías no valida contra ellas y avisa (REV-62)', async () => {
    const gateway = createGateway({ getActivities: vi.fn(async () => []), getIncoterms: vi.fn(async () => []) });
    const resolved = await service.resolve({ ...INPUT, activity: 999999, exportType: 1 }, gateway, RUNTIME);

    expect(resolved.payload).toMatchObject({ Actividades: { Actividad: [{ Id: 999999 }] }, Incoterms: 'FOB' });
    expect(resolved.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/tabla de actividades de WSFEX: 999999 va sin validar/),
        expect.stringMatching(/tabla de incoterms de WSFEX: FOB va sin validar/),
      ]),
    );
  });

  it('sin actividad por flag ni por config no manda el bloque Actividades ni consulta la tabla (2100 es el bloque vacio)', async () => {
    const gateway = createGateway();
    const runtime = { ...RUNTIME, config: arcliConfigSchema.parse({ cuit: '20111111112', puntoVentaPorDefecto: 3 }) };
    const resolved = await service.resolve(INPUT, gateway, runtime);

    expect(resolved.payload).not.toHaveProperty('Actividades');
    expect(gateway.getActivities).not.toHaveBeenCalled();
  });

  it('rechaza un monto con más de 2 decimales, como A, B y C, en lugar de redondearlo', async () => {
    await expect(
      service.resolve({ ...INPUT, amount: 1500.005, items: undefined }, createGateway(), RUNTIME),
    ).rejects.toThrow(/más de 2 decimales/);
  });

  it('no consulta el ID de solicitud si el usuario lo informa', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve({ ...INPUT, requestId: 100, voucherNumber: 5 }, gateway, RUNTIME);

    expect(resolved.payload.Cbte_nro).toBe(5);
    expect(resolved.payload.Id).toBe(100);
    expect(gateway.getLastRequestId).not.toHaveBeenCalled();
  });

  it('sin --numero usa el siguiente al último que tiene ARCA para ese tipo y punto de venta', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve({ ...INPUT, voucherNumber: undefined }, gateway, RUNTIME);

    expect(gateway.getLastVoucherNumber).toHaveBeenCalledWith(19, 3, 'emitir');
    expect(resolved.payload.Cbte_nro).toBe(42);
  });

  it('con --numero no consulta el último', async () => {
    const gateway = createGateway();

    await service.resolve(INPUT, gateway, RUNTIME);

    expect(gateway.getLastVoucherNumber).not.toHaveBeenCalled();
  });

  it('en bienes usa la cotizacion del flag, y la oficial solo para compararla', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve({ ...INPUT, exchangeRate: 1000, exportType: 1 }, gateway, RUNTIME);

    expect(resolved.payload.Moneda_ctz).toBe(1000);
    expect(gateway.getQuotations).toHaveBeenCalledTimes(1);
    expect(gateway.getQuotations).toHaveBeenCalledWith('20260601');
  });

  it('en bienes y otros, una cotizacion fuera del 2 % al 400 % de la oficial avisa sin frenar (1667)', async () => {
    const warningsFor = async (exchangeRate: number, gateway = createGateway()) =>
      (await service.resolve({ ...INPUT, exchangeRate, exportType: 4 }, gateway, RUNTIME)).warnings;

    // La oficial es 900,50.
    expect(await warningsFor(18.01)).toEqual([]);
    expect(await warningsFor(3602)).toEqual([]);
    expect(await warningsFor(18)).toEqual([expect.stringContaining('(error 1667)')]);
    expect(await warningsFor(3602.01)).toEqual([expect.stringContaining('(error 1667)')]);
    expect(await warningsFor(9)).toEqual([
      'La cotización de DOL (9) está fuera de lo que dice el manual de ARCA: entre el 2 % y el 400 % de la oficial (900,50), o sea de 18,01 a 3.602. ARCA la puede rechazar (error 1667): revisá `--cm`.',
    ]);
    // Sin la oficial no hay contra que comparar.
    expect(await warningsFor(9, createGateway({ getQuotations: vi.fn(async () => []) }))).toEqual([]);
    expect(
      await warningsFor(9, createGateway({ getQuotations: vi.fn().mockRejectedValue(new Error('socket hang up')) })),
    ).toEqual([]);
  });

  it('en servicios y con `--misma-moneda`, `--cotizacion-moneda` tiene que ser la de ARCA (2053, 1604)', async () => {
    const official = await service.resolve({ ...INPUT, exchangeRate: 900.5 }, createGateway(), RUNTIME);

    expect(official.payload.Moneda_ctz).toBe(900.5);
    await expect(service.resolve({ ...INPUT, exchangeRate: 1000 }, createGateway(), RUNTIME)).rejects.toThrow(
      /900,50 del 31\/05\/2026.*error 2053/,
    );
    await expect(
      service.resolve({ ...INPUT, exchangeRate: 1000, exportType: 1, sameCurrency: true }, createGateway(), RUNTIME),
    ).rejects.toThrow(/Con `--misma-moneda`.*error 1604/);
  });

  it('frena antes lo que ARCA rechaza: incoterm (1640, 1641), fecha de pago (1674), unidad 99 (1775) y largos', async () => {
    const reject = (input: Partial<ExportVoucherInput>) =>
      expect(service.resolve({ ...INPUT, ...input }, createGateway(), RUNTIME)).rejects.toThrow();

    await reject({ exportType: 1, incoterm: undefined });
    await expect(
      service.resolve({ ...INPUT, incoterm: undefined, incotermDescription: 'Puerto' }, createGateway(), RUNTIME),
    ).rejects.toThrow(/error 1641/);
    await expect(service.resolve({ ...INPUT, paymentDate: '31/05/2026' }, createGateway(), RUNTIME)).rejects.toThrow(
      /error 1674/,
    );
    await expect(
      service.resolve(
        { ...INPUT, items: [{ description: 'Descuento', quantity: 1, unit: 99, unitPrice: 1500 }] },
        createGateway({ getUnits: vi.fn(async () => [{ id: 99, name: 'bonificación' }]) }),
        RUNTIME,
      ),
    ).rejects.toThrow(/error 1775/);
    await reject({ clientName: 'a'.repeat(201) });
    await reject({ voucherNumber: 100_000_000 });
    await reject({ pointOfSale: 99_999 });
  });

  it('valida los datos obligatorios antes de ir a ARCA', async () => {
    const gateway = createGateway();

    await expect(service.resolve({ ...INPUT, clientName: undefined }, gateway, RUNTIME)).rejects.toThrow(/--cliente/);
    await expect(service.resolve({ ...INPUT, destinationCountry: undefined }, gateway, RUNTIME)).rejects.toThrow(
      /--pais-destino/,
    );
    await expect(service.resolve({ ...INPUT, amount: 1000 }, gateway, RUNTIME)).rejects.toThrow(
      /no coincide con `--monto`/,
    );
    expect(gateway.getDestinationCountries).not.toHaveBeenCalled();
  });

  it('rechaza un monto 0 o negativo y pide el domicilio, sin ir a ARCA (TEST-16)', async () => {
    const gateway = createGateway();

    await expect(service.resolve({ ...INPUT, amount: 0 }, gateway, RUNTIME)).rejects.toThrow(
      /Falta el monto total o no es válido/,
    );
    await expect(service.resolve({ ...INPUT, amount: -1500 }, gateway, RUNTIME)).rejects.toThrow(
      /Falta el monto total o no es válido/,
    );
    await expect(service.resolve({ ...INPUT, clientAddress: ' ' }, gateway, RUNTIME)).rejects.toThrow(
      /--domicilio-cliente/,
    );
    expect(gateway.getDestinationCountries).not.toHaveBeenCalled();
    expect(gateway.getLastVoucherNumber).not.toHaveBeenCalled();
  });

  it('en servicios en pesos no consulta la cotizacion (TEST-16)', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve({ ...INPUT, currencyCode: 'PES' }, gateway, RUNTIME);

    expect(resolved.payload).toMatchObject({ Moneda_ctz: 1, Moneda_Id: 'PES' });
    expect(gateway.getQuotations).not.toHaveBeenCalled();
  });

  it('rechaza una fecha de mas de 5 dias antes o despues de hoy (error 1500)', async () => {
    await expect(service.resolve({ ...INPUT, voucherDate: '07/06/2026' }, createGateway(), RUNTIME)).rejects.toThrow(
      /error 1500/,
    );
    await expect(service.resolve({ ...INPUT, voucherDate: '26/05/2026' }, createGateway(), RUNTIME)).rejects.toThrow(
      /error 1500/,
    );
  });

  it('acepta una fecha futura de hasta 5 dias, con la cotizacion del dia habil anterior a hoy y un aviso (1535)', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve({ ...INPUT, voucherDate: '03/06/2026' }, gateway, RUNTIME);

    expect(resolved.payload.Fecha_cbte).toBe('20260603');
    expect(gateway.getQuotations).toHaveBeenCalledWith('20260531');
    expect(resolved.warnings).toContainEqual(
      expect.stringMatching(/próximas facturas de exportación E del punto de venta 3 .*error 1535/),
    );
  });

  it('usa el punto de venta de la config y falla si no hay ninguno', async () => {
    const resolved = await service.resolve(INPUT, createGateway(), RUNTIME);

    expect(resolved.payload.Punto_vta).toBe(3);

    await expect(
      service.resolve(INPUT, createGateway(), {
        config: arcliConfigSchema.parse({ cuit: '20111111112', exportacion: { actividad: 620100 } }),
        cuit: 20111111112,
        environment: 'testing',
      }),
    ).rejects.toThrow(/--pv <numero>/);
  });
});

const TIMEOUT = 'connect ETIMEDOUT 10.0.0.1:443';

describe('ExportService.resolve: tablas que no responden (EXPO-13, ARQ-22)', () => {
  const service = new ExportService({ clock: { now: () => NOW } });
  const down = (error: Error = new Error(TIMEOUT)) => vi.fn().mockRejectedValue(error);
  /** Todo por codigo, sin nada que salga de las tablas. */
  const CODES: ExportVoucherInput = {
    ...INPUT,
    clientCountryCuit: 55000000050,
    destinationCountry: '203',
    exportType: 4,
    incoterm: undefined,
    items: [{ description: 'Servicio', quantity: 1, unit: 7, unitPrice: 1500 }],
  };
  const read = async (overrides: Partial<ExportGateway>, input: Partial<ExportVoucherInput> = {}) =>
    service.resolve({ ...CODES, currencyCode: 'ARS', ...input }, createGateway(overrides), RUNTIME);

  it.each<[string, Partial<ExportGateway>, Partial<ExportVoucherInput>, string]>([
    ['idioma por defecto', { getLanguages: down() }, {}, `idiomas de WSFEX (${TIMEOUT}): los nombres no se muestran.`],
    ['idioma escrito', { getLanguages: down() }, { language: 2 }, `idiomas de WSFEX (${TIMEOUT}): el idioma 2 va sin`],
    ['moneda local', { getCurrencies: down() }, {}, `monedas de WSFEX (${TIMEOUT}): los nombres no se muestran.`],
    [
      'moneda con la cotizacion de ARCA',
      { getCurrencies: down() },
      { currencyCode: 'USD' },
      `monedas de WSFEX (${TIMEOUT}): los nombres no se muestran.`,
    ],
    [
      'moneda con `--cm`',
      { getCurrencies: down() },
      { currencyCode: 'USD', exchangeRate: 900 },
      `monedas de WSFEX (${TIMEOUT}): la moneda USD va sin`,
    ],
    ['unidad por defecto', { getUnits: down() }, {}, `unidades de medida de WSFEX (${TIMEOUT}): los nombres`],
    [
      'unidad escrita',
      { getUnits: down() },
      { items: [{ description: 'x', quantity: 1, unit: 1, unitPrice: 1500 }] },
      `unidades de medida de WSFEX (${TIMEOUT}): la unidad 1 va sin`,
    ],
    [
      'incoterm',
      { getIncoterms: down() },
      { incoterm: 'fob', incotermDescription: 'A bordo' },
      `incoterms de WSFEX (${TIMEOUT}): el incoterm FOB va sin`,
    ],
    ['actividad', { getActivities: down() }, {}, `actividades de WSFEX (${TIMEOUT}): la actividad 620100 va sin`],
    [
      'CUIT de país escrito',
      { getDestinationCountryCuits: down() },
      {},
      `CUIT de países de WSFEX (${TIMEOUT}): el CUIT de país 55000000050 no se pudo comparar con el país. Revisalo antes de emitir.`,
    ],
  ])('%s: avisa y sigue, con los mismos datos', async (_case, gateway, input, warning) => {
    const ok = await read({}, input);
    const resolved = await read(gateway, input);

    expect(resolved.payload).toEqual(ok.payload);
    expect(resolved.warnings).toEqual([
      ...(ok.warnings ?? []),
      expect.stringContaining(`No se pudo consultar la tabla de ${warning}`),
    ]);
  });

  it.each<[string, Partial<ExportGateway>, Partial<ExportVoucherInput>]>([
    ['el país por nombre', { getDestinationCountries: down() }, { destinationCountry: 'brasil' }],
    ['el CUIT de país sin escribir', { getDestinationCountryCuits: down() }, { clientCountryCuit: undefined }],
    ['el país por código', { getDestinationCountries: down() }, {}],
    ['la descripción del incoterm', { getIncoterms: down() }, { incoterm: 'fob' }],
    [
      'la unidad por nombre',
      { getUnits: down() },
      { items: [{ description: 'x', quantity: 1, unit: 'unidad', unitPrice: 1500 }] },
    ],
    ['la cotización', { getQuotations: down() }, { currencyCode: 'USD' }],
  ])('corta con el error de la consulta si de ahí sale %s', async (_case, gateway, input) => {
    await expect(read(gateway, input)).rejects.toThrow(TIMEOUT);
  });

  it.each([
    new AppError('sin permiso', { code: 'WSFEX_SERVICE_NOT_AUTHORIZED' }),
    new Error('ns1:cms.cert.expired: Certificado expirado'),
    // Los textos del SDK y de lo que usa: tickets, PEM, node-forge, HTTP, programacion.
    new Error('Failed to create tickets directory: EACCES: permission denied'),
    new Error("Access denied to ticket file: '/t/ticket.json'"),
    new Error('Invalid access ticket format: Unexpected end of JSON input'),
    new Error('Invalid PEM formatted message. Check your cert.'),
    new Error('Cannot read public key. Unknown OID.'),
    new Error('Request failed with status code 503'),
    new Error('Invalid XML'),
    new TypeError("Cannot read properties of undefined (reading 'x')"),
    new Error('connect ETIMEDOUT wsaa.afip.gov.ar:443'),
    Object.assign(new Error('timeout of 30000ms exceeded'), { config: { url: 'https://wsaa.afip.gov.ar/ws' } }),
    Object.assign(new Error('ETIMEDOUT: connection timed out, read'), {
      code: 'ETIMEDOUT',
      path: '/t',
      syscall: 'read',
    }),
    new Error('ns1:coe.alreadyAuthenticated: El CEE ya posee un TA valido'),
    Object.assign(new Error("EACCES: permission denied, open 'x'"), { code: 'EACCES', path: 'x', syscall: 'open' }),
  ])('la autorización, el certificado y los tickets cortan: $message', async (error) => {
    await expect(read({ getLanguages: down(error) })).rejects.toBe(error);
    await expect(read({ getQuotations: down(error) }, { currencyCode: 'USD', exchangeRate: 900 })).rejects.toBe(error);
  });

  it('sin la cotizacion de aduana para comparar, en servicios avisa y sigue (2053)', async () => {
    const { payload, warnings } = await read(
      { getQuotations: down() },
      { currencyCode: 'USD', exchangeRate: 900, exportType: 2 },
    );

    expect(payload.Moneda_ctz).toBe(900);
    expect(warnings).toEqual([
      `No se pudo comparar la cotización con la de ARCA (${TIMEOUT}): la rechaza si no es la oficial del día hábil anterior (error 2053).`,
    ]);
  });

  it('con países ok y la red caída después, el segundo error corta con el primero: no se llega a emitir', async () => {
    const error = new Error(TIMEOUT);
    const rest = createGateway();
    const gateway: ExportGateway = {
      ...(Object.fromEntries(
        Object.keys(rest).map((name) => [name, down(new Error('socket hang up'))]),
      ) as unknown as ExportGateway),
      getDestinationCountries: rest.getDestinationCountries,
      getDestinationCountryCuits: down(error),
    };

    await expect(
      service.resolve(
        { ...CODES, currencyCode: 'USD', exchangeRate: 900, requestId: 100, voucherNumber: 5 },
        gateway,
        RUNTIME,
      ),
    ).rejects.toBe(error);
    expect(gateway.getLanguages).not.toHaveBeenCalled();
    expect(gateway.authorize).not.toHaveBeenCalled();
  });

  it('una tabla y un permiso sin conexión también cortan; dos errores de WSFEX, no', async () => {
    const answered = new AppError('ARCA devolvió un error', { code: 'ARCA_EXPORT_ERROR' });
    const permits = { exportType: 1, incoterm: 'fob', permits: ['P1'], permitsExisting: true } as const;

    await expect(
      read({ checkPermit: down(new Error('socket hang up')), getActivities: down() }, permits),
    ).rejects.toThrow(TIMEOUT);
    expect((await read({ getCurrencies: down(answered), getLanguages: down(answered) })).warnings).toHaveLength(2);
  });

  it('un error de WSFEX en una tabla se tolera, salvo el del token', async () => {
    const answered = new AppError('ARCA devolvió un error al consultar los idiomas: interno', {
      code: 'ARCA_EXPORT_ERROR',
    });
    const token = new AppError('ARCA devolvió un error al consultar los idiomas: ValidacionDeToken: No valido T/S', {
      code: 'ARCA_EXPORT_ERROR',
    });

    expect((await read({ getLanguages: down(answered) })).warnings).toEqual([expect.stringContaining('interno')]);
    await expect(read({ getLanguages: down(token) })).rejects.toBe(token);
  });

  it('corta sin seguir consultando', async () => {
    const getLanguages = vi.fn(async () => []);

    await expect(read({ getIncoterms: down(), getLanguages }, { incoterm: 'fob' })).rejects.toThrow(TIMEOUT);
    expect(getLanguages).not.toHaveBeenCalled();
  });

  it('varias unidades escritas: en plural', async () => {
    const { warnings } = await read(
      { getUnits: down() },
      {
        items: [1, 2].map((unit) => ({ description: 'x', quantity: 1, unit, unitPrice: 750 })),
      },
    );

    expect(warnings).toEqual([expect.stringContaining('las unidades 1, 2 van sin validar.')]);
  });

  it('lo heredado del asociado no es "sin validar"', async () => {
    const answered = new AppError('ARCA devolvió un error', { code: 'ARCA_EXPORT_ERROR' });
    const { warnings } = await service.resolve(
      { amount: 100, associatedVoucher: { number: 12 }, emit: true, voucherKind: EXPORT_CREDIT_NOTE_KIND },
      createGateway({
        getActivities: down(answered),
        getCurrencies: down(answered),
        getDestinationCountryCuits: down(answered),
        getLanguages: down(answered),
      }),
      RUNTIME,
    );

    expect(warnings?.join()).not.toContain('sin validar');
    expect(warnings).toHaveLength(3);
  });

  it('la fecha futura va despues de la cotizacion, como en A, B y C', async () => {
    const { warnings } = await read({}, { currencyCode: 'USD', voucherDate: '02/06/2026' });

    expect(warnings).toEqual([
      expect.stringContaining('cotización oficial'),
      expect.stringContaining('las próximas facturas de exportación E del punto de venta 3'),
    ]);
  });

  it.each([TIMEOUT, 'ns1:coe.notAuthorized: no', 'socket hang up'])(
    'con todo escrito y sin acceso (%s), no se llega a emitir',
    async (message) => {
      const error = new Error(message);
      const everything = createGateway();
      const gateway = Object.fromEntries(Object.keys(everything).map((name) => [name, down(error)])) as never;

      await expect(
        service.resolve(
          { ...CODES, currencyCode: 'USD', exchangeRate: 900, requestId: 100, voucherNumber: 5 },
          gateway,
          RUNTIME,
        ),
      ).rejects.toBe(error);
      expect((gateway as ExportGateway).authorize).not.toHaveBeenCalled();
    },
  );
});

describe('ExportService.resolve: notas E', () => {
  const service = new ExportService({ clock: { now: () => NOW } });
  const NOTE_INPUT: ExportVoucherInput = {
    amount: 500,
    associatedVoucher: { number: 12 },
    emit: false,
    voucherKind: EXPORT_CREDIT_NOTE_KIND,
    voucherNumber: 5,
  };

  it('en bienes y otros la nota va sin asociado, con los datos por flag (2047 solo en servicios)', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve(
      {
        ...INPUT,
        amount: 500,
        associatedVoucher: {},
        exportType: 1,
        items: undefined,
        voucherKind: EXPORT_CREDIT_NOTE_KIND,
        voucherNumber: 5,
      },
      gateway,
      RUNTIME,
    );

    expect(gateway.getVoucher).not.toHaveBeenCalled();
    expect(resolved.payload).not.toHaveProperty('Cmps_asoc');
    expect(resolved.payload).toMatchObject({ Cbte_Tipo: 21, Cliente: 'ACME LLC', Tipo_expo: 1 });
  });

  it('en servicios la nota sin `--ar` es error (2047), y con `--ac` sin `--ar` falta el numero', async () => {
    const gateway = createGateway();

    await expect(service.resolve({ ...NOTE_INPUT, associatedVoucher: undefined }, gateway, RUNTIME)).rejects.toThrow(
      /error 2047/,
    );
    await expect(
      service.resolve({ ...NOTE_INPUT, associatedVoucher: { shortcut: 'fe' }, exportType: 1 }, gateway, RUNTIME),
    ).rejects.toThrow(/Falta el número del comprobante asociado/);
    expect(gateway.getVoucher).not.toHaveBeenCalled();
  });

  it('arma la nota con el asociado, sin fecha de pago, CanMisMonExt ni permisos', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve(NOTE_INPUT, gateway, RUNTIME);

    expect(gateway.getVoucher).toHaveBeenCalledWith({ arcaType: 19, number: 12, pointOfSale: 3 });
    expect(gateway.getQuotations).not.toHaveBeenCalled();
    expect(resolved.voucherKind).toBe(EXPORT_CREDIT_NOTE_KIND);
    expect(resolved.payload).toMatchObject({
      Cbte_Tipo: 21,
      Cliente: 'ACME LLC',
      Cmps_asoc: { Cmp_asoc: [{ Cbte_cuit: 20111111112, Cbte_nro: 12, Cbte_punto_vta: 3, Cbte_tipo: 19 }] },
      Dst_cmp: 203,
      Moneda_ctz: 880.25,
      Moneda_Id: 'DOL',
      Permiso_existente: '',
      Tipo_expo: 2,
    });
    expect(resolved.payload).not.toHaveProperty('Fecha_pago');
    expect(resolved.payload).not.toHaveProperty('CanMisMonExt');
    expect(resolved.payload).not.toHaveProperty('Permisos');
    expect(resolved.display.associatedVoucher).toEqual({
      currencyCode: 'DOL',
      date: '20260520',
      displayName: 'Factura de exportación E',
      total: 1500,
    });
  });

  it('`--acuit` solo puede ser el CUIT emisor (2031), con o sin guiones', async () => {
    const withCuit = (cuit: string) => ({ ...NOTE_INPUT, associatedVoucher: { cuit, number: 12 } });
    const own = createGateway();

    for (const cuit of ['20111111112', '20-11111111-2']) {
      const { payload } = await service.resolve(withCuit(cuit), own, RUNTIME);

      expect(payload.Cmps_asoc).toEqual({
        Cmp_asoc: [{ Cbte_cuit: 20111111112, Cbte_nro: 12, Cbte_punto_vta: 3, Cbte_tipo: 19 }],
      });
    }

    expect(vi.mocked(own.getVoucher).mock.calls).toEqual([
      [{ arcaType: 19, number: 12, pointOfSale: 3 }],
      [{ arcaType: 19, number: 12, pointOfSale: 3 }],
    ]);

    const other = createGateway();

    await expect(service.resolve(withCuit('30709965812'), other, RUNTIME)).rejects.toThrow(
      'En las notas E el comprobante asociado tiene que ser tuyo (CUIT 20111111112): ARCA rechaza otro CUIT (error 2031). Sacá `--acuit`.',
    );
    expect(other.getVoucher).not.toHaveBeenCalled();
  });

  it('una nota de debito usa el tipo 20', async () => {
    const resolved = await service.resolve(
      { ...NOTE_INPUT, voucherKind: EXPORT_DEBIT_NOTE_KIND },
      createGateway(),
      RUNTIME,
    );

    expect(resolved.payload.Cbte_Tipo).toBe(20);
  });

  it('valida lo local antes de consultar el asociado', async () => {
    const gateway = createGateway();

    await expect(service.resolve({ ...NOTE_INPUT, associatedVoucher: {} }, gateway, RUNTIME)).rejects.toThrow(/--ar/);
    await expect(service.resolve({ ...NOTE_INPUT, paymentDate: '01/06' }, gateway, RUNTIME)).rejects.toThrow(
      /error 1673/,
    );
    expect(gateway.getVoucher).not.toHaveBeenCalled();
  });

  it('el CUIT del asociado es el del perfil, no el de la config (ARQ-18)', async () => {
    const runtime = {
      ...RUNTIME,
      config: arcliConfigSchema.parse({ exportacion: { actividad: 620100 }, puntoVentaPorDefecto: 3 }),
    };
    const { payload } = await service.resolve(NOTE_INPUT, createGateway(), runtime);

    expect(payload.Cmps_asoc?.Cmp_asoc[0]?.Cbte_cuit).toBe(20111111112);
  });

  it('falla si ARCA no tiene el asociado', async () => {
    const gateway = createGateway({ getVoucher: vi.fn(async () => null) });

    await expect(service.resolve(NOTE_INPUT, gateway, RUNTIME)).rejects.toThrow(
      /ARCA no tiene la factura de exportación E 00003-00000012/,
    );
  });

  it('compara la nota contra el asociado antes de emitir', async () => {
    await expect(service.resolve({ ...NOTE_INPUT, amount: 2000 }, createGateway(), RUNTIME)).rejects.toThrow(
      /no puede superar el total/,
    );
  });
});

describe('ExportService.preview y execute', () => {
  const service = new ExportService({ clock: { now: () => NOW } });

  it('la vista previa no llama a authorize', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve(INPUT, gateway, RUNTIME);
    const result = service.preview(resolved, RUNTIME, ['aviso']);

    expect(gateway.authorize).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dryRun: true, environment: 'testing', warnings: ['aviso'] });
    expect(result.response.cae).toBeNull();
  });

  it('execute manda el payload y devuelve el CAE', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve(INPUT, gateway, RUNTIME);
    const result = await service.execute({ gateway, resolved, runtime: RUNTIME });

    expect(gateway.authorize).toHaveBeenCalledWith(resolved.payload);
    expect(result).toMatchObject({ dryRun: false, environment: 'testing' });
    expect(result.response).toMatchObject({ cae: '75123456789012', status: 'aprobado' });
  });

  it('si falla la llamada que emite, es EMISSION_UNCERTAIN con el número y la solicitud para reintentar', async () => {
    const gateway = createGateway({
      authorize: vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    });
    const resolved = await service.resolve(INPUT, gateway, RUNTIME);
    const { Cbte_nro: numero, Id: idSolicitud, Punto_vta: pv } = resolved.payload;
    const run = service.execute({ gateway, resolved, runtime: RUNTIME });

    await expect(run).rejects.toBeInstanceOf(EmissionUncertainError);
    await expect(run).rejects.toMatchObject({
      code: 'EMISSION_UNCERTAIN',
      details: { causa: 'socket hang up', idSolicitud, numero },
      message: 'No se pudo confirmar la emisión: socket hang up',
      suggestion: expect.stringContaining(`--numero ${numero} --id-solicitud ${idSolicitud} --pv ${pv} --testing`),
      verifyCommand: `arcli consultar fe ${numero} --pv ${pv} --testing`,
    });
  });

  it('un error al resolver (antes de emitir) no es EMISSION_UNCERTAIN', async () => {
    const gateway = createGateway({
      getLastRequestId: vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    });

    await expect(service.resolve(INPUT, gateway, RUNTIME)).rejects.not.toBeInstanceOf(EmissionUncertainError);
  });
});
