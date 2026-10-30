import type { IFEXAuthorizeOutput } from '@arcasdk/core/lib/application/dto/fex';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import type { ExportGateway } from '../../../modules/export/export.types';
import { BACK } from '../../../modules/interactive/wizard';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import { stripAnsi } from '../../../ui';
import { runExportFlow } from '../export.flow';
import type { InteractiveSession } from '../session';

import { createScript } from './script';

let script = createScript([]);
const savedConfig = vi.fn();

const gateway: ExportGateway = {
  authorize: vi.fn(async (): Promise<IFEXAuthorizeOutput> => ({
    FEXAuthorizeResult: {
      FEXErr: { ErrCode: 0, ErrMsg: 'OK' },
      FEXEvents: { EventCode: 0, EventMsg: '' },
      FEXResultAuth: {
        Cae: '76123456789012',
        Cbte_nro: 7,
        Cbte_tipo: 19,
        Fch_cbte: '20261030',
        Fch_venc_Cae: '20261109',
        Id: 1,
        Motivos_Obs: '',
        Punto_vta: 4,
        Reproceso: 'N',
        Resultado: 'A',
        Cuit: 20111111112,
      },
    },
  })),
  getActivities: async () => [{ id: 620100, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA' }],
  getCurrencies: async () => [{ code: 'DOL', name: 'Dólar Estadounidense' }],
  getDestinationCountries: async () => [
    { code: 200, name: 'ARGENTINA' },
    { code: 212, name: 'ESTADOS UNIDOS' },
  ],
  getDestinationCountryCuits: async () => [{ countryName: 'ESTADOS UNIDOS - Persona Jurídica', cuit: 55000002126 }],
  getIncoterms: async () => [
    { code: 'EXW', name: 'EXW' },
    { code: 'FOB', name: 'FOB' },
  ],
  getLanguages: async () => [],
  getLastRequestId: async () => 0,
  getQuotations: async () => [{ code: 'DOL', date: '20261030', rate: 1174.6 }],
  getUnits: async () => [{ id: 7, name: 'unidades' }],
};

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  confirm: (message: string, yesLabel: string, noLabel = 'Cancelar') =>
    script.chooseStep(message, [
      { name: yesLabel, value: true },
      { name: noLabel, value: false },
    ]),
}));

vi.mock('../../../services/arca/arca-client.factory', () => ({
  ArcaClientFactory: class {
    public createForExport() {
      return {};
    }
  },
}));

vi.mock('../../../services/arca/arca-export.gateway', () => ({
  ArcaExportGateway: class {
    public constructor() {
      return gateway;
    }
  },
}));

vi.mock('../../commands/export.command.pdf', () => ({
  attachExportPdf: async (result: unknown) => result,
}));

vi.mock('../../../modules/config/config.service', () => ({
  ConfigService: class {
    public close() {}
    public setValue(key: string, value: string) {
      savedConfig(key, value);
    }
  },
}));

function createSession(config: Record<string, unknown> = {}): InteractiveSession {
  return {
    arca: {} as never,
    billingGateway: { createVoucher: vi.fn(), getNextVoucherNumber: vi.fn(), getQuotation: vi.fn() },
    historyGateway: { getLastNumber: vi.fn(), getVoucher: vi.fn() },
    runtime: {
      config: arcliConfigSchema.parse({ cuit: '20111111112', puntoVentaPorDefecto: 4, ...config }),
      environment: 'testing',
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

describe('runExportFlow', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(gateway.authorize).mockClear();
    savedConfig.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  it('emite una E de servicios en dólares y ofrece guardar la actividad escrita a mano', async () => {
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, 'estados unidos'],
      [/ID impositivo/, '12-3456789'],
      [/Qué exportás/, 'Servicios'],
      [/Monto total/, '1.500'],
      [/Descripción/, 'Consultoría de software'],
      [/moneda/, 'Dólares'],
      [/Te pagan en dólares/, 'Sí'],
      [/Forma de pago/, 'Transferencia Internacional'],
      [/Fecha de pago/, ''],
      [/actividad/, '620100'],
      [/Número del comprobante/, '7'],
      [/Emitimos la Factura de exportación E en testing/, 'Emitir ahora'],
      [/Guardamos la actividad 620100/, 'Sí, guardar'],
    ]);

    await runExportFlow(createSession());

    expect(gateway.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        Actividades: { Actividad: [{ Id: 620100 }] },
        CanMisMonExt: 'S',
        Cbte_nro: 7,
        Cliente: 'ACME LLC',
        Dst_cmp: 212,
        Id_impositivo: '12-3456789',
        Imp_total: 1500,
        Moneda_ctz: 1174.6,
        Moneda_Id: 'DOL',
        Punto_vta: 4,
        Tipo_expo: 2,
      }),
    );
    expect(printed()).toContain(
      'arcli fe -m 1500 --cliente "ACME LLC" --domicilio-cliente "123 Main St" --pais-destino "ESTADOS UNIDOS" --id-impositivo 12-3456789 --actividad 620100 --numero 7 --descripcion "Consultoría de software" --moneda DOL --misma-moneda --testing --emitir',
    );
    expect(savedConfig).toHaveBeenCalledWith('exportacion.actividad', '620100');
  });

  it('en bienes pregunta el incoterm, toma la actividad de la config y no emite si se cancela', async () => {
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, '212'],
      [/ID impositivo/, ''],
      [/Qué exportás/, 'Bienes'],
      [/Monto total/, '800'],
      [/Descripción/, ''],
      [/moneda/, 'Pesos'],
      [/Incoterm/, 'FOB'],
      [/Forma de pago/, 'Carta de crédito'],
      [/Fecha de pago/, '15/11/2026'],
      [/Número del comprobante/, '8'],
      [/Emitimos/, 'Cancelar'],
    ]);

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

    expect(gateway.authorize).not.toHaveBeenCalled();
    expect(savedConfig).not.toHaveBeenCalled();
    expect(printed()).toContain('No se emitió nada.');
    expect(printed()).toContain(
      '--tipo-expo 1 --actividad 620100 --numero 8 --moneda PES --incoterm FOB --forma-pago "Carta de crédito" --fecha-pago 15/11/2026',
    );
  });

  it('valida el país contra la tabla de ARCA: Argentina no es destino de exportación', async () => {
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, 'argentina'],
    ]);

    await expect(runExportFlow(createSession())).rejects.toThrow(/Argentina no es un destino de exportación/);
  });

  it('volver desde el primer paso vuelve al selector de comprobantes', async () => {
    script = createScript([[/cliente del exterior/, BACK]]);

    await expect(runExportFlow(createSession())).resolves.toBe(BACK);
  });
});
