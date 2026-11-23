import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingService } from '../../../modules/billing/billing.service';
import { buildNoteInput } from '../../../modules/interactive/note-input';
import { BACK, runWizard } from '../../../modules/interactive/wizard';
import type { IssuedVoucher, VoucherHistoryGateway } from '../../../modules/vouchers/voucher-history';
import { systemClock } from '../../../services/time/system-clock';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
import { runExportNoteFlow } from '../export-note.flow';
import { noteInputEnv, noteSteps, runNoteFlow } from '../note.flow';
import { type InteractiveSession, previewAndEmit } from '../session';

import { createScript, rejecting } from './script';

let script = createScript([]);

vi.mock('../export-note.flow', () => ({ runExportNoteFlow: vi.fn(async () => undefined) }));

vi.mock('../session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../session')>()),
  previewAndEmit: vi.fn(async () => undefined),
}));

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  chooseStepWhileLoading: (...args: Parameters<typeof script.chooseStepWhileLoading>) =>
    script.chooseStepWhileLoading(...args),
  eraseLastAnswer: () => undefined,
  fitPageSize: () => 12,
}));

function createSession(vouchers: IssuedVoucher[] = [], pointOfSale = 3): InteractiveSession {
  const historyGateway: VoucherHistoryGateway = {
    getLastNumber: async () => vouchers.reduce((max, voucher) => Math.max(max, voucher.number), 0),
    getVoucher: async (number) => vouchers.find((voucher) => voucher.number === number),
  };

  return {
    arca: {} as never,
    billingGateway: { createVoucher: vi.fn(), getNextVoucherNumber: vi.fn(), getQuotation: vi.fn() },
    historyGateway,
    runtime: {
      config: { cert: {}, consultarPadron: false, entornoPorDefecto: 'testing', key: {}, output: {} },
      context: { cuit: 20333333334 },
      cuit: 20333333334,
      environment: 'testing',
      outputJson: false,
      outputRaw: false,
      pointOfSale,
    } as unknown as CliArcaRuntime,
    service: new BillingService({ clock: systemClock }),
  };
}

const invoice = (overrides: Partial<IssuedVoucher> = {}): IssuedVoucher => ({
  cae: '86400940834693',
  concept: 2,
  date: '20261001',
  documentNumber: 0,
  documentTypeCode: 99,
  ivaAmount: 21,
  netAmount: 100,
  number: 14,
  total: 121,
  ...overrides,
});

async function note(session: InteractiveSession, kind: 'credito' | 'debito' = 'credito') {
  const state = await runWizard(noteSteps(session, 3), { kind });

  return state && buildNoteInput(state, noteInputEnv(session, 3));
}

function printed(): string {
  return stripAnsi(
    vi
      .mocked(process.stdout.write)
      .mock.calls.map(([chunk]) => String(chunk))
      .join(''),
  ).replace(/[│┃╏\s]+/g, ' ');
}

