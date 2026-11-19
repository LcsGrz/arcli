import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingService } from '../../../modules/billing/billing.service';
import { BACK, runWizard } from '../../../modules/interactive/wizard';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import { runExportFlow } from '../export.flow';
import { buildInvoiceInput, invoiceSteps, runInvoiceFlow } from '../invoice.flow';
import { type InteractiveSession, previewAndEmit } from '../session';

import { createScript, rejecting } from './script';

let script = createScript([]);
const savedConfig = vi.fn();

vi.mock('../export.flow', () => ({ runExportFlow: vi.fn(async () => undefined) }));

vi.mock('../session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../session')>()),
  previewAndEmit: vi.fn(async () => undefined),
}));

vi.mock('../../../modules/config/config.service', () => ({
  ConfigService: class {
    public close() {}
    public setValue(key: string, value: string) {
      savedConfig(key, value);
    }
  },
}));

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  confirm: (message: string, yesLabel: string, noLabel = 'Cancelar') =>
    script.chooseStep(message, [
      { name: yesLabel, value: true },
      { name: noLabel, value: false },
    ]),
  eraseLastAnswer: () => undefined,
  fitPageSize: () => 12,
}));

function createSession(config: Record<string, unknown> = {}, pointOfSale = 3): InteractiveSession {
  return {
    arca: {} as never,
    billingGateway: { createVoucher: vi.fn(), getNextVoucherNumber: vi.fn(), getQuotation: vi.fn() },
    historyGateway: { getLastNumber: vi.fn(), getVoucher: vi.fn() },
    runtime: {
      config: { cert: {}, consultarPadron: false, entornoPorDefecto: 'testing', key: {}, output: {}, ...config },
      context: { cuit: 20333333334 },
      environment: 'testing',
      outputJson: false,
      outputRaw: false,
      pointOfSale,
    } as unknown as ResolvedArcaRuntime,
    service: new BillingService(),
  };
}

const PESOS = { advanced: { currencyCode: 'ARS', sameCurrency: false } } as const;

async function invoice(session = createSession()) {
  const state = await runWizard(invoiceSteps(session), PESOS);

  return state && buildInvoiceInput(state, session);
}

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(previewAndEmit).mockClear();
  vi.mocked(runExportFlow).mockClear();
  savedConfig.mockClear();
  expect(script.remaining()).toBe(0);
});

describe('factura: volver y cambiar respuestas', () => {
  it('de un CUIT a consumidor final no queda el CUIT ni su condición IVA', async () => {
    script = createScript([
      [/comprobante/, 'Factura B'],
      [/A quién/, 'Con CUIT'],
      [/CUIT del receptor/, '30-70996581-2'],
      [/Condición frente al IVA/, 'Sujeto exento'],
      [/Qué estás facturando/, BACK],
      [/Condición frente al IVA/, BACK],
      [/CUIT del receptor/, BACK],
      [/A quién/, 'Consumidor final'],
      [/Qué estás facturando/, 'Servicios'],
      [/Monto total/, '100'],
      [/Agregamos/, []],
    ]);

    // El 0 de consumidor final, como `--cf` (REV-61), no el CUIT de antes.
    expect(await invoice()).toMatchObject({
      documentNumber: 0,
      documentType: 'consumidor-final',
      ivaCondition: 'consumidor-final',
    });
  });

  it('volver desde el monto y desde los opcionales deja cambiar el concepto y el monto', async () => {
    script = createScript([
      [/comprobante/, 'Factura C'],
      [/A quién/, 'Consumidor final'],
      [/Qué estás facturando/, 'Servicios'],
      [/Monto total/, rejecting('1.000', ['0', /mayor a 0|monto/i], ['abc', /.+/])],
      [/Agregamos/, BACK],
      [/Monto total/, BACK],
      [/Qué estás facturando/, 'Productos'],
      [/Monto total/, '2.000'],
      [/Agregamos/, []],
    ]);

    expect(await invoice()).toMatchObject({ concept: 'productos', totalAmount: 2000 });
  });

  it('en una FCE, volver desde el alias vuelve al CBU y desde el CBU al monto, con lo escrito; el CBU nuevo reemplaza al anterior', async () => {
    script = createScript([
      [/comprobante/, 'Factura de crédito electrónica A'],
      [/A quién/, 'Con CUIT'],
      [/CUIT del receptor/, '30-70996581-2'],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/Qué estás facturando/, 'Servicios'],
      [/Monto total/, '5.000.000'],
      [/CBU/, BACK],
      [/Monto total/, '5.000.000'],
      [/CBU/, '0110599520000012345678'],
      [/Alias del CBU/, BACK],
      [/CBU/, BACK],
      [/Monto total/, '5.000.000'],
      [/CBU/, rejecting('0170099220000067797370', ['123', /22/])],
      [/Alias del CBU/, ''],
      [/Agregamos/, BACK],
      [/Alias del CBU/, 'otro.alias'],
      [/Agregamos/, []],
    ]);

    expect(await invoice()).toMatchObject({ cbu: '0170099220000067797370', cbuAlias: 'otro.alias' });

    const previousAnswers = script.askTextStep.mock.calls.map(([message, options]) => [
      message.split(' ')[0],
      options?.previousAnswer,
    ]);

    expect(previousAnswers).toEqual([
      ['CUIT', undefined],
      ['Monto', undefined],
      ['CBU', undefined],
      ['Monto', '5000000'],
      ['CBU', undefined],
      ['Alias', undefined],
      ['CBU', '0110599520000012345678'],
      ['Monto', '5000000'],
      ['CBU', '0110599520000012345678'],
      ['Alias', undefined],
      ['Alias', undefined],
    ]);
  });

  it('volver desde "¿Qué comprobante?" sale del flujo', async () => {
    script = createScript([[/comprobante/, BACK]]);

    expect(await invoice()).toBeUndefined();
  });
});

