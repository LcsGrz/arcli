import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingService } from '../../../modules/billing/billing.service';
import { buildInvoiceInput } from '../../../modules/interactive/invoice-input';
import { BACK, runWizard } from '../../../modules/interactive/wizard';
import {
  type IssuedVoucher,
  type VoucherHistoryGateway,
  VoucherQueryError,
} from '../../../modules/vouchers/voucher-history';
import type { ArcaClient } from '../../../services/arca/arca-client.factory';
import { ArcaVoucherHistoryGateway } from '../../../services/arca/arca-voucher-history.gateway';
import { systemClock } from '../../../services/time/system-clock';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
import { runExportRepeatFlow } from '../export-repeat.flow';
import { type RepeatState, repeatSteps, runRepeatFlow } from '../repeat.flow';
import { type InteractiveSession, previewAndEmit } from '../session';

import { createScript, rejecting } from './script';

let script = createScript([]);

vi.mock('../export-repeat.flow', () => ({ runExportRepeatFlow: vi.fn(async () => undefined) }));

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

const TODAY = new Date('2026-10-05T15:00:00Z');
const INITIAL: RepeatState = { advanced: { currencyCode: 'ARS', sameCurrency: false } };

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
      config: { cert: {}, entornoPorDefecto: 'testing', key: {}, output: {} },
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
  ivaAmount: 0,
  netAmount: 121,
  number: 14,
  total: 121,
  ...overrides,
});

async function repeat(session: InteractiveSession) {
  const state = await runWizard(repeatSteps(session, 3, TODAY), INITIAL);

  return state && buildInvoiceInput(state, session.runtime);
}

function printed(): string {
  return stripAnsi(
    vi
      .mocked(process.stdout.write)
      .mock.calls.map(([chunk]) => String(chunk))
      .join(''),
  );
}