describe('notas: volver y cambiar respuestas', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(previewAndEmit).mockClear();
    vi.mocked(runExportNoteFlow).mockClear();
    expect(script.remaining()).toBe(0);
  });

  it('volver hasta la lista y elegir una factura en pesos no deja la moneda de la anterior', async () => {
    script = createScript([
      [/Sobre qué comprobante/, 'Facturas'],
      [/Qué factura\?/, 'Factura B'],
      [/A qué la asociamos/, 'A una factura'],
      [/Sobre qué factura B/, '00003-00000014'],
      [/En qué moneda va la nota/, 'En pesos'],
      [/Monto de la nota de crédito/, BACK],
      [/En qué moneda va la nota/, BACK],
      [/Sobre qué factura B/, '00003-00000015'],
      [/Total o parcial/, 'Anular el total'],
      [/Agregamos/, []],
    ]);

    const session = createSession([
      invoice({ currency: 'DOL', exchangeRate: 1450 }),
      invoice({ ivaAmount: 42, netAmount: 200, number: 15, total: 242 }),
    ]);

    expect(await note(session)).toMatchObject({
      associatedVoucher: { numero: 15 },
      currencyCode: 'PES',
      totalAmount: 242,
    });
  });

  it('volver desde "¿Total o parcial?" vuelve a la lista de facturas', async () => {
    script = createScript([
      [/Sobre qué comprobante/, 'Facturas'],
      [/Qué factura\?/, 'Factura B'],
      [/A qué la asociamos/, 'A una factura'],
      [/Sobre qué factura B/, '00003-00000014'],
      [/Total o parcial/, BACK],
      [/Sobre qué factura B/, BACK],
      [/A qué la asociamos/, BACK],
      [/Sobre qué comprobante/, BACK],
    ]);

    expect(await note(createSession([invoice()]))).toBeUndefined();
  });

  it('una NC parcial no puede superar a la factura: el error la nombra con su número', async () => {
    script = createScript([
      [/Sobre qué comprobante/, 'Facturas'],
      [/Qué factura\?/, 'Factura B'],
      [/A qué la asociamos/, 'A una factura'],
      [/Sobre qué factura B/, '00003-00000014'],
      [/Total o parcial/, 'Parcial'],
      [/Monto de la nota de crédito/, rejecting('100', ['200', /factura B 00003-00000014/], ['abc', /.+/])],
      [/Agregamos/, []],
    ]);

    expect(await note(createSession([invoice()]))).toMatchObject({ totalAmount: 100 });
  });

  it('una ND no tiene tope: puede superar a la factura', async () => {
    script = createScript([
      [/Sobre qué comprobante/, 'Facturas'],
      [/Qué factura\?/, 'Factura B'],
      [/A qué la asociamos/, 'A una factura'],
      [/Sobre qué factura B/, '00003-00000014'],
      [/Monto de la nota de débito/, '500'],
      [/Agregamos/, []],
    ]);

    expect(await note(createSession([invoice()]), 'debito')).toMatchObject({ shortcut: 'ndb', totalAmount: 500 });
  });

  it('volver desde el hasta vuelve al desde (escrito) y de ahi a la asociación; elegir una factura no deja el período', async () => {
    script = createScript([
      [/Sobre qué comprobante/, 'Facturas'],
      [/Qué factura\?/, 'Factura C'],
      [/A qué la asociamos/, 'A un período'],
      [/Período desde/, BACK],
      [/A qué la asociamos/, 'A un período'],
      [/Período desde/, '1/9'],
      [/Período hasta/, BACK],
      [/Período desde/, BACK],
      [/A qué la asociamos/, 'A una factura'],
      [/Sobre qué factura C/, '00003-00000014'],
      [/Total o parcial/, 'Anular el total'],
      [/Agregamos/, []],
    ]);

    const input = await note(createSession([invoice({ ivaAmount: 0, netAmount: 121 })]));

    expect(input?.associatedPeriod).toBeUndefined();
    expect(input).toMatchObject({ associatedVoucher: { numero: 14 }, shortcut: 'ncc' });
    // REV-60: el desde arranca escrito y la asociacion, marcada.
    expect(script.askTextStep.mock.calls[3]?.[1]).toMatchObject({ previousAnswer: '01/09/2026' });
    expect(
      script.chooseStep.mock.calls.filter(([message]) => /A qué la asociamos/.test(message)).map((call) => call[2]),
    ).toEqual([undefined, 'periodo', 'periodo']);
  });

  it('con un tipo de documento que el asistente no maneja avisa y vuelve a la asociación', async () => {
    script = createScript([
      [/Sobre qué comprobante/, 'Facturas'],
      [/Qué factura\?/, 'Factura C'],
      [/A qué la asociamos/, 'A una factura'],
      [/Sobre qué factura C/, '00003-00000014'],
      [/A qué la asociamos/, BACK],
      [/Sobre qué comprobante/, BACK],
    ]);

    expect(await note(createSession([invoice({ documentNumber: 1234, documentTypeCode: 89 })]))).toBeUndefined();
    expect(printed()).toContain('tipo de documento que el asistente no soporta');
  });

  it('en una de período A: volver desde la alícuota y los opcionales cambia la alícuota', async () => {
    script = createScript([
      [/Sobre qué comprobante/, 'Facturas'],
      [/Qué factura\?/, 'Factura A'],
      [/A qué la asociamos/, 'A un período'],
      [/Período desde/, '1/9'],
      [/Período hasta/, '30/9'],
      [/A quién va la nota/, 'Con CUIT'],
      [/CUIT del receptor/, '30-70996581-2'],
      [/concepto ajusta/, BACK],
      [/CUIT del receptor/, '30-70996581-2'],
      [/concepto ajusta/, 'Productos'],
      [/Monto de la nota de crédito/, '1.000'],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/^Alícuota de IVA:/, BACK],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/^Alícuota de IVA:/, '21%'],
      [/Agregamos/, BACK],
      [/^Alícuota de IVA:/, '10,5%'],
      [/Agregamos/, []],
    ]);

    expect(await note(createSession())).toMatchObject({
      associatedPeriod: { desde: '01/09/2026', hasta: '30/09/2026' },
      concept: 'productos',
      documentNumber: 30709965812,
      ivaRate: '10.5',
      shortcut: 'nca',
    });
  });

  it('en FCE, volver desde "¿El comprador rechazó la factura?" vuelve a la condición IVA', async () => {
    script = createScript([
      [/Sobre qué comprobante/, 'Facturas'],
      [/Qué factura\?/, 'Factura de crédito electrónica A'],
      [/Sobre qué factura de crédito electrónica A/, '00003-00000014'],
      [/Total o parcial/, 'Anular el total'],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/rechazó la factura/, BACK],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/rechazó la factura/, 'No'],
      [/Agregamos/, []],
    ]);

    expect(await note(createSession([invoice({ documentNumber: 30709965812, documentTypeCode: 80 })]))).toMatchObject({
      cancellation: false,
      shortcut: 'ncea',
      totalAmount: 121,
    });
  });
});

