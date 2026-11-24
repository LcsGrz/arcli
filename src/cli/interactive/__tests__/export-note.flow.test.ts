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
import { VoucherQueryError } from '../../../modules/vouchers/voucher-history';
import type { IFEXAuthorizeOutput } from '../../../services/arca/arca-sdk.types';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
import { serializeCliError } from '../../error-output';
import { exportNoteSteps, runExportNoteFlow } from '../export-note.flow';
import type { InteractiveSession } from '../session';

import { createScript, editing, noteExportItem, rejecting } from './script';

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
  chooseFromFilterList: (...args: Parameters<typeof script.chooseFromFilterList>) =>
    script.chooseFromFilterList(...args),
  editRowsStep: (...args: Parameters<typeof script.editRowsStep>) => script.editRowsStep(...args),
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
      cuit: 20111111112,
      environment: 'testing',
      pointOfSale: 4,
    } as unknown as CliArcaRuntime,
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
      ...noteExportItem('500', 'Descuento por volumen'),
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

  it('en servicios no pregunta la cotización: muestra la del asociado, que es la que va (2053, NAV-9)', async () => {
    script = createScript([
      [/Punto de venta de la factura E/, '4'],
      [/Número de la factura E/, '1'],
      ...noteExportItem('500'),
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportNoteFlow(createSession(), 'credito');

    expect(script.asked.some((message) => message.startsWith('Cotización'))).toBe(false);
    expect(printed().replace(/\s+/g, ' ')).toContain(
      'Cotización: 1.174,605 por USD, la de la factura E. ARCA no acepta otra en servicios.',
    );
    expect(printed()).not.toContain('--cm');
  });

  it('la descripción del ítem más larga que la de ARCA da el error 1770 y vuelve a preguntar (#219)', async () => {
    script = createScript([
      [/Punto de venta de la factura E/, '4'],
      [/Número de la factura E/, '1'],
      [/^Ítems de .*: modificá o eliminá ítems/, editing({ edit: ['Según detalle'] })],
      [/Descripción del ítem 1/, rejecting('Descuento', ['a'.repeat(4001), /más de 4\.000 caracteres.*error 1770/])],
      [/Cantidad/, ''],
      [/Unidad/, ''],
      [/^(?:Importe|Precio unitario)/, '500'],
      [/Importe total/, 'Confirmar'],
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
      [/Cotización de USD \(la de la factura E es 1\.174,605\)/, '1174,605'],
      ...noteExportItem('100'),
      [/Permisos de embarque/, '26001EC01000123A'],
      [/Agregamos algún opcional/, []],
      [/Emitimos la nota de débito de exportación E en testing/, 'No, dejar sin emitir'],
    ]);

    await runExportNoteFlow(createSession(), 'debito');

    expect(printed()).toContain('arcli nde -m 100 --ar 1 --apv 4 --permiso 26001EC01000123A --testing --emitir');
  });

  it('arranca en el editor con los ítems de la factura; en la NC, con un total mayor, "Confirmar" está deshabilitado con su motivo y bajando el precio se sigue', async () => {
    const ITEMS = /^Ítems de .*: modificá o eliminá ítems/;

    script = createScript([
      [/Punto de venta de la factura E/, '4'],
      [/Número de la factura E/, '1'],
      // Sin "Monto de la nota" ni "Detalle": el renglón de la factura, para modificar (NAV-10).
      [ITEMS, editing({ edit: ['Según detalle'] })],
      [/Descripción del ítem 1/, ''],
      [/Cantidad/, ''],
      [/Unidad/, ''],
      [/^Importe en USD/, '2000'],
      [/Importe total de la nota de crédito de exportación E: 2\.000 USD/, 'Modificar los ítems'],
      [ITEMS, editing({ edit: ['Según detalle'] })],
      [/Descripción del ítem 1/, ''],
      [/Cantidad/, ''],
      [/Unidad/, ''],
      [/^Importe en USD/, '1.000'],
      [/Importe total de la nota de crédito de exportación E: 1\.000 USD/, 'Confirmar'],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportNoteFlow(createSession(), 'credito');

    const totals = script.chooseStep.mock.calls.filter(([message]) => /^Importe total/.test(message));

    expect(script.editRowsStep.mock.calls[0]?.[1].map((row) => row.total)).toEqual(['1.500 USD']);
    expect(totals[0]?.[1][0]).toMatchObject({
      disabled: 'No puede superar el total de la factura E 00004-00000001, de 1.500 USD.',
      name: 'Confirmar',
    });
    expect(totals[0]?.[2]).toBe('modificar');
    expect(totals[1]?.[1][0]).toMatchObject({ disabled: false, name: 'Confirmar' });
    expect(printed()).toContain('arcli nce -m 1000 --ar 1 --apv 4 --testing --emitir');
  });

  it('si el asociado tiene ítems de seña o anticipo, avisa por qué arranca con un renglón por el total, como "Repetir" E', async () => {
    vi.mocked(gateway.getVoucher).mockResolvedValueOnce({
      ...INVOICE,
      items: [
        { description: 'Bienes', discount: 0, quantity: 1, total: 1600, unit: 7, unitPrice: 1600 },
        { description: 'Anticipo', discount: 0, quantity: 0, total: -100, unit: 97, unitPrice: 0 },
      ],
    });
    script = createScript([
      [/Punto de venta de la factura E/, '4'],
      [/Número de la factura E/, '1'],
      [/^Ítems de .*: modificá o eliminá ítems/, BACK],
      [/Número de la factura E/, BACK],
      [/Punto de venta de la factura E/, BACK],
    ]);

    await runExportNoteFlow(createSession(), 'debito');

    expect(printed().replace(/[│┃╏\s]+/g, ' ')).toContain(
      'El comprobante tiene ítems de seña, anticipo o bonificación (unidades 97 y 99), que el asistente no informa: sale un renglón con el monto total.',
    );
    expect(script.editRowsStep.mock.calls[0]?.[1].map((row) => row.title)).toEqual(['Según detalle']);
  });

  it('si no se sabe si el asociado existe, muestra el error y vuelve a preguntar el número (ERR-15)', async () => {
    const errors = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    vi.mocked(gateway.getVoucher).mockRejectedValueOnce(
      new VoucherQueryError('No se sabe si existe', { errores: [] }, 'Volvé a consultar.', 'respuesta inesperada'),
    );
    script = createScript([
      [/Punto de venta de la factura E/, '4'],
      [/Número de la factura E/, '1'],
      [/Número de la factura E/, BACK],
      [/Punto de venta de la factura E/, BACK],
    ]);

    await runExportNoteFlow(createSession(), 'credito');

    expect(errors.mock.calls.join('')).toContain('No se sabe si existe');
    expect(printed()).not.toContain('ARCA no tiene');
  });

  it('sin cambios: otro error al buscar el asociado sale al menú', async () => {
    vi.mocked(gateway.getVoucher).mockRejectedValueOnce(new Error('ETIMEDOUT: Transacción Activa'));
    script = createScript([
      [/Punto de venta de la factura E/, '4'],
      [/Número de la factura E/, '1'],
    ]);

    const error: unknown = await runExportNoteFlow(createSession(), 'credito').catch((reason: unknown) => reason);

    expect(error).toMatchObject({ message: 'ETIMEDOUT: Transacción Activa' });
    expect(JSON.stringify(serializeCliError(error))).toContain('repetí la consulta');
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
      ...noteExportItem('200'),
      [/Agregamos algún opcional/, ['Observaciones']],
      [/^Observaciones \(/, 'Ajuste de la ND'],
      [/Observaciones comerciales/, 'Sin cargo'],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportNoteFlow(createSession(), 'credito', EXPORT_DEBIT_NOTE_KIND);

    expect(printed()).toContain('Nota de débito de exportación E 00004-00000003');
    expect(script.chooseManyStep.mock.calls[0]?.[1].map((choice) => choice.name)).toEqual([
      'Fecha del comprobante',
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
      ...noteExportItem('100'),
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
      [/Cotización de USD/, '1174,605'],
      ...noteExportItem('100'),
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
      [/Cotización de USD/, '1174,605'],
      ...noteExportItem('100'),
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, BACK],
      [/Permisos de embarque/, BACK],
      [/^Ítems de .*: modificá o eliminá ítems/, BACK],
      [/Cotización de USD/, BACK],
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
      ...noteExportItem('50', 'Ajuste'),
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportNoteFlow(createSession(), 'debito');

    expect(gateway.getVoucher).toHaveBeenCalledWith(expect.objectContaining({ number: 1, pointOfSale: 7 }));
    expect(script.askTextStep.mock.calls[0]?.[1]).toMatchObject({ defaultValue: '4' });
    expect(printed()).toContain('--apv 7');
  });

  it('en bienes en dólares pregunta la cotización con la del asociado escrita; sobre otra NC no hay tope', async () => {
    const creditNote = { ...INVOICE, arcaType: 21, exportType: 1 as const, incoterm: 'FOB', total: 100 };

    vi.mocked(gateway.getVoucher).mockResolvedValue(creditNote);
    vi.spyOn(gateway, 'getIncoterms').mockResolvedValue([{ code: 'FOB', name: 'FOB' }]);
    script = createScript([
      [/Punto de venta de la nota de crédito E/, '4'],
      [/Número de la nota de crédito E/, '1'],
      [/^Cotización de USD \(la de la nota de crédito E es 1\.174,605\):$/, '1174,605'],
      ...noteExportItem('5.000'),
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportNoteFlow(createSession(), 'credito', EXPORT_CREDIT_NOTE_KIND);

    const names = (script.chooseManyStep.mock.calls[0]?.[1] ?? []).map((choice) => [choice.name, choice.description]);

    expect(script.askTextStep.mock.calls[2]?.[1]).toMatchObject({ previousAnswer: '1174,605' });
    expect(names.map(([name]) => name)).not.toContain('Cotización');
    expect(names).toContainEqual(['Descripción del incoterm', 'FOB']);
    // Sin tocarla, la toma el CLI del asociado: el comando no la lleva.
    expect(printed()).not.toContain('--cm');
  });

  it('editada, la nota la lleva con --cm (NAV-9)', async () => {
    vi.mocked(gateway.getVoucher).mockResolvedValue({ ...INVOICE, exportType: 1, incoterm: 'FOB' });
    script = createScript([
      [/Punto de venta de la factura E/, '4'],
      [/Número de la factura E/, '1'],
      [/Cotización de USD/, '1.200'],
      ...noteExportItem('100'),
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportNoteFlow(createSession(), 'debito');

    expect(printed()).toContain('arcli nde -m 100 --ar 1 --apv 4 --cm 1200 --testing --emitir');
  });

  it('una E en pesos no pregunta la cotización', async () => {
    vi.mocked(gateway.getVoucher).mockResolvedValue({ ...INVOICE, currencyCode: 'PES', exportType: 1 });
    script = createScript([
      [/Punto de venta/, '4'],
      [/Número/, '1'],
      ...noteExportItem('100'),
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, BACK],
      [/Permisos de embarque/, BACK],
      [/^Ítems de .*: modificá o eliminá ítems/, BACK],
      [/Número/, BACK],
      [/Punto de venta/, BACK],
    ]);

    await runExportNoteFlow(createSession(), 'debito');

    expect(script.asked.some((message) => message.startsWith('Cotización'))).toBe(false);
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
      { ...session, runtime: { ...session.runtime, pointOfSale: undefined } as CliArcaRuntime },
      'credito',
    );

    expect(gateway.getVoucher).not.toHaveBeenCalled();
  });

  it('sin asociado elegido, los pasos ajustan la factura E', async () => {
    vi.mocked(gateway.getVoucher).mockResolvedValue(INVOICE);
    script = createScript([
      [/Punto de venta de la factura E/, '4'],
      [/Número de la factura E/, '1'],
      ...noteExportItem('100'),
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
      [/Cotización de USD/, '1174,605'],
      ...noteExportItem('100'),
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, ['Idioma', 'Descripción del incoterm']],
      [/Idioma del comprobante/, 'Inglés'],
      [/Descripción del incoterm FOB/, 'FOB Buenos Aires'],
      // "despues" vuelve: se retrocede hasta el número y se elige otra factura.
      [/Agregamos algún opcional/, BACK],
      [/Permisos de embarque/, BACK],
      [/^Ítems de .*: modificá o eliminá ítems/, BACK],
      [/Cotización de USD/, BACK],
      [/Número de la factura E/, '3'],
      [/Cotización de USD/, '1174,605'],
      ...noteExportItem('100'),
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