describe('repetir un comprobante', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(previewAndEmit).mockClear();
    vi.mocked(runExportRepeatFlow).mockClear();
    expect(script.remaining()).toBe(0);
  });

  it('volver desde la lista vuelve al tipo, y otro tipo arma ese comprobante', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura A'],
      [/Cuál repetimos/, BACK],
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Mismo monto/, 'Sí'],
      [/Período del servicio/, 'Un solo día'],
      [/Agregamos/, []],
    ]);

    expect(await repeat(createSession([invoice()]))).toMatchObject({ shortcut: 'fc', totalAmount: 121 });
  });

  it('si falla la primera tanda, sigue en la lista con lo respondido y se puede reintentar (ERR-1)', async () => {
    const errors = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const session = createSession([invoice()]);
    let failed = false;

    vi.spyOn(session.historyGateway, 'getVoucher').mockImplementation(async (number) => {
      if (!failed) {
        failed = true;
        throw new VoucherQueryError('600 ValidacionDeToken', { errores: [] }, 'Volvé a consultar.', '600');
      }

      return number === 14 ? invoice() : undefined;
    });
    script = createScript([
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, 'Volver a cargar'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Mismo monto/, 'Sí'],
      [/Período del servicio/, 'Un solo día'],
      [/Agregamos/, []],
    ]);

    expect(await repeat(session)).toMatchObject({ shortcut: 'fc', totalAmount: 121 });
    expect(errors.mock.calls.join('')).toContain('600 ValidacionDeToken');
    expect(printed()).not.toContain('en el punto de venta 3');
  });

  it('con un tipo de documento que el asistente no maneja avisa y vuelve al tipo', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000014'],
      [/comprobante querés repetir/, BACK],
    ]);

    expect(await repeat(createSession([invoice({ documentNumber: 1234, documentTypeCode: 89 })]))).toBeUndefined();
    expect(printed()).toContain('tipo de documento que el asistente no soporta');
  });

  it('volver desde "¿Mismo monto?" vuelve a la lista y otra factura reemplaza todo lo copiado', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000015'],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/Mismo monto/, BACK],
      [/Condición frente al IVA/, BACK],
      [/Cuál repetimos/, '00003-00000014'],
      [/Mismo monto/, 'Sí'],
      [/Período del servicio/, 'Un solo día'],
      [/Agregamos/, []],
    ]);

    const session = createSession([
      invoice(),
      invoice({ currency: 'DOL', documentNumber: 20111111112, documentTypeCode: 80, number: 15, total: 500 }),
    ]);

    // La 15 era en dolares y a un CUIT: no queda nada de ella.
    expect(await repeat(session)).toMatchObject({
      currencyCode: 'ARS',
      documentNumber: 0,
      documentType: 'consumidor-final',
      totalAmount: 121,
    });
  });

  it('volver desde el monto escrito vuelve a "¿Mismo monto?" con "No" marcado, y "Sí" deja el del original', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Mismo monto/, 'No'],
      [/Monto total:/, '150'],
      [/Período del servicio/, BACK],
      [/Monto total:/, BACK],
      [/Mismo monto/, 'Sí'],
      [/Período del servicio/, 'Un solo día'],
      [/Agregamos/, []],
    ]);

    expect(await repeat(createSession([invoice()]))).toMatchObject({ totalAmount: 121 });
    expect(script.askTextStep.mock.calls[1]?.[1]).toMatchObject({ previousAnswer: '150' });
    expect(
      script.chooseStep.mock.calls.filter(([message]) => /Mismo monto/.test(message)).map((call) => call[2]),
    ).toEqual([undefined, 'otro']);
  });

  it('volver desde la cotización vuelve a cómo te pagan, y la cotización escrita no queda', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Mismo monto/, 'Sí'],
      [/Cómo te pagan/, 'En pesos'],
      [/Cotización de USD/, '1.200'],
      [/Período del servicio/, BACK],
      [/Cotización de USD/, BACK],
      [/Cómo te pagan/, 'En pesos'],
      [/Cotización de USD/, BACK],
      [/Cómo te pagan/, BACK],
      [/Mismo monto/, 'No'],
      [/Monto total en USD/, '200'],
      [/Cómo te pagan/, 'En dólares'],
      [/Período del servicio/, 'Un solo día'],
      [/Agregamos/, []],
    ]);

    expect(await repeat(createSession([invoice({ currency: 'DOL', exchangeRate: 980 })]))).toMatchObject({
      currencyCode: 'USD',
      exchangeRate: undefined,
      sameCurrency: true,
      totalAmount: 200,
    });
    expect(printed()).toContain('El comprobante original era en USD: se repite en USD con una cotización nueva.');
    // REV-60: la cotización y cómo te pagan arrancan con lo respondido.
    expect(script.askTextStep.mock.calls.map((call) => call[1]?.previousAnswer).slice(0, 3)).toEqual([
      undefined,
      '1200',
      '1200',
    ]);
    // Cómo te pagan no depende del monto: cambiarlo no la olvida.
    expect(
      script.chooseStep.mock.calls.filter(([message]) => /Cómo te pagan/.test(message)).map((call) => call[2]),
    ).toEqual([undefined, 'pesos', 'pesos', 'pesos']);
  });

  it('"Otro período" pide desde y hasta; volver desde el período vuelve al monto', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Mismo monto/, 'Sí'],
      [/Período del servicio/, BACK],
      [/Mismo monto/, 'Sí'],
      [/Período del servicio/, 'Otro período'],
      [/Servicio desde/, '10/09/2026'],
      [/Servicio hasta/, '20/09/2026'],
      [/Agregamos/, []],
    ]);

    expect(await repeat(createSession([invoice()]))).toMatchObject({
      serviceEndDate: '20/09/2026',
      serviceStartDate: '10/09/2026',
    });
  });

  it('volver desde las fechas de "Otro período" vuelve a la anterior, y "Un solo día" no deja las fechas ya elegidas', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Mismo monto/, 'Sí'],
      [/Período del servicio/, 'Este mes'],
      [/Agregamos/, BACK],
      [/Período del servicio/, 'Otro período'],
      [/Servicio desde/, '10/09/2026'],
      [/Servicio hasta/, BACK],
      [/Servicio desde/, BACK],
      [/Período del servicio/, 'Un solo día'],
      [/Agregamos/, []],
    ]);

    expect(await repeat(createSession([invoice()]))).toMatchObject({
      serviceEndDate: undefined,
      serviceStartDate: undefined,
    });
    expect(script.askTextStep.mock.calls[2]?.[1]).toMatchObject({ previousAnswer: '10/09/2026' });
    expect(
      script.chooseStep.mock.calls.filter(([message]) => /Período del servicio/.test(message)).map((call) => call[2]),
    ).toEqual([undefined, 'actual', 'otro']);
  });

  it('un producto no pregunta el período', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Mismo monto/, 'Sí'],
      [/Agregamos/, []],
    ]);

    expect(await repeat(createSession([invoice({ concept: 1 })]))).toMatchObject({ concept: 'productos' });
  });
});