describe('runNoteFlow', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(previewAndEmit).mockClear();
    vi.mocked(runExportNoteFlow).mockClear();
    expect(script.remaining()).toBe(0);
  });

  it('sin punto de venta lo pide, y volver ahi sale sin hacer nada', async () => {
    script = createScript([[/Punto de venta/, BACK]]);

    await runNoteFlow(createSession([invoice()], 0), 'credito');

    expect(previewAndEmit).not.toHaveBeenCalled();
  });

  it('arma la nota con el punto de venta escrito y la manda a la vista previa', async () => {
    script = createScript([
      [/Punto de venta/, '3'],
      [/Sobre qué comprobante/, 'Facturas'],
      [/Qué factura\?/, 'Factura B'],
      [/A qué la asociamos/, 'A una factura'],
      [/Sobre qué factura B/, '00003-00000014'],
      [/Total o parcial/, 'Anular el total'],
      [/Agregamos/, []],
    ]);

    await runNoteFlow(createSession([invoice()], 0), 'credito');

    expect(previewAndEmit).toHaveBeenCalledWith(
      expect.objectContaining({ typedPointOfSale: 3 }),
      expect.objectContaining({ shortcut: 'ncb', totalAmount: 121 }),
      [],
    );
  });

  it('volver en el primer paso sale sin vista previa', async () => {
    script = createScript([[/Sobre qué comprobante/, BACK]]);

    await runNoteFlow(createSession([invoice()]), 'debito');

    expect(previewAndEmit).not.toHaveBeenCalled();
  });

  it('una nota E se emite en su asistente: no hay otra vista previa', async () => {
    script = createScript([
      [/Sobre qué comprobante/, 'Facturas'],
      [/Qué factura\?/, 'Factura de exportación E'],
    ]);

    await runNoteFlow(createSession([invoice()]), 'credito');

    expect(runExportNoteFlow).toHaveBeenCalledOnce();
    expect(previewAndEmit).not.toHaveBeenCalled();
  });
});

