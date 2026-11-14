import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import type { ExportGateway, ExportIssuedVoucher } from '../../../modules/export/export.types';
import { BACK } from '../../../modules/interactive/wizard';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import type { IFEXAuthorizeOutput } from '../../../services/arca/arca-sdk.types';
import { stripAnsi } from '../../../ui';
import { attachExportPdf } from '../../commands/export.command.pdf';
import { runExportRepeatFlow } from '../export-repeat.flow';
import type { Choice } from '../prompts';
import type { InteractiveSession } from '../session';

import { createScript } from './script';

let script = createScript([]);

/** Una factura E de bienes en dólares, cobrada en dólares, con dos ítems y FOB. */
const INVOICE: ExportIssuedVoucher = {
  activities: [620100],
  arcaType: 19,
  cae: '76443017205075',
  clientAddress: '123 Main St, Miami, FL',
  clientCountryCuit: 55000002126,
  clientName: 'ACME LLC',
  clientTaxId: '12-3456789',
  currencyCode: 'DOL',
  date: '20261030',
  destinationCountry: 212,
  exchangeRate: 1174.605,
  exportType: 1,
  incoterm: 'FOB',
  incotermDescription: 'FOB',
  items: [
    { description: 'Bienes varios', discount: 0, quantity: 2, total: 1000, unit: 1, unitPrice: 500 },
    { description: 'Flete', discount: 0, quantity: 1, total: 500, unit: 7, unitPrice: 500 },
  ],
  number: 1,
  paymentTerms: 'Carta de crédito',
  pointOfSale: 4,
  result: 'A',
  sameCurrency: true,
  total: 1500,
};

const gateway: ExportGateway = {
  authorize: vi.fn(async (): Promise<IFEXAuthorizeOutput> => ({
    FEXAuthorizeResult: {
      FEXErr: { ErrCode: 0, ErrMsg: 'OK' },
      FEXEvents: { EventCode: 0, EventMsg: '' },
      FEXResultAuth: {
        Cae: '76123456789012',
        Cbte_nro: 2,
        Cbte_tipo: 19,
        Cuit: 20111111112,
        Fch_cbte: '20261114',
        Fch_venc_Cae: '20261124',
        Id: 1,
        Motivos_Obs: '',
        Punto_vta: 4,
        Reproceso: 'N',
        Resultado: 'A',
      },
    },
  })),
  getActivities: async () => [{ id: 620100, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA' }],
  getCurrencies: async () => [{ code: 'DOL', name: 'Dólar Estadounidense' }],
  getDestinationCountries: async () => [{ code: 212, name: 'ESTADOS UNIDOS' }],
  getDestinationCountryCuits: async () => [{ countryName: 'ESTADOS UNIDOS - Persona Jurídica', cuit: 55000002126 }],
  getIncoterms: async () => [{ code: 'FOB', name: 'FOB' }],
  getLanguages: async () => [],
  getLastRequestId: async () => 0,
  getLastVoucherNumber: vi.fn(async () => 1),
  getQuotations: async () => [{ code: 'DOL', date: '20261114', rate: 1450.25 }],
  getUnits: async () => [
    { id: 1, name: 'kilogramos' },
    { id: 7, name: 'unidades' },
  ],
  getVoucher: vi.fn(async (query) => (query.number === 1 && query.pointOfSale === 4 ? INVOICE : null)),
};

const confirmFromScript = (message: string, yesLabel: string, noLabel = 'Cancelar') =>
  script.chooseStep(message, [
    { name: yesLabel, value: true },
    { name: noLabel, value: false },
  ]);

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseOne: <T>(message: string, choices: ReadonlyArray<Choice<T>>) => script.chooseStep(message, choices),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  chooseStepWhileLoading: (...args: Parameters<typeof script.chooseStepWhileLoading>) =>
    script.chooseStepWhileLoading(...args),
  confirm: (message: string, yesLabel: string, noLabel?: string) => confirmFromScript(message, yesLabel, noLabel),
  eraseLastAnswer: () => undefined,
  fitPageSize: () => 12,
}));

vi.mock('../../../services/arca/arca-client.factory', () => ({
  ArcaClientFactory: class {
    public createExportGateway() {
      return gateway;
    }
  },
}));

