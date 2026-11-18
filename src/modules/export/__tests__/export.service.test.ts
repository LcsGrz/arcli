import { describe, expect, it, vi } from 'vitest';

import type { IFEXAuthorizeOutput } from '../../../services/arca/arca-sdk.types';
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
  environment: 'testing' as const,
};

function createGateway(overrides: Partial<ExportGateway> = {}): ExportGateway {
  return {
    authorize: vi.fn(async (): Promise<IFEXAuthorizeOutput> => ({
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
    })),
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
  const service = new ExportService();

  it('arma el payload con la numeracion, la cotizacion y las tablas de ARCA', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve({ ...INPUT, exportType: 1 }, gateway, RUNTIME, NOW);

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
    const resolved = await service.resolve({ ...INPUT, exportType: 1 }, gateway, RUNTIME, NOW);

    expect(gateway.checkPermit).not.toHaveBeenCalled();
    expect(resolved.display.permitChecks).toBeUndefined();
  });

  it('consulta cada permiso de embarque con el destino y guarda lo que contesto ARCA', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve(
      { ...INPUT, exportType: 1, permits: ['P1', 'P2'], permitsExisting: true },
      gateway,
      RUNTIME,
      NOW,
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
      service.resolve({ ...INPUT, exportType: 1, permits: ['P1'], permitsExisting: true }, gateway, RUNTIME, NOW),
    ).rejects.toThrow('ARCA dice que el permiso de embarque P1 no es válido para el destino 203 - Brasil');
    expect(gateway.authorize).not.toHaveBeenCalled();
  });

  it('si FEXCheck_Permiso falla, sigue con un aviso', async () => {
    const gateway = createGateway({ checkPermit: vi.fn().mockRejectedValue(new Error('timeout')) });
    const resolved = await service.resolve(
      { ...INPUT, exportType: 1, permits: ['P1'], permitsExisting: true },
      gateway,
      RUNTIME,
      NOW,
    );

    expect(resolved.display.permitChecks).toEqual([{ permit: 'P1', status: 'sin-verificar' }]);
    expect(resolved.warnings).toContain(
      'No se pudo verificar el permiso de embarque P1 en ARCA (timeout): revisalo antes de emitir.',
    );
  });

  it('en una exportacion de servicios deja vacio Permiso_existente, como pide ARCA (1550)', async () => {
    const resolved = await service.resolve({ ...INPUT, exportType: 2 }, createGateway(), RUNTIME, NOW);

    expect(resolved.payload.Permiso_existente).toBe('');
    expect(resolved.payload).not.toHaveProperty('Permisos');
  });

  it('en servicios manda la fecha de pago de `--fecha-pago` sin avisos', async () => {
    const resolved = await service.resolve(
      { ...INPUT, exportType: 2, paymentDate: '15/06/2026' },
      createGateway(),
      RUNTIME,
      NOW,
    );

    expect(resolved.payload.Fecha_pago).toBe('20260615');
    expect(resolved.warnings).toEqual([]);
  });

  it('en bienes no manda la fecha de pago (ARCA la rechaza, 1673) y avisa si vino `--fecha-pago`', async () => {
    const withoutDate = await service.resolve({ ...INPUT, exportType: 1 }, createGateway(), RUNTIME, NOW);
    const withDate = await service.resolve(
      { ...INPUT, exportType: 1, paymentDate: '15/06/2026' },
      createGateway(),
      RUNTIME,
      NOW,
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
    const resolved = await service.resolve({ ...INPUT, currencyCode: undefined }, gateway, RUNTIME, NOW);

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
    await service.resolve({ ...INPUT, exportType: 1 }, gateway, RUNTIME, NOW);
    expect(gateway.getQuotations).toHaveBeenCalledWith('20260601');

    const backdated = createGateway();
    const resolved = await service.resolve(
      { ...INPUT, exportType: 1, voucherDate: '29/05/2026' },
      backdated,
      RUNTIME,
      NOW,
    );

    expect(resolved.payload.Fecha_cbte).toBe('20260529');
    expect(backdated.getQuotations).toHaveBeenCalledWith('20260529');
  });

  it('en servicios pide la cotizacion del dia anterior a la fecha del comprobante (error 2053)', async () => {
    const gateway = createGateway();

    await service.resolve({ ...INPUT, currencyCode: undefined }, gateway, RUNTIME, NOW);
    expect(gateway.getQuotations).toHaveBeenCalledWith('20260531');

    // El caso del rechazo en testing: una E de servicios del 16/11 tiene que ir con la del 15/11.
    const backdated = createGateway();
    const resolved = await service.resolve(
      { ...INPUT, voucherDate: '16/11/2026' },
      backdated,
      RUNTIME,
      new Date('2026-11-18T15:00:00Z'),
    );

    expect(backdated.getQuotations).toHaveBeenCalledWith('20261115');
    expect(resolved.payload.Moneda_ctz).toBe(900.5);
    expect(resolved.warnings).toEqual([]);
  });

  it('en servicios, un lunes usa la del ultimo dia habil y avisa de que dia es', async () => {
    // WSFEX devuelve la ultima publicada hasta el dia pedido: el domingo trae la del viernes.
    const gateway = createGateway({
      getQuotations: vi.fn(async () => [{ code: 'DOL', date: '20261113', rate: 1179.27 }]),
    });
    const resolved = await service.resolve(INPUT, gateway, RUNTIME, new Date('2026-11-16T15:00:00Z'));

    expect(gateway.getQuotations).toHaveBeenCalledWith('20261115');
    expect(resolved.payload.Moneda_ctz).toBe(1179.27);
    expect(resolved.warnings).toEqual([
      'En servicios ARCA exige la cotización de DOL del día hábil anterior a la fecha del comprobante (error 2053): se usa la del 13/11/2026 (1.179,27), la última que publicó hasta el 15/11/2026.',
    ]);
  });

  it('con --misma-moneda tambien pide la del dia anterior, en bienes y otros', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve({ ...INPUT, exportType: 1, sameCurrency: true }, gateway, RUNTIME, NOW);

    expect(gateway.getQuotations).toHaveBeenCalledWith('20260531');
    expect(resolved.payload).toMatchObject({ CanMisMonExt: 'S', Moneda_ctz: 900.5 });
  });

  it('en bienes usa la ultima cotizacion publicada y avisa de que dia es', async () => {
    const gateway = createGateway({
      getQuotations: vi.fn(async () => [{ code: 'DOL', date: '20260529', rate: 895 }]),
    });
    const resolved = await service.resolve({ ...INPUT, currencyCode: undefined, exportType: 1 }, gateway, RUNTIME, NOW);

    expect(resolved.payload.Moneda_ctz).toBe(895);
    expect(resolved.warnings).toEqual([
      'ARCA no publicó la cotización de DOL del 01/06/2026: se usa la del 29/05/2026 (895). Para usar otra, `--cotizacion-moneda`.',
    ]);
  });

  it('no avisa nada cuando la cotizacion es la del dia pedido', async () => {
    const resolved = await service.resolve(INPUT, createGateway(), RUNTIME, NOW);

    expect(resolved.warnings).toEqual([]);
  });

  it('falla con las monedas que si tienen cotizacion cuando ARCA no cotiza la pedida', async () => {
    const gateway = createGateway({
      getQuotations: vi.fn(async () => [{ code: '060', date: '20260531', rate: 1300 }]),
    });

    await expect(service.resolve(INPUT, gateway, RUNTIME, NOW)).rejects.toThrow(
      /no informó la cotización de DOL para el 31\/05\/2026\. Las monedas con cotización son 060\./,
    );
    await expect(service.resolve(INPUT, gateway, RUNTIME, NOW)).rejects.toThrow(/--cotizacion-moneda/);
  });

  it('sin cotizacion para la moneda (el gateway descarta las de 0) es ARCA_QUOTATION_ERROR', async () => {
    const gateway = createGateway({ getQuotations: vi.fn(async () => []) });

    await expect(service.resolve(INPUT, gateway, RUNTIME, NOW)).rejects.toMatchObject({
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
      NOW,
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
      service.resolve({ ...INPUT, clientTaxId: undefined, destinationCountry: '415' }, gateway, RUNTIME, NOW),
    ).rejects.toThrow(/ARCA pide el CUIT del país o el ID impositivo del cliente \(error 1580\)/);
    expect(gateway.authorize).not.toHaveBeenCalled();
  });

  it('respeta la moneda, el tipo y la forma de pago que vienen por flag', async () => {
    const resolved = await service.resolve(
      { ...INPUT, currencyCode: 'ARS', exportType: 1, paymentTerms: 'Carta de credito' },
      createGateway(),
      RUNTIME,
      NOW,
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
    const resolved = await service.resolve(
      { ...INPUT, activity: 46201, sameCurrency: true },
      createGateway(),
      RUNTIME,
      NOW,
    );

    expect(resolved.payload.Actividades).toEqual({ Actividad: [{ Id: 46201 }] });
    // CanMisMonExt es el campo de WSFEX que dice que el pago se cancela en la moneda extranjera del comprobante.
    expect(resolved.payload.CanMisMonExt).toBe('S');
  });

  it('corta antes de emitir si la actividad no esta en la tabla de WSFEX (ARCA la rechaza con 2105)', async () => {
    const gateway = createGateway();

    await expect(service.resolve({ ...INPUT, activity: 620900 }, gateway, RUNTIME, NOW)).rejects.toThrow(
      /La actividad 620900 no está en la tabla de actividades de WSFEX.*Las que empiezan con 620 son 620100/,
    );
    expect(gateway.authorize).not.toHaveBeenCalled();
  });

  it('pide la actividad antes de ir a ARCA si no viene por flag ni por config', async () => {
    const gateway = createGateway();
    const runtime = { ...RUNTIME, config: arcliConfigSchema.parse({ cuit: '20111111112', puntoVentaPorDefecto: 3 }) };

    await expect(service.resolve(INPUT, gateway, runtime, NOW)).rejects.toThrow(/Falta la actividad de exportación/);
    expect(gateway.getDestinationCountries).not.toHaveBeenCalled();
  });

  it('rechaza un monto con más de 2 decimales, como A, B y C, en lugar de redondearlo', async () => {
    await expect(
      service.resolve({ ...INPUT, amount: 1500.005, items: undefined }, createGateway(), RUNTIME, NOW),
    ).rejects.toThrow(/más de 2 decimales/);
  });

  it('no consulta el ID de solicitud si el usuario lo informa', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve({ ...INPUT, requestId: 100, voucherNumber: 5 }, gateway, RUNTIME, NOW);

    expect(resolved.payload.Cbte_nro).toBe(5);
    expect(resolved.payload.Id).toBe(100);
    expect(gateway.getLastRequestId).not.toHaveBeenCalled();
  });

  it('sin --numero usa el siguiente al último que tiene ARCA para ese tipo y punto de venta', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve({ ...INPUT, voucherNumber: undefined }, gateway, RUNTIME, NOW);

    expect(gateway.getLastVoucherNumber).toHaveBeenCalledWith(19, 3);
    expect(resolved.payload.Cbte_nro).toBe(42);
  });

  it('con --numero no consulta el último', async () => {
    const gateway = createGateway();

    await service.resolve(INPUT, gateway, RUNTIME, NOW);

    expect(gateway.getLastVoucherNumber).not.toHaveBeenCalled();
  });

  it('no consulta la cotizacion si viene por flag', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve({ ...INPUT, exchangeRate: 1000 }, gateway, RUNTIME, NOW);

    expect(resolved.payload.Moneda_ctz).toBe(1000);
    expect(gateway.getQuotations).not.toHaveBeenCalled();
  });

  it('valida los datos obligatorios antes de ir a ARCA', async () => {
    const gateway = createGateway();

    await expect(service.resolve({ ...INPUT, clientName: undefined }, gateway, RUNTIME, NOW)).rejects.toThrow(
      /--cliente/,
    );
    await expect(service.resolve({ ...INPUT, destinationCountry: undefined }, gateway, RUNTIME, NOW)).rejects.toThrow(
      /--pais-destino/,
    );
    await expect(service.resolve({ ...INPUT, amount: 1000 }, gateway, RUNTIME, NOW)).rejects.toThrow(
      /no coincide con `--monto`/,
    );
    expect(gateway.getDestinationCountries).not.toHaveBeenCalled();
  });

  it('rechaza una fecha de mas de 5 dias antes o despues de hoy (error 1500)', async () => {
    await expect(
      service.resolve({ ...INPUT, voucherDate: '07/06/2026' }, createGateway(), RUNTIME, NOW),
    ).rejects.toThrow(/error 1500/);
    await expect(
      service.resolve({ ...INPUT, voucherDate: '26/05/2026' }, createGateway(), RUNTIME, NOW),
    ).rejects.toThrow(/error 1500/);
  });

  it('acepta una fecha futura de hasta 5 dias, con la cotizacion del dia habil anterior a hoy y un aviso (1535)', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve({ ...INPUT, voucherDate: '03/06/2026' }, gateway, RUNTIME, NOW);

    expect(resolved.payload.Fecha_cbte).toBe('20260603');
    expect(gateway.getQuotations).toHaveBeenCalledWith('20260531');
    expect(resolved.warnings).toContainEqual(
      expect.stringMatching(/próximas facturas E del punto de venta 3 .*error 1535/),
    );
  });

  it('usa el punto de venta de la config y falla si no hay ninguno', async () => {
    const resolved = await service.resolve(INPUT, createGateway(), RUNTIME, NOW);

    expect(resolved.payload.Punto_vta).toBe(3);

    await expect(
      service.resolve(
        INPUT,
        createGateway(),
        {
          config: arcliConfigSchema.parse({ cuit: '20111111112', exportacion: { actividad: 620100 } }),
          environment: 'testing',
        },
        NOW,
      ),
    ).rejects.toThrow(/--pv <numero>/);
  });
});

