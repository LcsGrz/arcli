import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExportIssuedVoucher, ExportVoucherQuery } from '../../../modules/export/export.types';
import { BACK } from '../../../modules/interactive/wizard';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import { stripAnsi } from '../../../ui';
import { runHistoryFlow } from '../history.flow';
import type { InteractiveSession } from '../session';

import { createScript, onlyChoices } from './script';

let script = createScript([]);

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  chooseStepWhileLoading: (...args: Parameters<typeof script.chooseStepWhileLoading>) =>
    script.chooseStepWhileLoading(...args),
  eraseLastAnswer: () => undefined,
  fitPageSize: () => 12,
}));

/** La factura E de servicios de testing y una nota de credito sobre ella, en el punto de venta 4. */
const INVOICE: ExportIssuedVoucher = {
  activities: [620100],
  arcaType: 19,
  cae: '76443017205075',
  caeExpiration: '20261109',
  clientAddress: '123 Main St, Miami, FL',
  clientCountryCuit: 55000002126,
  clientName: 'ACME LLC',
  currencyCode: 'DOL',
  date: '20261030',
  destinationCountry: 212,
  exchangeRate: 1174.605,
  exportType: 2,
  number: 1,
  pointOfSale: 4,
  result: 'A',
  total: 1500,
};

const CREDIT_NOTE: ExportIssuedVoucher = {
  ...INVOICE,
  arcaType: 21,
  associatedVoucher: { arcaType: 19, number: 1, pointOfSale: 4 },
  cae: '76453017205075',
  total: 200,
};

const VOUCHERS = [INVOICE, CREDIT_NOTE];

const exportGateway = {
  getLastVoucherNumber: vi.fn(
    async (arcaType: number, pointOfSale: number) =>
      VOUCHERS.filter((voucher) => voucher.arcaType === arcaType && voucher.pointOfSale === pointOfSale).length,
  ),
  getVoucher: vi.fn(
    async (query: ExportVoucherQuery) =>
      VOUCHERS.find(
        (voucher) =>
          voucher.arcaType === query.arcaType &&
          voucher.number === query.number &&
          voucher.pointOfSale === query.pointOfSale,
      ) ?? null,
  ),
};

const createExportGateway = vi.fn(() => exportGateway);

vi.mock('../../../services/arca/arca-client.factory', () => ({
  ArcaClientFactory: class {
    public createExportGateway() {
      return createExportGateway();
    }
  },
}));

function createSession(): InteractiveSession {
  return {
    arca: {} as never,
    billingGateway: { createVoucher: vi.fn(), getNextVoucherNumber: vi.fn(), getQuotation: vi.fn() },
    historyGateway: { getLastNumber: vi.fn(async () => 0), getVoucher: vi.fn() },
    runtime: {
      config: { cert: {}, key: {}, output: {} },
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

describe('consultar comprobantes de exportación E', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  it('ofrece la E y sus notas además de los 19 tipos de wsfe', async () => {
    script = createScript([[/Qué comprobantes querés consultar/, BACK]]);

    await runHistoryFlow(createSession());

    const names = onlyChoices(script.chooseStep.mock.calls[0][1]).map((choice) => choice.name);

    expect(names).toHaveLength(22);
    expect(names.slice(-3)).toEqual([
      'Factura de exportación E (fe)',
      'Nota de débito de exportación E (nde)',
      'Nota de crédito de exportación E (nce)',
    ]);
    expect(createExportGateway).not.toHaveBeenCalled();
  });

  it('lista las facturas E por wsfex y muestra el detalle como `arcli consultar fe`', async () => {
    script = createScript([
      [/Qué comprobantes querés consultar/, 'Factura de exportación E'],
      [/Qué factura de exportación E querés ver/, '00004-00000001'],
      [/Qué factura de exportación E querés ver/, BACK],
    ]);

    const session = createSession();

    await runHistoryFlow(session);

    expect(exportGateway.getLastVoucherNumber).toHaveBeenCalledWith(19, 4);
    expect(exportGateway.getLastVoucherNumber).toHaveBeenCalledTimes(1);
    expect(session.historyGateway.getLastNumber).not.toHaveBeenCalled();

    const rows = onlyChoices(script.chooseStep.mock.calls[1][1]).map((choice) => choice.name);

    expect(rows[0]).toContain('ACME LLC');
    expect(rows[0]).toContain('CAE 76443017205075');

    const output = printed();

    expect(output).toContain('FACTURA DE EXPORTACIÓN E');
    expect(output).toContain('123 Main St, Miami, FL');
    expect(output).toContain('76443017205075');
    expect(output).toContain('APROBADO');
  });

  it('la nota E muestra la factura que ajusta', async () => {
    script = createScript([
      [/Qué comprobantes querés consultar/, 'Nota de crédito de exportación E'],
      [/Qué nota de crédito de exportación E querés ver/, '00004-00000001'],
      [/Qué nota de crédito de exportación E querés ver/, BACK],
    ]);

    await runHistoryFlow(createSession());

    expect(exportGateway.getLastVoucherNumber).toHaveBeenCalledWith(21, 4);
    expect(printed()).toContain('Factura de exportación E 00004-00000001');
  });

  it('busca una E por número en otro punto de venta y avisa si no existe', async () => {
    script = createScript([
      [/Qué comprobantes querés consultar/, 'Factura de exportación E'],
      [/Qué factura de exportación E querés ver/, 'Ingresar el número a mano'],
      [/Punto de venta/, '7'],
      [/^Número/, '1'],
      [/Qué factura de exportación E querés ver/, BACK],
    ]);

    await runHistoryFlow(createSession());

    expect(exportGateway.getVoucher).toHaveBeenLastCalledWith({ arcaType: 19, number: 1, pointOfSale: 7 });
    expect(printed()).toContain('No existe la factura de exportación E N° 00007-00000001.');
  });
});