describe('repetir: lo que se copia, como en la E (ARQ-22)', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  const notice = () => printed().replace(/[│┃╏║\s]+/g, ' ');
  const payment = () => script.chooseStep.mock.calls.filter(([message]) => /Cómo te pagan/.test(message));

  it('lo dice al elegir el comprobante', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Mismo monto/, BACK],
      [/Cuál repetimos/, BACK],
      [/comprobante querés repetir/, BACK],
    ]);

    await repeat(createSession([invoice()]));

    expect(notice()).toContain(
      'Se copian el receptor (consumidor final), el concepto, la moneda y el monto. Las fechas son nuevas.',
    );
  });

  it('con la alícuota, la moneda extranjera y sin el receptor que la letra no admite', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura A'],
      [/Cuál repetimos/, '00003-00000014'],
      [/CUIT del receptor/, BACK],
      [/Cuál repetimos/, BACK],
      [/comprobante querés repetir/, BACK],
    ]);

    await repeat(
      createSession([
        invoice({ currency: 'DOL', documentNumber: 20123456, documentTypeCode: 96, ivaAmount: 21, netAmount: 100 }),
      ]),
    );

    expect(notice()).toContain(
      'Se copian el concepto, la moneda, el monto y la alícuota. Las fechas y la cotización son nuevas.',
    );
  });

  it.each<[string, Partial<IssuedVoucher>, string]>([
    [
      'sin concepto',
      { concept: undefined },
      'Se copian el receptor (consumidor final), la moneda, el monto y la alícuota.',
    ],
    [
      'con exento y no gravado',
      { exemptAmount: 10, ivaAmount: 21, netAmount: 100, untaxedAmount: 5 },
      'el monto, la alícuota, el importe exento y el no gravado.',
    ],
    ['con no gravado', { ivaAmount: 21, netAmount: 100, untaxedAmount: 5 }, 'la alícuota y el importe no gravado.'],
  ])('%s', async (_name, overrides, expected) => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura B'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Mismo monto/, BACK],
      [/Cuál repetimos/, BACK],
      [/comprobante querés repetir/, BACK],
    ]);

    await repeat(createSession([invoice(overrides)]));

    expect(notice()).toContain(expected);
  });

  it('si no se puede reproducir el monto no dice que lo copia', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Monto total/, BACK],
      [/Cuál repetimos/, BACK],
      [/comprobante querés repetir/, BACK],
    ]);

    await repeat(createSession([invoice({ taxesAmount: 10 })]));

    expect(notice()).toContain('Se copian el receptor (consumidor final), el concepto y la moneda. Las fechas');
    expect(notice()).toContain('tributos o percepciones');
  });

  it.each([
    [true, 'moneda'],
    [false, undefined],
    [undefined, undefined],
  ])('cómo te pagan arranca en lo del original (%s: %s)', async (sameCurrency, marked) => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Mismo monto/, 'Sí'],
      [/Cómo te pagan/, 'En dólares'],
      [/Período del servicio/, 'Un solo día'],
      [/Agregamos/, []],
    ]);

    expect(await repeat(createSession([invoice({ currency: 'DOL', exchangeRate: 980, sameCurrency })]))).toMatchObject({
      currencyCode: 'USD',
      sameCurrency: true,
    });
    expect(payment().map((call) => call[2])).toEqual([marked]);
  });

  it('otra respuesta gana, y con otro comprobante arranca en lo de ese', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Mismo monto/, 'Sí'],
      [/Cómo te pagan/, 'En pesos'],
      [/Cotización de USD/, BACK],
      [/Cómo te pagan/, BACK],
      [/Mismo monto/, BACK],
      [/Cuál repetimos/, '00003-00000015'],
      [/Mismo monto/, 'Sí'],
      [/Cómo te pagan/, 'En pesos'],
      [/Cotización de USD/, '1.200'],
      [/Período del servicio/, 'Un solo día'],
      [/Agregamos/, []],
    ]);

    const foreign = { currency: 'DOL', exchangeRate: 980, sameCurrency: true };

    expect(await repeat(createSession([invoice(foreign), invoice({ ...foreign, number: 15 })]))).toMatchObject({
      exchangeRate: 1200,
      sameCurrency: false,
    });
    expect(payment().map((call) => call[2])).toEqual(['moneda', 'pesos', 'moneda']);
  });

  it('en pesos, un `sameCurrency` del original no va', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Mismo monto/, 'Sí'],
      [/Período del servicio/, 'Un solo día'],
      [/Agregamos/, []],
    ]);

    expect(await repeat(createSession([invoice({ currency: 'PES', sameCurrency: true })]))).toMatchObject({
      sameCurrency: false,
    });
  });
});