// REV-60: "Volver" lleva a la pregunta anterior y lo respondido arranca marcado o escrito.
describe('factura: volver con lo respondido', () => {
  function defaultsOf(question: RegExp): unknown[] {
    return script.chooseStep.mock.calls.filter(([message]) => question.test(message)).map((call) => call[2]);
  }

  it('volver una a una hasta el comprobante: cada pregunta arranca con lo respondido', async () => {
    script = createScript([
      [/comprobante/, 'Factura A'],
      [/A quién/, 'Con CUIT'],
      [/CUIT del receptor/, '30-70996581-2'],
      [/Condición frente al IVA/, 'Responsable monotributo'],
      [/Qué estás facturando/, 'Productos'],
      [/Monto total/, '1.500,50'],
      [/Agregamos/, BACK],
      [/Monto total/, BACK],
      [/Qué estás facturando/, BACK],
      [/Condición frente al IVA/, BACK],
      [/CUIT del receptor/, BACK],
      [/A quién/, BACK],
      [/comprobante/, 'Factura A'],
      [/A quién/, 'Con CUIT'],
      [/CUIT del receptor/, '30-70996581-2'],
      [/Condición frente al IVA/, 'Responsable monotributo'],
      [/Qué estás facturando/, 'Productos'],
      [/Monto total/, '1.500,50'],
      [/Agregamos/, []],
    ]);

    expect(await invoice()).toMatchObject({
      concept: 'productos',
      ivaCondition: 'responsable-monotributo',
      totalAmount: 1500.5,
    });
    expect(defaultsOf(/comprobante/)[1]).toMatchObject({ shortcut: 'fa' });
    expect(defaultsOf(/A quién/)).toEqual([undefined, 'cuit', 'cuit']);
    expect(defaultsOf(/Condición frente al IVA/)).toEqual([
      undefined,
      'responsable-monotributo',
      'responsable-monotributo',
    ]);
    expect(defaultsOf(/Qué estás facturando/)).toEqual([undefined, 'productos', 'productos']);
    expect(script.askTextStep.mock.calls.map(([message, options]) => [message, options?.previousAnswer])).toEqual([
      ['CUIT del receptor:', undefined],
      ['Monto total:', undefined],
      ['Monto total:', '1500,50'],
      ['CUIT del receptor:', '30709965812'],
      ['CUIT del receptor:', '30709965812'],
      ['Monto total:', '1500,50'],
    ]);
  });

  // REV-65: cambiar una respuesta olvida solo las que dependen de ella.
  it('si cambia el comprobante, el receptor se pregunta de cero, pero el concepto y el monto arrancan con lo respondido', async () => {
    script = createScript([
      [/comprobante/, 'Factura A'],
      [/A quién/, 'Con CUIT'],
      [/CUIT del receptor/, '30-70996581-2'],
      [/Condición frente al IVA/, 'Responsable monotributo'],
      [/Qué estás facturando/, 'Productos'],
      [/Monto total/, '1.500,50'],
      [/Agregamos/, BACK],
      [/Monto total/, BACK],
      [/Qué estás facturando/, BACK],
      [/Condición frente al IVA/, BACK],
      [/CUIT del receptor/, BACK],
      [/A quién/, BACK],
      [/comprobante/, 'Factura B'],
      [/A quién/, 'Con CUIT'],
      [/CUIT del receptor/, '30-70996581-2'],
      [/Condición frente al IVA/, 'Sujeto exento'],
      [/Qué estás facturando/, 'Productos'],
      [/Monto total/, '1.500,50'],
      [/Agregamos/, []],
    ]);

    expect(await invoice()).toMatchObject({ ivaCondition: 'sujeto-exento', shortcut: 'fb', totalAmount: 1500.5 });
    expect(defaultsOf(/A quién/)).toEqual([undefined, 'cuit', undefined]);
    expect(defaultsOf(/Condición frente al IVA/)).toEqual([undefined, 'responsable-monotributo', undefined]);
    expect(defaultsOf(/Qué estás facturando/)).toEqual([undefined, 'productos', 'productos']);
    expect(script.askTextStep.mock.calls.map(([message, options]) => [message, options?.previousAnswer])).toEqual([
      ['CUIT del receptor:', undefined],
      ['Monto total:', undefined],
      ['Monto total:', '1500,50'],
      ['CUIT del receptor:', '30709965812'],
      ['CUIT del receptor:', undefined],
      ['Monto total:', '1500,50'],
    ]);
  });

  it('si cambia el tipo de receptor, el número escrito antes no se ofrece', async () => {
    script = createScript([
      [/comprobante/, 'Factura B'],
      [/A quién/, 'Con DNI'],
      [/DNI del receptor/, '30123456'],
      [/Condición frente al IVA/, BACK],
      [/DNI del receptor/, BACK],
      [/A quién/, 'Con CUIT'],
      [/CUIT del receptor/, '30-70996581-2'],
      [/Condición frente al IVA/, 'Sujeto exento'],
      [/Qué estás facturando/, 'Servicios'],
      [/Monto total/, '100'],
      [/Agregamos/, []],
    ]);

    expect(await invoice()).toMatchObject({ documentNumber: 30709965812, documentType: 'cuit' });
    expect(script.askTextStep.mock.calls.map((call) => call[1]?.previousAnswer)).toEqual([
      undefined,
      '30123456',
      undefined,
      undefined,
    ]);
  });
});

