import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  type ExportGateway,
  type ExportIssuedVoucher,
} from '../../../modules/export/export.types';
import { buildExportNoteInput } from '../../../modules/interactive/export-note-input';
import { BACK, runWizard } from '../../../modules/interactive/wizard';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import type { IFEXAuthorizeOutput } from '../../../services/arca/arca-sdk.types';
import { stripAnsi } from '../../../ui';
import { exportNoteSteps, runExportNoteFlow } from '../export-note.flow';
import type { InteractiveSession } from '../session';

import { createScript, rejecting } from './script';

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
  checkPermit: async () => 'OK',
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

// El comando equivalente sale con las comillas de la shell del SO: POSIX fijo para que el CI en Windows espere lo mismo.
vi.mock('../../../lib/shell/shell-argument', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/shell/shell-argument')>();

  return { ...actual, formatShellCommand: (args: readonly string[]) => actual.formatShellCommand(args, 'linux') };
});

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseOne: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(args[0], args[1]),
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
      "arcli nce -m 500 --ar 1 --apv 4 --descripcion 'Descuento por volumen' --testing --emitir",
    );
  });

  it('el detalle de la nota más largo que el de ARCA da el error 1770 y vuelve a preguntar (#219)', async () => {
    script = createScript([
      [/Punto de venta de la factura E/, '4'],
      [/Número de la factura E/, '1'],
      [/Monto de la nota de crédito/, '500'],
      [/Detalle de la nota/, rejecting('Descuento', ['a'.repeat(4001), /más de 4\.000 caracteres.*error 1770/])],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportNoteFlow(createSession(), 'credito');

    expect(gateway.authorize).not.toHaveBeenCalled();
    expect(printed()).toContain('arcli nce -m 500 --ar 1 --apv 4 --descripcion Descuento --testing --emitir');
  });

  it('en bienes pregunta los permisos de embarque y los informa sin --permiso-existente', async () => {
    // La busca el asistente y despues ExportService, para heredar sus datos.
    vi.mocked(gateway.getVoucher)
      .mockResolvedValueOnce({ ...INVOICE, exportType: 1 })
      .mockResolvedValueOnce({ ...INVOICE, exportType: 1 });
    script = createScript([
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
      [/Punto de venta de la nota de débito E/, '4'],
      [/Número de la nota de débito E/, '3'],
      [/Monto de la nota de crédito/, '200'],
      [/Detalle de la nota/, ''],
      [/Agregamos algún opcional/, ['Observaciones']],
      [/^Observaciones \(/, 'Ajuste de la ND'],
      [/Observaciones comerciales/, 'Sin cargo'],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportNoteFlow(createSession(), 'credito', EXPORT_DEBIT_NOTE_KIND);

    expect(printed()).toContain('Nota de débito de exportación E 00004-00000003');
    expect(script.chooseManyStep.mock.calls[0]?.[1].map((choice) => choice.name)).toEqual([
      'Fecha del comprobante',
      'Ítems',
      'Idioma',
      'Observaciones',
    ]);
    expect(printed()).toContain(
      "arcli nce -m 200 --ar 3 --apv 4 --ac nde --observaciones 'Ajuste de la ND' --obs-comerciales 'Sin cargo' --testing --emitir",
    );
  });

  it('la fecha de la nota va en los opcionales: no antes de la factura ni fuera de lo que acepta ARCA (EXPO-11)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T12:00:00-03:00'));
    script = createScript([
      [/Punto de venta de la factura E/, '4'],
      [/Número de la factura E/, '1'],
      [/Monto de la nota de crédito/, '100'],
      [/Detalle de la nota/, ''],
      [/Agregamos algún opcional/, ['Fecha del comprobante']],
      [
        /Fecha del comprobante/,
        rejecting(
          '31/10',
          ['27/10/2026', /error 1500/],
          ['29/10/2026', /no puede ser anterior a la de la factura.*30\/10\/2026/],
        ),
      ],
      [/Emitimos/, 'Sí, emitir ahora'],
    ]);

    try {
      await runExportNoteFlow(createSession(), 'credito');
    } finally {
      vi.useRealTimers();
    }

    expect(gateway.authorize).toHaveBeenCalledWith(expect.objectContaining({ Fecha_cbte: '20261031' }));
    expect(printed()).toContain('arcli nce -m 100 --ar 1 --apv 4 --fecha 31/10/2026 --testing --emitir');
  });

  // NAV-5: las reglas ven la nota como `ExportService`, con el tipo del asociado. En bienes la ventana no corta en el
  // fin de mes; sin el tipo del asociado, la regla tomaba servicios y rechazaba el 01/12.
  it('en una nota de bienes, la fecha puede pasar al mes siguiente dentro de los 5 días (1500)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-28T12:00:00-03:00'));
    vi.mocked(gateway.getVoucher).mockResolvedValue({ ...INVOICE, exportType: 1, incoterm: 'FOB' });
    script = createScript([
      [/Punto de venta de la factura E/, '4'],
      [/Número de la factura E/, '1'],
      [/Monto de la nota de crédito/, '100'],
      [/Detalle de la nota/, ''],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, ['Fecha del comprobante']],
      [/Fecha del comprobante/, rejecting('01/12/2026', ['04/12/2026', /error 1500/])],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    try {
      await runExportNoteFlow(createSession(), 'credito');
    } finally {
      vi.useRealTimers();
    }

    expect(printed()).toContain('--fecha 01/12/2026');
  });

  it('volver desde el primer paso vuelve al selector de comprobantes, sin preguntar sobre qué va la nota', async () => {
    script = createScript([[/Punto de venta de la factura E/, BACK]]);

    await expect(runExportNoteFlow(createSession(), 'credito')).resolves.toBe(BACK);
  });

  it('en servicios no deja que una nota de débito ajuste otra nota y vuelve a preguntar el número', async () => {
    const creditNote: ExportIssuedVoucher = { ...INVOICE, arcaType: 21, number: 2, total: 100 };

    vi.mocked(gateway.getVoucher).mockImplementation(async (query) => (query.arcaType === 21 ? creditNote : null));
    script = createScript([
      [/Punto de venta de la nota de crédito E/, '4'],
      [/Número de la nota de crédito E/, '2'],
      [/Número de la nota de crédito E/, BACK],
      [/Punto de venta de la nota de crédito E/, BACK],
    ]);

    await expect(runExportNoteFlow(createSession(), 'debito', EXPORT_CREDIT_NOTE_KIND)).resolves.toBe(BACK);
    expect(printed()).toContain('En servicios una nota de débito E solo ajusta una factura E');
  });
});