vi.mock('../../commands/export.command.pdf', () => ({
  attachExportPdf: vi.fn(async (result: unknown) => result),
}));

function createSession(config: Record<string, unknown> = {}): InteractiveSession {
  return {
    arca: {} as never,
    billingGateway: { createVoucher: vi.fn(), getNextVoucherNumber: vi.fn(), getQuotation: vi.fn() },
    historyGateway: { getLastNumber: vi.fn(), getVoucher: vi.fn() },
    runtime: {
      config: arcliConfigSchema.parse({ cuit: '20111111112', puntoVentaPorDefecto: 4, ...config }),
      environment: 'testing',
      pointOfSale: 4,
    } as unknown as ResolvedArcaRuntime,
    service: {} as never,
  };
}

function printed(): string {
  return stripAnsi(
    vi
      .mocked(process.stdout.write)
      .mock.calls.map(([chunk]) => String(chunk))
      .join(''),
  );
}

describe('runExportRepeatFlow', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(gateway.authorize).mockClear();
    vi.mocked(attachExportPdf).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  it('copia cliente, destino, moneda, incoterm e ítems, con la cotización de hoy y los permisos nuevos', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/Permisos de embarque/, '26001EC01000123A'],
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos la factura de exportación E en testing/, 'Emitir ahora'],
    ]);

    await runExportRepeatFlow(createSession(), 4);

    expect(gateway.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        Actividades: { Actividad: [{ Id: 620100 }] },
        CanMisMonExt: 'S',
        Cliente: 'ACME LLC',
        Cuit_pais_cliente: 55000002126,
        Domicilio_cliente: '123 Main St, Miami, FL',
        Dst_cmp: 212,
        Forma_pago: 'Carta de crédito',
        Id_impositivo: '12-3456789',
        Imp_total: 1500,
        Incoterms: 'FOB',
        Items: {
          Item: [
            expect.objectContaining({ Pro_ds: 'Bienes varios', Pro_qty: 2, Pro_umed: 1 }),
            expect.objectContaining({ Pro_ds: 'Flete', Pro_qty: 1, Pro_umed: 7 }),
          ],
        },
        Moneda_ctz: 1450.25,
        Moneda_Id: 'DOL',
        Permiso_existente: 'S',
        Tipo_expo: 1,
      }),
    );
    expect(printed()).toContain('Se copian el cliente ACME LLC, ESTADOS UNIDOS, la moneda, el incoterm y los ítems.');
    // El CUIT del país es el que ARCA publica para el destino: no hace falta repetirlo.
    expect(printed()).not.toContain('--cuit-pais');
    expect(printed()).toContain('--item "Bienes varios|2|500|1" --item "Flete|1|500"');
    expect(vi.mocked(attachExportPdf).mock.calls[0]?.[1].input.pdf).toBeUndefined();
  });

  it('con otro monto avisa que los ítems no se copian y sale un renglón con el total', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'No'],
      [/Monto total en DOL/, '2.000'],
      [/Permisos de embarque/, ''],
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'Cancelar'],
    ]);

    await runExportRepeatFlow(createSession(), 4);

    expect(gateway.authorize).not.toHaveBeenCalled();
    expect(printed()).toContain('Con otro monto los ítems de la factura no suman');
    expect(printed()).not.toContain('--item');
    expect(printed()).toContain('arcli fe -m 2000');
  });

  it('con `pdf nunca` la confirmación ofrece emitir y generar el PDF, solo esta vez', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/Permisos de embarque/, ''],
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'Emitir y generar el PDF'],
    ]);

    await runExportRepeatFlow(createSession({ pdf: 'nunca' }), 4);

    expect(gateway.authorize).toHaveBeenCalledTimes(1);
    expect(vi.mocked(attachExportPdf).mock.calls[0]?.[1].input.pdf).toBe(true);
  });

  it('volver desde la lista vuelve al selector de comprobantes', async () => {
    script = createScript([[/Cuál repetimos/, BACK]]);

    await expect(runExportRepeatFlow(createSession(), 4)).resolves.toBe(BACK);
  });
});