// REV-60: "Volver" lleva a la pregunta anterior y lo respondido arranca marcado o escrito.
describe('notas: volver con lo respondido', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  /** El valor con que arranco cada vez la pregunta `question`. */
  function defaultsOf(question: RegExp): unknown[] {
    return script.chooseStep.mock.calls.filter(([message]) => question.test(message)).map((call) => call[2]);
  }

  it('la moneda de la nota arranca en la elegida al volver desde el monto', async () => {
    script = createScript([
      [/Sobre qué comprobante/, 'Facturas'],
      [/Qué factura\?/, 'Factura B'],
      [/A qué la asociamos/, 'A una factura'],
      [/Sobre qué factura B/, '00003-00000014'],
      [/En qué moneda va la nota/, 'En pesos'],
      [/Monto de la nota de crédito/, '50'],
      [/Agregamos/, BACK],
      [/Monto de la nota de crédito/, BACK],
      [/En qué moneda va la nota/, 'En pesos'],
      [/Monto de la nota de crédito/, '60'],
      [/Agregamos/, []],
    ]);

    const input = await note(createSession([invoice({ currency: 'DOL', exchangeRate: 1450 })]));

    expect(input).toMatchObject({ currencyCode: 'PES', totalAmount: 60 });
    expect(defaultsOf(/En qué moneda va la nota/)).toEqual([undefined, 'pesos']);
    expect(script.askTextStep.mock.calls.map((call) => call[1]?.previousAnswer)).toEqual([undefined, '50', '50']);
  });

  it('"Total o parcial" es una pregunta y el monto otra: volver del monto vuelve a "Parcial" marcado', async () => {
    script = createScript([
      [/Sobre qué comprobante/, 'Facturas'],
      [/Qué factura\?/, 'Factura C'],
      [/A qué la asociamos/, 'A una factura'],
      [/Sobre qué factura C/, '00003-00000014'],
      [/Total o parcial/, 'Parcial'],
      [/Monto de la nota de crédito/, BACK],
      [/Total o parcial/, 'Anular el total'],
      [/Agregamos/, BACK],
      [/Total o parcial/, 'Anular el total'],
      [/Agregamos/, []],
    ]);

    const input = await note(createSession([invoice({ ivaAmount: 0, netAmount: 121 })]));

    expect(input).toMatchObject({ totalAmount: 121 });
    expect(defaultsOf(/Total o parcial/)).toEqual([undefined, 'parcial', 'total']);
    // La factura elegida tambien arranca marcada si se vuelve hasta la lista.
    expect(defaultsOf(/Sobre qué factura C/)).toEqual([undefined]);
  });

  it('la alícuota de una nota por período arranca en la elegida al volver desde los opcionales', async () => {
    script = createScript([
      [/Sobre qué comprobante/, 'Facturas'],
      [/Qué factura\?/, 'Factura B'],
      [/A qué la asociamos/, 'A un período'],
      [/Período desde/, '1/9'],
      [/Período hasta/, '30/9'],
      [/A quién va la nota/, 'Consumidor final'],
      [/Qué concepto ajusta/, 'Servicios'],
      [/Monto de la nota de crédito/, '100'],
      [/Alícuota de IVA/, '10,5%'],
      [/Agregamos/, BACK],
      [/Alícuota de IVA/, BACK],
      [/Monto de la nota de crédito/, '100'],
      [/Alícuota de IVA/, '10,5%'],
      [/Agregamos/, []],
    ]);

    expect(await note(createSession([invoice()]))).toMatchObject({ ivaRate: '10.5' });
    expect(defaultsOf(/Alícuota de IVA/)).toEqual(['21', '10.5', '10.5']);
    expect(defaultsOf(/A quién va la nota/)).toEqual([undefined]);
  });
});
