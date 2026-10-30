import type { IFEXAuthorizeOutput } from '@arcasdk/core/lib/application/dto/fex';
import { describe, expect, it, vi } from 'vitest';

import { arcliConfigSchema } from '../../config/config.schemas';
import { ExportService } from '../export.service';
import type { ExportGateway, ExportVoucherInput } from '../export.types';

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
    getQuotations: vi.fn(async () => [{ code: 'DOL', date: '20260601', rate: 900.5 }]),
    getUnits: vi.fn(async () => [
      { id: 1, name: 'Kilogramo' },
      { id: 7, name: 'Unidad' },
    ]),
    ...overrides,
  };
}

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
      Fecha_pago: '20260601',
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
      countryName: 'Brasil',
      currencyName: 'Dólar Estadounidense',
      incotermName: 'Free on Board',
      languageName: undefined,
      unitNames: { 1: 'Kilogramo', 7: 'Unidad' },
    });
    expect(gateway.getQuotations).toHaveBeenCalledWith('20260601');
    expect(gateway.getLanguages).not.toHaveBeenCalled();
    // Sin permisos de embarque el Cmp no lleva Permisos: ARCA lo rechaza (1720) con Permiso_existente = N.
    expect(resolved.payload).not.toHaveProperty('Permisos');
  });

  it('en una exportacion de servicios deja vacio Permiso_existente, como pide ARCA (1550)', async () => {
    const resolved = await service.resolve({ ...INPUT, exportType: 2 }, createGateway(), RUNTIME, NOW);

    expect(resolved.payload.Permiso_existente).toBe('');
    expect(resolved.payload).not.toHaveProperty('Permisos');
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
    expect(gateway.getQuotations).toHaveBeenCalledWith('20260601');
  });

  it('pide la cotizacion con la fecha del comprobante en yyyymmdd (Fecha_CTZ)', async () => {
    const gateway = createGateway();

    // Sin --fecha la cotizacion es la del dia del comprobante (hoy en Argentina): la consulta va en yyyy-mm-dd.
    await service.resolve({ ...INPUT, currencyCode: undefined }, gateway, RUNTIME, NOW);
    expect(gateway.getQuotations).toHaveBeenCalledWith('20260601');

    const backdated = createGateway();
    const resolved = await service.resolve({ ...INPUT, voucherDate: '18/03/2026' }, backdated, RUNTIME, NOW);

    expect(resolved.payload.Fecha_cbte).toBe('20260318');
    expect(backdated.getQuotations).toHaveBeenCalledWith('20260318');
  });

  it('usa la ultima cotizacion publicada y avisa de que dia es', async () => {
    const gateway = createGateway({
      getQuotations: vi.fn(async () => [{ code: 'DOL', date: '20260529', rate: 895 }]),
    });
    const resolved = await service.resolve({ ...INPUT, currencyCode: undefined }, gateway, RUNTIME, NOW);

    expect(resolved.payload.Moneda_ctz).toBe(895);
    expect(resolved.warnings).toEqual([
      'ARCA no publicó la cotización de DOL del 01/06/2026: se usa la del 29/05/2026 (895). Para usar otra, --cotizacion-moneda.',
    ]);
  });

  it('no avisa nada cuando la cotizacion es la del dia del comprobante', async () => {
    const resolved = await service.resolve(INPUT, createGateway(), RUNTIME, NOW);

    expect(resolved.warnings).toEqual([]);
  });

  it('falla con las monedas que si tienen cotizacion cuando ARCA no cotiza la pedida', async () => {
    const gateway = createGateway({
      getQuotations: vi.fn(async () => [{ code: '060', date: '20260601', rate: 1300 }]),
    });

    await expect(service.resolve(INPUT, gateway, RUNTIME, NOW)).rejects.toThrow(
      /no informó la cotización de DOL para el 01\/06\/2026\. Las monedas con cotización son 060\./,
    );
    await expect(service.resolve(INPUT, gateway, RUNTIME, NOW)).rejects.toThrow(/--cotizacion-moneda/);
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

  it('no consulta el ID de solicitud si el usuario lo informa', async () => {
    const gateway = createGateway();
    const resolved = await service.resolve({ ...INPUT, requestId: 100, voucherNumber: 5 }, gateway, RUNTIME, NOW);

    expect(resolved.payload.Cbte_nro).toBe(5);
    expect(resolved.payload.Id).toBe(100);
    expect(gateway.getLastRequestId).not.toHaveBeenCalled();
  });

  it('pide --numero antes de ir a ARCA: el SDK no deja consultar el ultimo comprobante E', async () => {
    const gateway = createGateway();

    await expect(service.resolve({ ...INPUT, voucherNumber: undefined }, gateway, RUNTIME, NOW)).rejects.toThrow(
      /Falta el número del comprobante. Usá --numero/,
    );
    expect(gateway.getDestinationCountries).not.toHaveBeenCalled();
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
      /no coincide con --monto/,
    );
    expect(gateway.getDestinationCountries).not.toHaveBeenCalled();
  });

  it('rechaza una fecha futura', async () => {
    await expect(
      service.resolve({ ...INPUT, voucherDate: '10/06/2026' }, createGateway(), RUNTIME, NOW),
    ).rejects.toThrow(/no puede ser futura/);
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
    ).rejects.toThrow(/--punto-venta/);
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
});
