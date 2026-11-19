import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getVoucherKindByShortcut } from '../../../modules/billing/voucher-kind-map';
import { BACK } from '../../../modules/interactive/wizard';
import type { IssuedVoucher } from '../../../modules/vouchers/voucher-history';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import { stripAnsi } from '../../../ui';
import { missingNonWebServiceInvoiceNotice, pickInvoice, pickNoteInvoice } from '../invoice-picker';
import type { InteractiveSession } from '../session';

import { createScript } from './script';

let script = createScript([]);
/** Lo que devuelve la proxima lista que se muestra mientras carga: la carga, o una opcion elegida antes. */
const whileLoading = vi.hoisted(() => ({ answer: undefined as string | undefined }));

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  chooseStepWhileLoading: async (
    message: string,
    choices: Parameters<typeof script.chooseStep>[1],
    defaultValue: unknown,
    pageSize: number,
    loading: Promise<unknown>,
  ) => {
    if (whileLoading.answer === undefined) {
      return script.chooseStepWhileLoading(message, choices, defaultValue, pageSize, loading);
    }

    whileLoading.answer = undefined;

    // Se elige una opcion antes de que termine la carga.
    return { answer: await script.chooseStep(message, choices) };
  },
  eraseLastAnswer: () => undefined,
  fitPageSize: () => 12,
}));

const getSalesPoints = vi.fn(async () => [{ blocked: false, number: 3 }]);

vi.mock('../../../services/arca/arca-parameters.gateway', () => ({
  ArcaParametersGateway: class {
    public getSalesPoints = getSalesPoints;
  },
}));

const invoice = (number: number): IssuedVoucher => ({
  cae: '86400940834693',
  concept: 2,
  date: '20261001',
  documentNumber: 0,
  documentTypeCode: 99,
  ivaAmount: 21,
  netAmount: 100,
  number,
  total: 121,
});

function createSession(vouchers: IssuedVoucher[], rows = 2): InteractiveSession {
  return {
    arca: {} as never,
    billingGateway: { createVoucher: vi.fn(), getNextVoucherNumber: vi.fn(), getQuotation: vi.fn() },
    historyGateway: {
      getLastNumber: vi.fn(async () => vouchers.reduce((max, voucher) => Math.max(max, voucher.number), 0)),
      getVoucher: vi.fn(async (number: number) => vouchers.find((voucher) => voucher.number === number)),
    },
    runtime: {
      config: { filasPorLista: rows },
      environment: 'testing',
      pointOfSale: 3,
    } as unknown as ResolvedArcaRuntime,
    service: {} as never,
  };
}

const FC = getVoucherKindByShortcut('fc')!;
const options = { message: '¿Cuál?', pointOfSale: 3, voucherKind: FC };

let output = '';

beforeEach(() => {
  output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk);

    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  whileLoading.answer = undefined;
  expect(script.remaining()).toBe(0);
});