describe('runRepeatFlow', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(previewAndEmit).mockClear();
    vi.mocked(runExportRepeatFlow).mockClear();
    expect(script.remaining()).toBe(0);
  });

  it('sin punto de venta lo pide, y volver ahi sale sin repetir nada', async () => {
    script = createScript([[/Punto de venta/, BACK]]);

    await runRepeatFlow(createSession([invoice()], 0));

    expect(previewAndEmit).not.toHaveBeenCalled();
  });

  it('con el punto de venta escrito busca en ese y muestra la vista previa', async () => {
    script = createScript([
      [/Punto de venta/, '3'],
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Mismo monto/, 'Sí'],
      [/Período del servicio/, 'Un solo día'],
      [/Agregamos/, []],
    ]);

    await runRepeatFlow(createSession([invoice()], 0));

    expect(previewAndEmit).toHaveBeenCalledWith(
      expect.objectContaining({ typedPointOfSale: 3 }),
      expect.objectContaining({ shortcut: 'fc', totalAmount: 121 }),
    );
  });

  it('volver en el primer paso sale sin vista previa', async () => {
    script = createScript([[/comprobante querés repetir/, BACK]]);

    await runRepeatFlow(createSession([invoice()]));

    expect(previewAndEmit).not.toHaveBeenCalled();
  });

  it('la E emite en su propio asistente: no hay otra vista previa', async () => {
    script = createScript([[/comprobante querés repetir/, 'Factura de exportación E']]);

    await runRepeatFlow(createSession([invoice()]));

    expect(runExportRepeatFlow).toHaveBeenCalledOnce();
    expect(previewAndEmit).not.toHaveBeenCalled();
  });
});

describe('repetir un comprobante con datos que ya no valen', () => {
  const preview = async (input: ReturnType<typeof buildInvoiceInput>) =>
    new BillingService({ clock: systemClock }).preview({
      input: { ...input, dryRun: true, emit: false },
      runtime: createSession().runtime,
      warnings: [],
    });

  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  it('una Factura A a un DNI (ARCA pide CUIT, 10013) avisa al elegirla y pide el CUIT, y la vista previa pasa (REV-62)', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura A'],
      [/Cuál repetimos/, '00003-00000014'],
      [/CUIT del receptor/, rejecting('30-70996581-2', ['30123456', /CUIT/])],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/Mismo monto/, 'Sí'],
      [/Período del servicio/, 'Un solo día'],
      [/Agregamos/, []],
    ]);

    const session = createSession([
      invoice({ documentNumber: 30123456, documentTypeCode: 96, ivaAmount: 21, netAmount: 100 }),
    ]);
    const state = await runWizard(repeatSteps(session, 3, TODAY), INITIAL);
    const input = buildInvoiceInput(state as NonNullable<typeof state>, session.runtime);

    expect(printed()).toMatch(/La factura A original fue a un DNI.*10013/s);
    expect(input).toMatchObject({ documentNumber: 30709965812, documentType: 'cuit', shortcut: 'fa' });
    await expect(preview(input)).resolves.toBeDefined();
  });

  it('un comprobante de un concepto que ARCA ya no informa se repite como servicios', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Mismo monto/, 'Sí'],
      [/Período del servicio/, 'Un solo día'],
      [/Agregamos/, []],
    ]);

    const session = createSession([invoice({ concept: 9 })]);
    const state = await runWizard(repeatSteps(session, 3, TODAY), INITIAL);

    expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({
      concept: 'servicios',
    });
  });

  it('un comprobante con datos raros (sin CAE, total 0) igual se puede elegir y pide otro monto', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Mismo monto/, 'No'],
      [/Monto total/, '100'],
      [/Período del servicio/, 'Un solo día'],
      [/Agregamos/, []],
    ]);

    const session = createSession([invoice({ cae: undefined as never, ivaAmount: 0, netAmount: 0, total: 0 })]);
    const state = await runWizard(repeatSteps(session, 3, TODAY), INITIAL);

    expect(buildInvoiceInput(state as NonNullable<typeof state>, session.runtime)).toMatchObject({ totalAmount: 100 });
  });
});

/** ARQ-24: sin el último número no se sabe qué hay para repetir; no se ofrece "No hay" ni se llega a emitir. */
describe('repetir, si ARCA contesta sin el último número (ARQ-24)', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(previewAndEmit).mockClear();
    expect(script.remaining()).toBe(0);
  });

  // Tests primero (ARQ-24): pasa a it() al implementarlo.
  it.fails.each(['Factura A', 'Factura B', 'Factura C', 'Recibo C'])(
    '%s: ARCA_LAST_VOUCHER_ERROR y no hay vista previa',
    async (kind) => {
      const session: InteractiveSession = {
        ...createSession(),
        historyGateway: new ArcaVoucherHistoryGateway({
          electronicBillingService: { getLastVoucher: async () => ({}) },
          genericService: { call: vi.fn() },
        } as unknown as ArcaClient),
      };

      script = createScript([[/comprobante querés repetir/, kind]]);

      const error: unknown = await runRepeatFlow(session).catch((reason: unknown) => reason);

      expect(error).toMatchObject({ code: 'ARCA_LAST_VOUCHER_ERROR', details: { errores: [] } });
      expect(printed()).not.toContain('No hay');
      expect(previewAndEmit).not.toHaveBeenCalled();
    },
  );
});