describe('runExportNoteFlow: volver en cada paso, PV propio y cotización del asociado', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(gateway.authorize).mockClear();
    vi.mocked(gateway.getVoucher).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  it('volver desde los opcionales hasta el punto de venta pasa por cada paso y sale al selector', async () => {
    vi.mocked(gateway.getVoucher).mockResolvedValue({ ...INVOICE, exportType: 1, incoterm: 'FOB' });
    script = createScript([
      [/Punto de venta de la factura E/, '4'],
      [/Número de la factura E/, '1'],
      [/Monto de la nota de crédito/, '100'],
      [/Detalle de la nota/, ''],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, BACK],
      [/Permisos de embarque/, BACK],
      [/Detalle de la nota/, BACK],
      [/Monto de la nota de crédito/, BACK],
      [/Número de la factura E/, BACK],
      [/Punto de venta de la factura E/, BACK],
    ]);

    await expect(runExportNoteFlow(createSession(), 'credito')).resolves.toBe(BACK);
    expect(gateway.authorize).not.toHaveBeenCalled();
  });

  it('busca la factura en otro punto de venta escrito a mano', async () => {
    vi.mocked(gateway.getVoucher).mockImplementation(async (query) =>
      query.pointOfSale === 7 ? { ...INVOICE, pointOfSale: 7 } : null,
    );
    script = createScript([
      [/Punto de venta de la factura E/, rejecting('7', ['0', /punto de venta/i], ['abc', /punto de venta/i])],
      [/Número de la factura E/, '1'],
      [/Monto de la nota de débito/, '50'],
      [/Detalle de la nota/, 'Ajuste'],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportNoteFlow(createSession(), 'debito');

    expect(gateway.getVoucher).toHaveBeenCalledWith(expect.objectContaining({ number: 1, pointOfSale: 7 }));
    expect(script.askTextStep.mock.calls[0]?.[1]).toMatchObject({ defaultValue: '4' });
    expect(printed()).toContain('--apv 7');
  });

  it('en bienes en dólares ofrece la cotización del asociado; sobre otra NC no hay tope', async () => {
    const creditNote = { ...INVOICE, arcaType: 21, exportType: 1 as const, incoterm: 'FOB', total: 100 };

    vi.mocked(gateway.getVoucher).mockResolvedValue(creditNote);
    vi.spyOn(gateway, 'getIncoterms').mockResolvedValue([{ code: 'FOB', name: 'FOB' }]);
    script = createScript([
      [/Punto de venta de la nota de crédito E/, '4'],
      [/Número de la nota de crédito E/, '1'],
      [/Monto de la nota de crédito/, '5.000'],
      [/Detalle de la nota/, ''],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportNoteFlow(createSession(), 'credito', EXPORT_CREDIT_NOTE_KIND);

    const names = (script.chooseManyStep.mock.calls[0]?.[1] ?? []).map((choice) => [choice.name, choice.description]);

    expect(names).toContainEqual(['Cotización', 'la de la nota de crédito E (1.174,605)']);
    expect(names).toContainEqual(['Descripción del incoterm', 'FOB']);
  });

  it('una E en pesos no ofrece la cotización', async () => {
    vi.mocked(gateway.getVoucher).mockResolvedValue({ ...INVOICE, currencyCode: 'PES', exportType: 1 });
    script = createScript([
      [/Punto de venta/, '4'],
      [/Número/, '1'],
      [/Monto de la nota de débito.*\(PES\)/, '100'],
      [/Detalle de la nota/, ''],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, BACK],
      [/Permisos de embarque/, BACK],
      [/Detalle de la nota/, BACK],
      [/Monto/, BACK],
      [/Número/, BACK],
      [/Punto de venta/, BACK],
    ]);

    await runExportNoteFlow(createSession(), 'debito');

    expect((script.chooseManyStep.mock.calls[0]?.[1] ?? []).map((choice) => choice.name)).not.toContain('Cotización');
  });

  it('si ARCA falla al buscar la factura, el error llega al menu', async () => {
    vi.mocked(gateway.getVoucher).mockRejectedValueOnce(new Error('ARCA no responde'));
    script = createScript([
      [/Punto de venta/, '4'],
      [/Número/, '1'],
    ]);

    await expect(runExportNoteFlow(createSession(), 'credito')).rejects.toThrow('ARCA no responde');
  });
});

describe('notas E: sin punto de venta y sin asociado elegido', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  it('sin punto de venta lo pide, y volver ahí no pregunta nada de la nota', async () => {
    script = createScript([[/^Punto de venta:/, BACK]]);

    const session = createSession();

    await runExportNoteFlow(
      { ...session, runtime: { ...session.runtime, pointOfSale: undefined } as ResolvedArcaRuntime },
      'credito',
    );

    expect(gateway.getVoucher).not.toHaveBeenCalled();
  });

  it('sin asociado elegido, los pasos ajustan la factura E', async () => {
    vi.mocked(gateway.getVoucher).mockResolvedValue(INVOICE);
    script = createScript([
      [/Punto de venta de la factura E/, '4'],
      [/Número de la factura E/, '1'],
      [/Monto de la nota de crédito/, '100'],
      [/Detalle/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    const state = await runWizard(exportNoteSteps('credito', gateway, 4), {});

    expect(buildExportNoteInput(state as NonNullable<typeof state>, { kind: 'credito' })).toMatchObject({
      amount: 100,
      associatedVoucher: { number: 1, pointOfSale: 4, shortcut: undefined },
      voucherKind: EXPORT_CREDIT_NOTE_KIND,
    });
  });
});

// Revisión de NAV-3: en la nota, solo la descripción del incoterm sigue al asociado (el incoterm es el suyo).
describe('notas E: opcionales al elegir otro asociado', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  it('el idioma elegido se mantiene y la descripción del incoterm se olvida', async () => {
    const goods = { ...INVOICE, exportType: 1 as const, incoterm: 'FOB', incotermDescription: 'Free on board' };
    const invoices: Record<number, ExportIssuedVoucher> = {
      2: { ...goods, number: 2 },
      3: { ...goods, incoterm: 'CIF', incotermDescription: 'Cost insurance freight', number: 3 },
    };
    const notesGateway: ExportGateway = {
      ...gateway,
      getLanguages: async () => [
        { id: 1, name: 'Español' },
        { id: 2, name: 'Inglés' },
      ],
      getVoucher: async (query) => invoices[query.number] ?? null,
    };
    let returned = false;
    const after = {
      name: 'despues',
      run: async () => {
        if (returned) {
          return {};
        }

        returned = true;

        return BACK;
      },
    };

    script = createScript([
      [/Punto de venta de la factura E/, '4'],
      [/Número de la factura E/, '2'],
      [/Monto de la nota de crédito/, '100'],
      [/Detalle/, ''],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, ['Idioma', 'Descripción del incoterm']],
      [/Idioma del comprobante/, 'Inglés'],
      [/Descripción del incoterm FOB/, 'FOB Buenos Aires'],
      // "despues" vuelve: se retrocede hasta el número y se elige otra factura.
      [/Agregamos algún opcional/, BACK],
      [/Permisos de embarque/, BACK],
      [/Detalle/, BACK],
      [/Monto de la nota de crédito/, BACK],
      [/Número de la factura E/, '3'],
      [/Monto de la nota de crédito/, '100'],
      [/Detalle/, ''],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, ['Idioma']],
      [/Idioma del comprobante/, 'Inglés'],
    ]);

    const state = await runWizard([...exportNoteSteps('credito', notesGateway, 4), after], {});
    const lastSelection = script.chooseManyStep.mock.calls.at(-1);
    const shown = Object.fromEntries((lastSelection?.[1] ?? []).map((choice) => [choice.name, choice.description]));

    expect(state?.options).toEqual({ language: 2 });
    expect(lastSelection?.[2]).toEqual(['idioma']);
    expect(shown).toMatchObject({ 'Descripción del incoterm': 'Cost insurance freight', Idioma: 'Inglés' });
  });
});