describe('pickInvoice', () => {
  it('sin comprobantes avisa, y solo ofrece buscarlo a mano', async () => {
    script = createScript([[/Cuál/, BACK]]);

    expect(await pickInvoice(createSession([]), options)).toBe(BACK);
    expect(stripAnsi(output)).toContain('en el punto de venta 3');
    expect(script.chooseStep.mock.calls[0]?.[1]).toEqual([expect.objectContaining({ value: 'a-mano' })]);
  });

  it('volver desde el punto de venta o el número vuelve a la lista, con "a mano" marcado', async () => {
    script = createScript([
      [/Cuál/, 'Ingresar el número a mano'],
      [/Punto de venta/, BACK],
      [/Cuál/, 'Ingresar el número a mano'],
      [/Punto de venta/, '3'],
      [/Número/, BACK],
      [/Cuál/, '00003-00000005'],
    ]);

    expect(await pickInvoice(createSession([invoice(4), invoice(5)]), options)).toMatchObject({
      invoice: { number: 5 },
      pointOfSale: 3,
    });
    expect(script.chooseStep.mock.calls[1]?.[2]).toBe('a-mano');
  });

  it('uno que no existe avisa y vuelve a la lista', async () => {
    script = createScript([
      [/Cuál/, 'Ingresar el número a mano'],
      [/Punto de venta/, '3'],
      [/Número/, '99'],
      [/Cuál/, BACK],
    ]);

    expect(await pickInvoice(createSession([invoice(1)]), options)).toBe(BACK);
    expect(stripAnsi(output)).toContain('No existe la factura C N° 00003-00000099.');
  });

  it('elegir otra opción mientras carga descarta lo que llegue', async () => {
    const vouchers = [1, 2, 3, 4, 5].map(invoice);

    script = createScript([
      [/Cuál/, 'Cargar más'],
      [/Cuál/, '00003-00000005'],
    ]);
    whileLoading.answer = 'elegir';

    expect(await pickInvoice(createSession(vouchers), options)).toMatchObject({ invoice: { number: 5 } });
  });

  it('si la tanda que se carga viene vacía, el cursor queda en "Cargar más" o en "a mano"', async () => {
    // Del 6 al 3 no existen: la segunda tanda (4 y 3) viene vacia y todavia quedan numeros.
    const vouchers = [1, 2, 5, 6].map(invoice);

    script = createScript([
      [/Cuál/, 'Cargar más'],
      [/Cuál/, 'Cargar más'],
      [/Cuál/, BACK],
    ]);

    expect(await pickInvoice(createSession(vouchers), options)).toBe(BACK);
    expect(script.chooseStep.mock.calls.at(-1)?.[2]).toMatchObject({ number: 2 });
  });

  it('en modo explorar, elegir uno lo muestra y vuelve a la lista con ese marcado', async () => {
    const onPick = vi.fn();

    script = createScript([
      [/Cuál/, '00003-00000002'],
      [/Cuál/, BACK],
    ]);

    expect(await pickInvoice(createSession([invoice(1), invoice(2)]), { ...options, onPick })).toBe(BACK);
    expect(onPick).toHaveBeenCalledWith({ invoice: expect.objectContaining({ number: 2 }), pointOfSale: 3 });
    expect(script.chooseStep.mock.calls[1]?.[2]).toMatchObject({ number: 2 });
  });
});

describe('pickNoteInvoice', () => {
  it('una que no existe en un PV de web service vuelve a la lista', async () => {
    script = createScript([
      [/Cuál/, 'Ingresar el número a mano'],
      [/Punto de venta/, '3'],
      [/Número/, '99'],
      [/Cuál/, BACK],
    ]);

    expect(await pickNoteInvoice(createSession([invoice(1)]), options)).toBe(BACK);
  });

  it('si no se puede saber de qué sistema es el PV, la acepta igual y lo dice', async () => {
    getSalesPoints.mockRejectedValueOnce(new Error('ARCA no responde'));

    const session = createSession([]);

    vi.mocked(session.historyGateway.getLastNumber)
      .mockResolvedValueOnce(0)
      .mockRejectedValueOnce(new Error('ARCA no responde'));
    script = createScript([
      [/Cuál/, 'Ingresar el número a mano'],
      [/Punto de venta/, '50'],
      [/Número/, '15'],
    ]);

    expect(await pickNoteInvoice(session, options)).toEqual({
      number: 15,
      origin: 'unknown',
      otherSystem: true,
      pointOfSale: 50,
    });
    expect(stripAnsi(output).replace(/[│\s]+/g, ' ')).toContain(
      'no se pudo consultar si el punto de venta 50 es de web service',
    );
  });
});

it('el aviso de un PV de otro sistema lo nombra', () => {
  expect(missingNonWebServiceInvoiceNotice(FC, 50, 15, 'other')).toContain('el punto de venta 50 no es de web service');
});
