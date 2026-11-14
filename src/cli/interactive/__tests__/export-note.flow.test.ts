import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import type { ExportGateway, ExportIssuedVoucher } from '../../../modules/export/export.types';
import { BACK } from '../../../modules/interactive/wizard';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import type { IFEXAuthorizeOutput } from '../../../services/arca/arca-sdk.types';
import { stripAnsi } from '../../../ui';
import { runExportNoteFlow } from '../export-note.flow';
import type { InteractiveSession } from '../session';

import { createScript } from './script';

let script = createScript([]);

/** La factura E de servicios de testing: punto de venta 4, numero 1. */
const INVOICE: ExportIssuedVoucher = {
  activities: [620100],
  arcaType: 19,
  clientAddress: '123 Main St, Miami, FL',
  clientCountryCuit: 55000002126,
  clientName: 'ACME LLC',
  currencyCode: 'DOL',
  date: '20261030',
  destinationCountry: 212,
  exchangeRate: 1174.605,
  exportType: 2,
  language: 1,
  number: 1,
  paymentTerms: 'Transferencia Internacional',
  pointOfSale: 4,
  result: 'A',
  total: 1500,
};

const gateway: ExportGateway = {
  authorize: vi.fn(async (): Promise<IFEXAuthorizeOutput> => ({
    FEXAuthorizeResult: {
      FEXErr: { ErrCode: 0, ErrMsg: 'OK' },
      FEXEvents: { EventCode: 0, EventMsg: '' },
      FEXResultAuth: {
        Cae: '76453017205075',
        Cbte_nro: 1,
        Cbte_tipo: 21,
        Cuit: 20111111112,
        Fch_cbte: '20261109',
        Fch_venc_Cae: '20261119',
        Id: 2,
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
  getIncoterms: async () => [],
  getLanguages: async () => [{ id: 1, name: 'Español' }],
  getLastRequestId: async () => 1,
  getLastVoucherNumber: vi.fn(async () => 0),
  getQuotations: async () => [],
  getUnits: async () => [{ id: 7, name: 'unidades' }],
  getVoucher: vi.fn(async (query) => (query.number === INVOICE.number ? INVOICE : null)),
};

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  confirm: (message: string, yesLabel: string, noLabel = 'Cancelar') =>
    script.chooseStep(message, [
      { name: yesLabel, value: true },
      { name: noLabel, value: false },
    ]),
}));

vi.mock('../../../services/arca/arca-client.factory', () => ({
  ArcaClientFactory: class {
    public createExportGateway() {
      return gateway;
    }
  },
}));

vi.mock('../../commands/export.command.pdf', () => ({
  attachExportPdf: async (result: unknown) => result,
}));

function createSession(): InteractiveSession {
  return {
    arca: {} as never,
    billingGateway: { createVoucher: vi.fn(), getNextVoucherNumber: vi.fn(), getQuotation: vi.fn() },
    historyGateway: { getLastNumber: vi.fn(), getVoucher: vi.fn() },
    runtime: {
      config: arcliConfigSchema.parse({ cuit: '20111111112', puntoVentaPorDefecto: 4 }),
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

describe('runExportNoteFlow', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(gateway.authorize).mockClear();
    vi.mocked(gateway.getVoucher).mockImplementation(async (query) =>
      query.number === INVOICE.number ? INVOICE : null,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  it('busca la factura E, vuelve a preguntar si no existe y emite la nota de crédito con sus datos', async () => {
    script = createScript([
      [/sobre la factura E o sobre otra nota E/, 'Sobre la factura E'],
      [/Punto de venta de la factura E/, '4'],
      [/Número de la factura E/, '9'],
      [/Número de la factura E/, '1'],
      [/Monto de la nota de crédito de exportación E \(DOL\)/, '500'],
      [/Detalle de la nota/, 'Descuento por volumen'],
      [/Agregamos algún opcional/, []],
      [/Emitimos la nota de crédito de exportación E en testing/, 'Sí, emitir ahora'],
    ]);

    await runExportNoteFlow(createSession(), 'credito');

    expect(printed()).toContain('ARCA no tiene la factura E 00004-00000009');
    expect(printed()).toContain('Factura de exportación E 00004-00000001 del 30/10/2026 a ACME LLC, por 1.500 USD.');
    expect(gateway.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        Cbte_nro: 1,
        Cbte_Tipo: 21,
        Cliente: 'ACME LLC',
        Cmps_asoc: { Cmp_asoc: [{ Cbte_cuit: 20111111112, Cbte_nro: 1, Cbte_punto_vta: 4, Cbte_tipo: 19 }] },
        Imp_total: 500,
        Moneda_ctz: 1174.605,
        Permiso_existente: '',
      }),
    );
    expect(printed()).toContain(
      'arcli nce -m 500 --ar 1 --apv 4 --descripcion "Descuento por volumen" --testing --emitir',
    );
  });

  it('en bienes pregunta los permisos de embarque y los informa sin --permiso-existente', async () => {
    // La busca el asistente y despues ExportService, para heredar sus datos.
    vi.mocked(gateway.getVoucher)
      .mockResolvedValueOnce({ ...INVOICE, exportType: 1 })
      .mockResolvedValueOnce({ ...INVOICE, exportType: 1 });
    script = createScript([
      [/sobre la factura E o sobre otra nota E/, 'Sobre la factura E'],
      [/Punto de venta de la factura E/, '4'],
      [/Número de la factura E/, '1'],
      [/Monto de la nota de débito de exportación E/, '100'],
      [/Detalle de la nota/, ''],
      [/Permisos de embarque/, '26001EC01000123A'],
      [/Agregamos algún opcional/, []],
      [/Emitimos la nota de débito de exportación E en testing/, 'No, dejar sin emitir'],
    ]);

    await runExportNoteFlow(createSession(), 'debito');

    expect(printed()).toContain('arcli nde -m 100 --ar 1 --apv 4 --permiso 26001EC01000123A --testing --emitir');
  });

  it('en la nota de crédito no deja pasar del total de la factura', async () => {
    script = createScript([
      [/sobre la factura E o sobre otra nota E/, 'Sobre la factura E'],
      [/Punto de venta de la factura E/, '4'],
      [/Número de la factura E/, '1'],
      [/Monto de la nota de crédito/, '2000'],
    ]);

    await expect(runExportNoteFlow(createSession(), 'credito')).rejects.toThrow(/No puede superar el total/);
  });

  it('ajusta otra nota E con --ac y suma los opcionales, sin ofrecer la cotización en servicios', async () => {
    const debitNote: ExportIssuedVoucher = {
      ...INVOICE,
      arcaType: 20,
      associatedVoucher: { arcaType: 19, number: 1, pointOfSale: 4 },
      number: 3,
      total: 200,
    };

    vi.mocked(gateway.getVoucher).mockImplementation(async (query) =>
      query.arcaType === 20 && query.number === 3 ? debitNote : null,
    );
    script = createScript([
      [/sobre la factura E o sobre otra nota E/, 'Sobre una nota de débito E'],
      [/Punto de venta de la nota de débito E/, '4'],
      [/Número de la nota de débito E/, '3'],
      [/Monto de la nota de crédito/, '200'],
      [/Detalle de la nota/, ''],
      [/Agregamos algún opcional/, ['Observaciones']],
      [/^Observaciones \(/, 'Ajuste de la ND'],
      [/Observaciones comerciales/, 'Sin cargo'],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportNoteFlow(createSession(), 'credito');

    expect(printed()).toContain('Nota de débito de exportación E 00004-00000003');
    expect(script.chooseManyStep.mock.calls[0]?.[1].map((choice) => choice.name)).toEqual([
      'Ítems',
      'Idioma',
      'Observaciones',
    ]);
    expect(printed()).toContain(
      'arcli nce -m 200 --ar 3 --apv 4 --ac nde --observaciones "Ajuste de la ND" --obs-comerciales "Sin cargo" --testing --emitir',
    );
  });

  it('en servicios no deja que una nota de débito ajuste otra nota y vuelve a preguntar el número', async () => {
    const creditNote: ExportIssuedVoucher = { ...INVOICE, arcaType: 21, number: 2, total: 100 };

    vi.mocked(gateway.getVoucher).mockImplementation(async (query) => (query.arcaType === 21 ? creditNote : null));
    script = createScript([
      [/sobre la factura E o sobre otra nota E/, 'Sobre una nota de crédito E'],
      [/Punto de venta de la nota de crédito E/, '4'],
      [/Número de la nota de crédito E/, '2'],
      [/Número de la nota de crédito E/, BACK],
      [/Punto de venta de la nota de crédito E/, BACK],
      [/sobre la factura E o sobre otra nota E/, BACK],
    ]);

    await expect(runExportNoteFlow(createSession(), 'debito')).resolves.toBe(BACK);
    expect(printed()).toContain('En servicios una nota de débito E solo ajusta una factura E');
  });
});
