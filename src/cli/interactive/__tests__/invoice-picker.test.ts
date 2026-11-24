import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getVoucherKindByShortcut } from '../../../modules/billing/voucher-kind-map';
import { BACK } from '../../../modules/interactive/wizard';
import type { IssuedVoucher } from '../../../modules/vouchers/voucher-history';
import type { Arca } from '../../../services/arca/arca-sdk.types';
import { ArcaVoucherHistoryGateway } from '../../../services/arca/arca-voucher-history.gateway';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
import { missingNonWebServiceInvoiceNotice, pickInvoice, pickNoteInvoice } from '../invoice-picker';
import type { InteractiveSession } from '../session';

import { createScript, onlyChoices } from './script';

let script = createScript([]);
/** Lo que devuelve la proxima lista que se muestra mientras carga: la carga, o una opcion elegida antes. */
const whileLoading = vi.hoisted(() => ({
  answer: undefined as string | undefined,
  /** Lo que se escribe y se marca mientras carga, antes de que termine (lo avisa `onChange`). */
  typing: undefined as
    ((choices: ReadonlyArray<{ readonly value?: unknown }>) => { term: string; value: unknown }) | undefined,
}));

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  chooseStepWhileLoading: async (
    message: string,
    choices: Parameters<typeof script.chooseStep>[1],
    defaultValue: unknown,
    pageSize: number,
    loading: Promise<unknown>,
    listOptions?: { readonly onChange?: (state: { term: string; value: unknown }) => void },
  ) => {
    if (whileLoading.typing) {
      listOptions?.onChange?.(whileLoading.typing(choices as ReadonlyArray<{ readonly value?: unknown }>));
      whileLoading.typing = undefined;
    }

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
    } as unknown as CliArcaRuntime,
    service: {} as never,
  };
}

/** El gateway real con `FECompConsultar` contestando un error que no es el 602, para un numero (ERR-1). */
function failQueryOf(session: InteractiveSession, failing: number, { code = 600, once = false } = {}): void {
  const real = new ArcaVoucherHistoryGateway({
    genericService: {
      call: async () => ({ FECompConsultarResult: { Errors: { Err: { Code: code, Msg: 'ValidacionDeToken' } } } }),
    },
  } as unknown as Arca);
  const find = vi.mocked(session.historyGateway.getVoucher).getMockImplementation()!;
  let failed = false;

  vi.mocked(session.historyGateway.getVoucher).mockImplementation(async (number, pointOfSale, voucherType) => {
    if (number === failing && !(once && failed)) {
      failed = true;

      return real.getVoucher(number, pointOfSale, voucherType);
    }

    return find(number, pointOfSale, voucherType);
  });
}

const FC = getVoucherKindByShortcut('fc')!;
const options = { message: '¿Cuál?', pointOfSale: 3, voucherKind: FC };

let output = '';
let errors = '';

const shownErrors = () => stripAnsi(errors).replace(/[│\s]+/g, ' ');

beforeEach(() => {
  output = '';
  errors = '';
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    errors += String(chunk);

    return true;
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk);

    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  whileLoading.answer = undefined;
  whileLoading.typing = undefined;
  expect(script.remaining()).toBe(0);
});