describe('ExportService.resolve: notas E', () => {
  const service = new ExportService();
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
      NOW,
    );

    expect(gateway.getVoucher).not.toHaveBeenCalled();
    expect(resolved.payload).not.toHaveProperty('Cmps_asoc');
    expect(resolved.payload).toMatchObject({ Cbte_Tipo: 21, Cliente: 'ACME LLC', Tipo_expo: 1 });
  });

  it('en servicios la nota sin `--ar` es error (2047), y con `--ac` sin `--ar` falta el numero', async () => {
    const gateway = createGateway();

    await expect(
      service.resolve({ ...NOTE_INPUT, associatedVoucher: undefined }, gateway, RUNTIME, NOW),
    ).rejects.toThrow(/error 2047/);
    await expect(
      service.resolve({ ...NOTE_INPUT, associatedVoucher: { shortcut: 'fe' }, exportType: 1 }, gateway, RUNTIME, NOW),
    ).rejects.toThrow(/Falta el número del comprobante asociado/);
    expect(gateway.getVoucher).not.toHaveBeenCalled();
  });

  it('arma la nota con el asociado, sin fecha de pago, CanMisMonExt ni permisos', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve(NOTE_INPUT, gateway, RUNTIME, NOW);

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

  it('una nota de debito usa el tipo 20', async () => {
    const resolved = await service.resolve(
      { ...NOTE_INPUT, voucherKind: EXPORT_DEBIT_NOTE_KIND },
      createGateway(),
      RUNTIME,
      NOW,
    );

    expect(resolved.payload.Cbte_Tipo).toBe(20);
  });

  it('valida lo local antes de consultar el asociado', async () => {
    const gateway = createGateway();

    await expect(service.resolve({ ...NOTE_INPUT, associatedVoucher: {} }, gateway, RUNTIME, NOW)).rejects.toThrow(
      /--ar/,
    );
    await expect(service.resolve({ ...NOTE_INPUT, paymentDate: '01/06' }, gateway, RUNTIME, NOW)).rejects.toThrow(
      /error 1673/,
    );
    expect(gateway.getVoucher).not.toHaveBeenCalled();
  });

  it('falla si ARCA no tiene el asociado', async () => {
    const gateway = createGateway({ getVoucher: vi.fn(async () => null) });

    await expect(service.resolve(NOTE_INPUT, gateway, RUNTIME, NOW)).rejects.toThrow(
      /ARCA no tiene la factura de exportación E 00003-00000012/,
    );
  });

  it('compara la nota contra el asociado antes de emitir', async () => {
    await expect(service.resolve({ ...NOTE_INPUT, amount: 2000 }, createGateway(), RUNTIME, NOW)).rejects.toThrow(
      /no puede superar el total/,
    );
  });
});

describe('ExportService.preview y execute', () => {
  const service = new ExportService();

  it('la vista previa no llama a authorize', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve(INPUT, gateway, RUNTIME, NOW);
    const result = service.preview(resolved, RUNTIME, ['aviso']);

    expect(gateway.authorize).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dryRun: true, environment: 'testing', warnings: ['aviso'] });
    expect(result.response.cae).toBeNull();
  });

  it('execute manda el payload y devuelve el CAE', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve(INPUT, gateway, RUNTIME, NOW);
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
    const resolved = await service.resolve(INPUT, gateway, RUNTIME, NOW);
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

    await expect(service.resolve(INPUT, gateway, RUNTIME, NOW)).rejects.not.toBeInstanceOf(EmissionUncertainError);
  });
});