describe('runInvoiceFlow', () => {
  it('sin punto de venta lo pide; volver ahi sale sin preguntar el comprobante', async () => {
    script = createScript([[/Punto de venta/, BACK]]);

    expect(await runInvoiceFlow(createSession({}, 0))).toBe(BACK);
    expect(previewAndEmit).not.toHaveBeenCalled();
  });

  it('volver en el primer paso devuelve BACK, sin vista previa', async () => {
    script = createScript([[/comprobante/, BACK]]);

    expect(await runInvoiceFlow(createSession())).toBe(BACK);
    expect(previewAndEmit).not.toHaveBeenCalled();
  });

  it('la E emite en su asistente: no hay otra vista previa', async () => {
    script = createScript([[/comprobante/, 'Factura de exportación E']]);

    expect(await runInvoiceFlow(createSession())).toBeUndefined();
    expect(runExportFlow).toHaveBeenCalledOnce();
    expect(previewAndEmit).not.toHaveBeenCalled();
  });

  it('con un receptor del padrón no pregunta a quién ni su condición, y no ofrece la E', async () => {
    script = createScript([
      [/comprobante/, 'Factura A'],
      [/Qué estás facturando/, 'Servicios'],
      [/Monto total/, '1210'],
      [/Agregamos/, []],
    ]);

    await runInvoiceFlow(createSession(), false, {
      address: 'Calle 1',
      cuit: 30709965812,
      ivaCondition: 'responsable-inscripto',
      name: 'CLIENTE SA',
    } as never);

    expect(script.chooseStep.mock.calls[0]?.[1]).not.toContainEqual(
      expect.objectContaining({ name: expect.stringContaining('exportación') }),
    );
    expect(previewAndEmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ documentNumber: 30709965812, ivaCondition: 'responsable-inscripto', shortcut: 'fa' }),
    );
  });

  it('una FCE con CBU escrito a mano ofrece guardarlo despues de la vista previa', async () => {
    script = createScript([
      [/comprobante/, 'Factura de crédito electrónica A'],
      [/A quién/, 'Con CUIT'],
      [/CUIT del receptor/, '30-70996581-2'],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/Qué estás facturando/, 'Servicios'],
      [/Monto total/, '5.000.000'],
      [/CBU/, '0110599520000012345678'],
      [/Alias del CBU/, ''],
      [/Agregamos/, []],
      [/Guardamos el CBU en la config/, 'Sí, guardar'],
    ]);

    await runInvoiceFlow(createSession());

    expect(previewAndEmit).toHaveBeenCalledOnce();
    expect(savedConfig).toHaveBeenCalledWith('cbu', '0110599520000012345678');
  });

  it('si la vista previa falla (ARCA no responde), no ofrece guardar el CBU', async () => {
    vi.mocked(previewAndEmit).mockRejectedValueOnce(new Error('ARCA no responde'));
    script = createScript([
      [/comprobante/, 'Factura de crédito electrónica A'],
      [/A quién/, 'Con CUIT'],
      [/CUIT del receptor/, '30-70996581-2'],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/Qué estás facturando/, 'Servicios'],
      [/Monto total/, '5.000.000'],
      [/CBU/, '0110599520000012345678'],
      [/Alias del CBU/, ''],
      [/Agregamos/, []],
    ]);

    await expect(runInvoiceFlow(createSession())).rejects.toThrow('ARCA no responde');
    expect(savedConfig).not.toHaveBeenCalled();
  });
});