describe('pickInvoice', () => {
  it('sin comprobantes avisa, y solo ofrece buscarlo a mano', async () => {
    script = createScript([[/Cuál/, BACK]]);

    expect(await pickInvoice(createSession([]), options)).toBe(BACK);
    expect(stripAnsi(output)).toContain('en el punto de venta 3');
    expect(script.chooseStep.mock.calls[0]?.[1]).toEqual([expect.objectContaining({ value: 'a-mano' })]);
  });

  it('volver desde el punto de venta vuelve a la lista con "a mano" marcado; desde el número, al punto de venta', async () => {
    script = createScript([
      [/Cuál/, 'Ingresar el número a mano'],
      [/Punto de venta/, BACK],
      [/Cuál/, 'Ingresar el número a mano'],
      [/Punto de venta/, '3'],
      [/Número/, BACK],
      [/Punto de venta/, BACK],
      [/Cuál/, '00003-00000005'],
    ]);

    expect(await pickInvoice(createSession([invoice(4), invoice(5)]), options)).toMatchObject({
      invoice: { number: 5 },
      pointOfSale: 3,
    });
    expect(script.chooseStep.mock.calls[1]?.[2]).toBe('a-mano');
    // REV-60: el punto de venta arranca escrito con lo respondido.
    expect(script.askTextStep.mock.calls[3]?.[1]).toMatchObject({ previousAnswer: '3' });
  });

  it('con el elegido antes (al volver a la pregunta) arranca marcado; si no esta en la lista, "a mano" y escrito', async () => {
    script = createScript([[/Cuál/, '00003-00000005']]);
    await pickInvoice(createSession([invoice(4), invoice(5)]), { ...options, previous: { number: 4, pointOfSale: 3 } });
    expect(script.chooseStep.mock.calls[0]?.[2]).toMatchObject({ number: 4 });

    script = createScript([
      [/Cuál/, 'Ingresar el número a mano'],
      [/Punto de venta/, '7'],
      [/Número/, '5'],
    ]);
    await pickInvoice(createSession([invoice(4), invoice(5)]), {
      ...options,
      previous: { number: 12, pointOfSale: 7 },
    });
    expect(script.chooseStep.mock.calls[0]?.[2]).toBe('a-mano');
    expect(script.askTextStep.mock.calls.map((call) => call[1]?.previousAnswer)).toEqual(['7', '12']);
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

  it('si ARCA contesta con un error al buscar a mano, lo muestra y vuelve a la lista sin decir que no existe (ERR-1)', async () => {
    const session = createSession([invoice(1)]);

    failQueryOf(session, 99);
    script = createScript([
      [/Cuál/, 'Ingresar el número a mano'],
      [/Punto de venta/, '3'],
      [/Número/, '99'],
      [/Cuál/, '00003-00000001'],
    ]);

    expect(await pickInvoice(session, options)).toMatchObject({ invoice: { number: 1 } });
    expect(shownErrors()).toContain('600 ValidacionDeToken');
    expect(stripAnsi(output)).not.toContain('No existe');
    // Vuelve con "a mano" marcado, como al no encontrarlo.
    expect(script.chooseStep.mock.calls.at(-1)?.[2]).toBe('a-mano');
  });

  it('si falla "Cargar más", muestra el error, conserva lo cargado y deja reintentar (ERR-1)', async () => {
    const session = createSession([1, 2, 3, 4, 5].map(invoice));

    failQueryOf(session, 3, { once: true });
    script = createScript([
      [/Cuál/, 'Cargar más'],
      [/Cuál/, 'Cargar más'],
      [/Cuál/, '00003-00000003'],
    ]);

    expect(await pickInvoice(session, options)).toMatchObject({ invoice: { number: 3 } });
    expect(shownErrors()).toContain('600 ValidacionDeToken');
  });

  it('si falla la primera tanda, muestra el error y deja reintentar o buscar a mano, sin decir que no hay (ERR-1)', async () => {
    const session = createSession([1, 2, 3].map(invoice));

    failQueryOf(session, 2, { once: true });
    script = createScript([
      [/Cuál/, 'Volver a cargar'],
      [/Cuál/, '00003-00000002'],
    ]);

    expect(await pickInvoice(session, options)).toMatchObject({ invoice: { number: 2 } });
    expect(shownErrors()).toContain('600 ValidacionDeToken');
    expect(stripAnsi(output)).not.toContain('en el punto de venta 3');
    expect(onlyChoices(script.chooseStep.mock.calls[0]?.[1]).map((choice) => choice.value)).toEqual([
      'cargar-mas',
      'a-mano',
    ]);
    // Reintenta la misma tanda: quedan el 3 y el 2, y "cargar más" sigue con el 1.
    expect(script.chooseStep.mock.calls[1]?.[2]).toMatchObject({ number: 3 });
    expect(onlyChoices(script.chooseStep.mock.calls[1]?.[1]).map((choice) => choice.value)).toContain('cargar-mas');
  });

  it('si al reintentar la primera tanda vuelve a fallar, se queda; y se puede volver o buscar a mano', async () => {
    const session = createSession([1, 2, 3].map(invoice));

    failQueryOf(session, 2);
    script = createScript([
      [/Cuál/, 'Volver a cargar'],
      [/Cuál/, 'Ingresar el número a mano'],
      [/Punto de venta/, '3'],
      [/Número/, '1'],
    ]);

    expect(await pickInvoice(session, options)).toMatchObject({ invoice: { number: 1 } });

    script = createScript([[/Cuál/, BACK]]);
    expect(await pickInvoice(session, options)).toBe(BACK);
  });

  it('si el reintento de la primera tanda no trae ninguno, ahí sí lo dice', async () => {
    const session = createSession([]);

    vi.mocked(session.historyGateway.getLastNumber).mockResolvedValue(1);
    failQueryOf(session, 1, { once: true });
    script = createScript([
      [/Cuál/, 'Volver a cargar'],
      [/Cuál/, BACK],
    ]);

    expect(await pickInvoice(session, options)).toBe(BACK);
    expect(stripAnsi(output)).toContain('en el punto de venta 3');
  });

  it('al volver a la pregunta, si el reintento trae el elegido antes, queda marcado', async () => {
    const session = createSession([1, 2, 3].map(invoice));

    failQueryOf(session, 3, { once: true });
    script = createScript([
      [/Cuál/, 'Volver a cargar'],
      [/Cuál/, BACK],
    ]);
    await pickInvoice(session, { ...options, previous: { number: 2, pointOfSale: 3 } });

    expect(script.chooseStep.mock.calls[1]?.[2]).toMatchObject({ number: 2 });
  });

  it('si falla el último número, el error sale como siempre', async () => {
    const session = createSession([invoice(1)]);

    vi.mocked(session.historyGateway.getLastNumber).mockRejectedValue(new Error('11002'));
    script = createScript([]);

    await expect(pickInvoice(session, options)).rejects.toThrow('11002');
  });

  it('al fallar "Cargar más", el cursor queda donde lo dejaste', async () => {
    const session = createSession([1, 2, 3, 4, 5].map(invoice));

    failQueryOf(session, 3);
    whileLoading.typing = (choices) => ({
      term: '0004',
      value: choices.find((choice) => (choice.value as { number?: number } | undefined)?.number === 4)?.value,
    });
    script = createScript([
      [/Cuál/, 'Cargar más'],
      [/Cuál/, BACK],
    ]);

    expect(await pickInvoice(session, options)).toBe(BACK);
    expect(script.chooseStep.mock.calls.at(-1)?.[2]).toMatchObject({ number: 4 });
    expect(script.chooseStep.mock.calls.at(-1)?.[4]).toMatchObject({ initialTerm: '0004' });
  });

  it('otro error al buscar a mano sigue saliendo al menú', async () => {
    const session = createSession([invoice(1)]);

    vi.mocked(session.historyGateway.getVoucher).mockImplementation(async (number) => {
      if (number === 99) {
        throw new Error('connect ETIMEDOUT');
      }

      return invoice(number);
    });
    script = createScript([
      [/Cuál/, 'Ingresar el número a mano'],
      [/Punto de venta/, '3'],
      [/Número/, '99'],
    ]);

    await expect(pickInvoice(session, options)).rejects.toThrow('connect ETIMEDOUT');
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

  it('lo escrito y la marcada mientras carga siguen cuando la lista se redibuja con lo cargado', async () => {
    const vouchers = [1, 2, 3, 4, 5].map(invoice);

    script = createScript([
      [/Cuál/, 'Cargar más'],
      [/Cuál/, BACK],
    ]);
    // Mientras carga, se escribe "0004" y queda marcado el 4.
    whileLoading.typing = (choices) => ({
      term: '0004',
      value: choices.find((choice) => (choice.value as { number?: number } | undefined)?.number === 4)?.value,
    });

    expect(await pickInvoice(createSession(vouchers), options)).toBe(BACK);

    const redrawn = script.chooseStep.mock.calls.at(-1);

    expect(redrawn?.[2]).toMatchObject({ number: 4 });
    expect(redrawn?.[4]).toMatchObject({ initialTerm: '0004' });
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

  const searchByHand = (pointOfSale: string) =>
    [
      [/Cuál/, 'Ingresar el número a mano'],
      [/Punto de venta/, pointOfSale],
      [/Número/, '15'],
    ] as const;

  describe.each([600, 10005, 11002])('con el error %i de ARCA (ERR-1)', (code) => {
    it('en un PV de otro sistema la acepta igual que con el 602 (REGLAS-17)', async () => {
      const session = createSession([invoice(1)]);

      failQueryOf(session, 15, { code });
      script = createScript(searchByHand('50'));

      expect(await pickNoteInvoice(session, options)).toEqual({
        number: 15,
        origin: 'other',
        otherSystem: true,
        pointOfSale: 50,
      });
      expect(shownErrors()).toBe('');
    });

    it('en un PV propio muestra el error y vuelve a la lista', async () => {
      const session = createSession([invoice(1)]);

      failQueryOf(session, 15, { code });
      script = createScript([...searchByHand('3'), [/Cuál/, BACK]]);

      expect(await pickNoteInvoice(session, options)).toBe(BACK);
      expect(shownErrors()).toContain(`${code} ValidacionDeToken`);
      expect(stripAnsi(output)).not.toMatch(/No existe|ARCA no tiene/);
    });

    it('si no se puede clasificar el PV, muestra el error original y vuelve a la lista', async () => {
      const session = createSession([invoice(1)]);

      getSalesPoints.mockRejectedValueOnce(new Error('timeout'));
      vi.mocked(session.historyGateway.getLastNumber).mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('x'));
      failQueryOf(session, 15, { code });
      script = createScript([...searchByHand('50'), [/Cuál/, BACK]]);

      expect(await pickNoteInvoice(session, options)).toBe(BACK);
      expect(shownErrors()).toContain(`${code} ValidacionDeToken`);
      expect(shownErrors()).not.toContain('timeout');
    });
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
