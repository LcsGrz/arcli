import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getVoucherKindByShortcut } from '../../../modules/billing/voucher-kind-map';
import { EXPORT_VOUCHER_KIND } from '../../../modules/export/export.types';
import { BACK } from '../../../modules/interactive/wizard';
import type { IssuedVoucher } from '../../../modules/vouchers/voucher-history';
import type { ArcaClient } from '../../../services/arca/arca-client.factory';
import { ArcaExportGateway } from '../../../services/arca/arca-export.gateway';
import { ArcaVoucherHistoryGateway } from '../../../services/arca/arca-voucher-history.gateway';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
import { formatCliError, serializeCliError } from '../../error-output';
import { missingNonWebServiceInvoiceNotice, pickExportVoucher, pickInvoice, pickNoteInvoice } from '../invoice-picker';
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
  } as unknown as ArcaClient);
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

const shownErrors = () => stripAnsi(errors).replace(/[│┃\s]+/g, ' ');

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

  it('si mientras reintenta marcaste otra opción, el cursor queda ahí y no en una factura', async () => {
    const session = createSession([1, 2, 3].map(invoice));

    failQueryOf(session, 3, { once: true });
    whileLoading.typing = () => ({ term: '', value: 'a-mano' });
    script = createScript([
      [/Cuál/, 'Volver a cargar'],
      [/Cuál/, BACK],
    ]);
    await pickInvoice(session, { ...options, previous: { number: 2, pointOfSale: 3 } });

    expect(script.chooseStep.mock.calls[1]?.[2]).toBe('a-mano');
  });

  it('si mientras reintenta quedó marcado el botón de volver a cargar, no cuenta como elección', async () => {
    const session = createSession([1, 2, 3].map(invoice));

    failQueryOf(session, 3, { once: true });
    whileLoading.typing = () => ({ term: '', value: 'cargar-mas' });
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

// El selector de "Repetir", notas y "Mis comprobantes" de la E, con el gateway real (ERR-15).
describe('pickExportVoucher', () => {
  const row = (number: number, extra: Record<string, unknown> = {}) => ({
    Cae: '76443017205075',
    Cbte_nro: number,
    Cbte_tipo: 19,
    Cliente: 'ACME LLC',
    Fecha_cbte: '20261030',
    Imp_total: 1500,
    Moneda_Id: 'DOL',
    Punto_vta: 3,
    Tipo_expo: 2,
    ...extra,
  });

  /** Tres E; la `failing` viene sin datos, la primera vez o siempre. */
  function exportGateway(
    failing: number,
    { broken = {}, error, once = false }: { broken?: object; error?: object; once?: boolean } = {},
  ) {
    let failed = false;

    return new ArcaExportGateway(
      {
        wsfexService: {
          getCmp: async ({ Cmp: { Cbte_nro: number } }: { Cmp: { Cbte_nro: number } }) => {
            if (number === failing && !(once && failed)) {
              failed = true;

              return { FEXGetCMPResult: error ? { FEXErr: error } : { FEXResultGet: broken } };
            }

            return { FEXGetCMPResult: { FEXResultGet: row(number) } };
          },
          getLastCmp: async () => ({ FEXGetLast_CMPResult: { FEXResult_LastCMP: { Cbte_nro: 3 } } }),
        },
      } as unknown as ArcaClient,
      async () => ({ Cuit: 1, Sign: 'firma', Token: 'token' }),
    );
  }

  const exportOptions = { ...options, voucherKind: EXPORT_VOUCHER_KIND };

  it('si falla la primera tanda, muestra el error y deja reintentar', async () => {
    script = createScript([
      [/Cuál/, 'Volver a cargar'],
      [/Cuál/, '00003-00000002'],
    ]);

    expect(await pickExportVoucher(createSession([]), exportGateway(2, { once: true }), exportOptions)).toMatchObject({
      invoice: { number: 2 },
    });
    expect(shownErrors()).toContain('00003-00000002 y no se sabe si existe');
  });

  it('al buscar a mano, muestra el error y vuelve a la lista sin decir que no existe', async () => {
    script = createScript([
      [/Cuál/, 'Ingresar el número a mano'],
      [/Punto de venta/, '3'],
      [/Número/, '99'],
      [/Cuál/, '00003-00000003'],
    ]);

    expect(await pickExportVoucher(createSession([]), exportGateway(99), exportOptions)).toMatchObject({
      invoice: { number: 3 },
    });
    expect(shownErrors()).toContain('00003-00000099 y no se sabe si existe');
    expect(stripAnsi(output)).not.toContain('No existe');
  });

  // ARQ-22: con un error de ARCA salia al menu y se perdia lo cargado.
  const ARCA_ERROR = { ErrCode: 1510, ErrMsg: 'Punto de venta' };

  it('con un error de ARCA en la lista lo muestra y deja reintentar', async () => {
    script = createScript([
      [/Cuál/, 'Volver a cargar'],
      [/Cuál/, '00003-00000002'],
    ]);

    expect(
      await pickExportVoucher(createSession([]), exportGateway(2, { error: ARCA_ERROR, once: true }), exportOptions),
    ).toMatchObject({ invoice: { number: 2 } });
    expect(shownErrors()).toContain('00003-00000002 y no se sabe si existe');
  });

  it('con un error de ARCA al buscar a mano lo muestra y vuelve a la lista', async () => {
    script = createScript([
      [/Cuál/, 'Ingresar el número a mano'],
      [/Punto de venta/, '3'],
      [/Número/, '99'],
      [/Cuál/, '00003-00000003'],
    ]);

    expect(
      await pickExportVoucher(createSession([]), exportGateway(99, { error: ARCA_ERROR }), exportOptions),
    ).toMatchObject({ invoice: { number: 3 } });
    expect(shownErrors()).toContain('00003-00000099 y no se sabe si existe');
  });

  const shown = () => stripAnsi(output).replace(/[│┃╏║\s]+/g, ' ');
  const unreadable = (number: number) => row(number, { Tipo_expo: 3 });

  it('una con CAE y un tipo que no conocemos se saltea con un aviso; a mano, dice que existe', async () => {
    script = createScript([
      [/Cuál/, 'Ingresar el número a mano'],
      [/Punto de venta/, '3'],
      [/Número/, '2'],
      [/Cuál/, '00003-00000003'],
    ]);

    expect(
      await pickExportVoucher(createSession([]), exportGateway(2, { broken: unreadable(2) }), exportOptions),
    ).toMatchObject({ invoice: { number: 3 } });
    expect(
      onlyChoices(script.chooseStep.mock.calls[0]?.[1]).filter(({ value }) => typeof value === 'object'),
    ).toHaveLength(1);
    expect(shown()).toContain('No se muestra 1 comprobante, porque ARCLI no pudo leer sus datos: 00003-00000002.');
    expect(shownErrors()).toContain('00003-00000002 existe, con el CAE');
  });

  it('la que se saltea al "Cargar más" se avisa al llegar, una sola vez', async () => {
    script = createScript([
      [/Cuál/, 'Cargar más'],
      [/Cuál/, '00003-00000003'],
    ]);

    await pickExportVoucher(createSession([]), exportGateway(1, { broken: unreadable(1) }), exportOptions);

    expect(shown().match(/No se muestra/g)).toHaveLength(1);
    expect(shown()).toContain('00003-00000001.');
  });

  it('si no se entiende ninguna de la primera tanda, no dice que no hay y deja cargar más', async () => {
    script = createScript([
      [/Cuál/, 'Cargar más'],
      [/Cuál/, '00003-00000001'],
    ]);

    const gateway = exportGateway(0);
    const original = gateway.getVoucher.bind(gateway);

    vi.spyOn(gateway, 'getVoucher').mockImplementation(async (query) =>
      query.number > 1
        ? exportGateway(query.number, { broken: unreadable(query.number) }).getVoucher(query)
        : original(query),
    );

    expect(await pickExportVoucher(createSession([]), gateway, exportOptions)).toMatchObject({
      invoice: { number: 1 },
    });
    expect(shown()).toContain('No se muestran 2 comprobantes');
    expect(shown()).toContain('00003-00000003 y 00003-00000002.');
    expect(shown()).not.toContain('No hay');
  });

  it('un error transitorio sale al menú sin hablar de emitir', async () => {
    const gateway = exportGateway(0);

    vi.spyOn(gateway, 'getVoucher').mockRejectedValue(new Error('Transacción Activa'));

    const error: unknown = await pickExportVoucher(createSession([]), gateway, exportOptions).catch(
      (reason: unknown) => reason,
    );

    expect(stripAnsi(formatCliError(error))).toContain('repetí la consulta');

    vi.spyOn(gateway, 'getLastVoucherNumber').mockRejectedValue(new Error('Transacción Activa'));
    expect(
      JSON.stringify(
        serializeCliError(
          await pickExportVoucher(createSession([]), gateway, exportOptions).catch((reason: unknown) => reason),
        ),
      ),
    ).toContain('repetí la consulta');
  });

  it('al buscar a mano, un error transitorio tampoco', async () => {
    const gateway = exportGateway(0);
    const original = gateway.getVoucher.bind(gateway);

    vi.spyOn(gateway, 'getVoucher').mockImplementation(async (query) =>
      query.number === 99 ? Promise.reject(new Error('Transacción Activa')) : original(query),
    );
    script = createScript([
      [/Cuál/, 'Ingresar el número a mano'],
      [/Punto de venta/, '3'],
      [/Número/, '99'],
    ]);

    const error: unknown = await pickExportVoucher(createSession([]), gateway, exportOptions).catch(
      (reason: unknown) => reason,
    );

    expect(JSON.stringify(serializeCliError(error))).toContain('repetí la consulta');
  });

  it('si no se entiende ninguna y no hay más, solo ofrece buscarla a mano', async () => {
    const gateway = exportGateway(0);

    vi.spyOn(gateway, 'getVoucher').mockImplementation(async (query) =>
      exportGateway(query.number, { broken: unreadable(query.number) }).getVoucher(query),
    );
    script = createScript([[/Cuál/, BACK]]);

    expect(await pickExportVoucher(createSession([], 3), gateway, exportOptions)).toBe(BACK);
    expect(script.chooseStep.mock.calls[0]?.[1]).toHaveLength(1);
  });

  it('si falla la primera tanda y al reintentar saltea una, la avisa y no dice que no hay', async () => {
    script = createScript([
      [/Cuál/, 'Volver a cargar'],
      [/Cuál/, '00003-00000003'],
    ]);

    const gateway = exportGateway(2, { once: true });
    const original = gateway.getVoucher.bind(gateway);
    let calls = 0;

    vi.spyOn(gateway, 'getVoucher').mockImplementation(async (query) =>
      query.number === 2 && ++calls > 1
        ? exportGateway(2, { broken: unreadable(2) }).getVoucher(query)
        : original(query),
    );

    await pickExportVoucher(createSession([]), gateway, exportOptions);

    expect(shown()).toContain('No se muestra 1 comprobante');
    expect(shown()).not.toContain('No hay');
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
        queryReason: `${code} ValidacionDeToken`,
      });
      expect(shownErrors()).toBe('');

      const shown = stripAnsi(output).replace(/[│┃╏\s]+/g, ' ');

      expect(shown).toContain(
        `No se pudo consultar la factura C N° 00050-00000015 en ARCA (${code} ValidacionDeToken) y el punto de venta 50 no es de web service. Si es de Comprobantes en línea`,
      );
      expect(shown).not.toContain('ARCA no tiene');
    });

    it('en un PV propio muestra el error y vuelve a la lista', async () => {
      const session = createSession([invoice(1)]);

      failQueryOf(session, 15, { code });
      script = createScript([...searchByHand('3'), [/Cuál/, BACK]]);

      expect(await pickNoteInvoice(session, options)).toBe(BACK);
      expect(shownErrors()).toContain(`${code} ValidacionDeToken`);
      expect(stripAnsi(output)).not.toMatch(/No existe|ARCA no tiene/);
    });

    it('en un PV propio, con la lista vacía y el último número en 0, muestra el error y vuelve a la lista', async () => {
      const session = createSession([]);

      getSalesPoints.mockResolvedValueOnce([]);
      failQueryOf(session, 15, { code });
      script = createScript([...searchByHand('3'), [/Cuál/, BACK]]);

      expect(await pickNoteInvoice(session, options)).toBe(BACK);
      expect(shownErrors()).toContain(`${code} ValidacionDeToken`);
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
