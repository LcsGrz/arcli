import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import type { Taxpayer } from '../../../modules/padron/padron';
import type { ParameterEntry } from '../../../modules/parameters/parameters';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import { stripAnsi } from '../../../ui';
import { runHistoryFlow } from '../history.flow';
import { runInvoiceFlow } from '../invoice.flow';
import type { FilterListRow } from '../prompts';
import { runQueriesMenu } from '../queries.flow';
import type { InteractiveSession } from '../session';

import { createScript, type ScriptedAnswer } from './script';

let script = createScript([]);

const getTaxpayer = vi.fn<(cuit: number) => Promise<null | Taxpayer>>();
const getObligation = vi.fn(async () => ({ minimumAmount: 3_958_316, obligated: true }));
const listTable = vi.fn<(table: string) => Promise<ParameterEntry[]>>();
const getQuotation = vi.fn(async (currency: string) => ({ currency, date: '20261116', rate: 1234.5 }));

vi.mock('../../../services/arca/arca-padron.gateway', () => ({
  ArcaPadronGateway: class {
    public getTaxpayer = getTaxpayer;
  },
}));
vi.mock('../../../services/arca/arca-fce-obligation.gateway', () => ({
  ArcaFceObligationGateway: class {
    public getObligation = getObligation;
  },
}));
vi.mock('../../../services/arca/arca-parameters.gateway', () => ({
  ArcaParametersGateway: class {
    public getQuotation = getQuotation;
    public getSalesPoints = async () => [];
    public listTable = listTable;
  },
}));
vi.mock('../history.flow', () => ({ runHistoryFlow: vi.fn() }));
vi.mock('../invoice.flow', () => ({ runInvoiceFlow: vi.fn() }));

/** Filas que mostro la ultima lista filtrable, para revisar el orden y el encabezado. */
const filterLists: Array<{ header?: string; message: string; rows: readonly string[] }> = [];

/** Elige de una lista filtrable la primera fila que contiene la respuesta del guion, como si se la escribiera. */
function pickFromRows<T>(answer: ScriptedAnswer, rows: ReadonlyArray<FilterListRow<T>>): T | typeof BACK {
  if (answer === BACK) {
    return BACK;
  }

  const row = rows.find((item) => item.label.includes(String(answer)));

  if (!row) {
    throw new Error(`"${String(answer)}" no esta en la lista: ${rows.map((item) => item.label).join(' | ')}`);
  }

  return row.value;
}

vi.mock('../prompts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../prompts')>();

  return {
    BACK_CHOICE: original.BACK_CHOICE,
    askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
    browseFilterList: async (message: string, rows: readonly string[], options: { header?: string }) => {
      filterLists.push({ header: options.header, message, rows });
    },
    chooseFromFilterList: async <T>(
      message: string,
      rows: ReadonlyArray<FilterListRow<T>>,
      options: { header?: string },
    ) => {
      filterLists.push({ header: options.header, message, rows: rows.map((row) => row.label) });

      // Como si se escribiera en el filtro: el guion dice que fila elegir.
      return pickFromRows(await script.askTextStep(message), rows);
    },
    chooseOne: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
    chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
    confirm: (message: string, yesLabel: string, noLabel = 'Cancelar') =>
      script.chooseStep(message, [
        { name: yesLabel, value: true },
        { name: noLabel, value: false },
      ]),
    FILTER_LIST_EXTRA_LINES: original.FILTER_LIST_EXTRA_LINES,
    fitPageSize: (count: number) => Math.max(12, count),
    isPromptCancellation: original.isPromptCancellation,
  };
});

const TAXPAYER: Taxpayer = {
  activities: [],
  address: 'Av. Siempreviva 742, CABA',
  cuit: 20201797064,
  ivaCondition: 'responsable-inscripto',
  keyStatus: 'ACTIVO',
  monotributoCategory: null,
  monotributoCategoryLetter: null,
  monotributoCategorySince: null,
  name: 'Empresa de Ejemplo SRL',
  notices: [],
  personType: 'juridica',
  taxes: [],
};

function createSession(config: Record<string, unknown> = {}): InteractiveSession {
  return {
    arca: {} as never,
    billingGateway: { createVoucher: vi.fn(), getNextVoucherNumber: vi.fn(), getQuotation: vi.fn() },
    historyGateway: { getLastNumber: vi.fn(), getVoucher: vi.fn() },
    runtime: {
      config: { cert: {}, entornoPorDefecto: 'testing', key: {}, output: {}, ...config },
      context: { cuit: 20333333334 },
      environment: 'testing',
      pointOfSale: 3,
    } as unknown as ResolvedArcaRuntime,
    service: {} as never,
  };
}

let output = '';
let errors = '';

describe('Consultas del modo interactivo', () => {
  beforeEach(() => {
    output = '';
    errors = '';
    filterLists.length = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);

      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      errors += String(chunk);

      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    getTaxpayer.mockReset();
    listTable.mockReset();
    vi.mocked(runInvoiceFlow).mockReset();
    expect(script.remaining()).toBe(0);
  });

  it('"Mis comprobantes" corre lo que antes era "Consultar comprobantes" y vuelve al submenú', async () => {
    script = createScript([
      [/consultar/, 'Mis comprobantes'],
      [/consultar/, BACK],
    ]);

    await runQueriesMenu(createSession());

    expect(runHistoryFlow).toHaveBeenCalledTimes(1);
  });

  describe('datos de un CUIT', () => {
    it('muestra el padrón y emite una factura con el CUIT y la condición IVA cargados', async () => {
      getTaxpayer.mockResolvedValueOnce(TAXPAYER);
      script = createScript([
        [/consultar/, 'Datos de un CUIT'],
        [/CUIT a consultar/, '20-20179706-4'],
        [/emitimos una factura a Empresa de Ejemplo SRL/, 'Emitir una factura a este CUIT'],
      ]);

      await runQueriesMenu(createSession());

      expect(getTaxpayer).toHaveBeenCalledWith(20201797064);
      expect(stripAnsi(output)).toContain('PADRÓN DE ARCA');
      expect(runInvoiceFlow).toHaveBeenCalledWith(expect.anything(), undefined, {
        address: 'Av. Siempreviva 742, CABA',
        cuit: 20201797064,
        ivaCondition: 'responsable-inscripto',
        name: 'Empresa de Ejemplo SRL',
      });
    });

    it('volver desde la factura vuelve a la pregunta; "No, volver", al submenú', async () => {
      getTaxpayer.mockResolvedValueOnce(TAXPAYER);
      vi.mocked(runInvoiceFlow).mockResolvedValueOnce(BACK);
      script = createScript([
        [/consultar/, 'Datos de un CUIT'],
        [/CUIT a consultar/, '20201797064'],
        [/emitimos una factura/, 'Emitir una factura a este CUIT'],
        [/emitimos una factura/, 'No, volver'],
        [/consultar/, BACK],
      ]);

      await runQueriesMenu(createSession());

      expect(runInvoiceFlow).toHaveBeenCalledTimes(1);
    });

    it('un CUIT que no está en el padrón muestra el error y vuelve al submenú', async () => {
      getTaxpayer.mockResolvedValueOnce(null);
      script = createScript([
        [/consultar/, 'Datos de un CUIT'],
        [/CUIT a consultar/, '20333333334'],
        [/consultar/, BACK],
      ]);

      await runQueriesMenu(createSession());

      expect(stripAnsi(errors)).toContain('no figura en el padrón');
      expect(stripAnsi(errors)).toContain('20201797064');
    });

    it('un error de red de ARCA se muestra y vuelve al submenú, sin salir', async () => {
      getTaxpayer.mockRejectedValueOnce(new Error('socket hang up'));
      script = createScript([
        [/consultar/, 'Datos de un CUIT'],
        [/CUIT a consultar/, '20333333334'],
        [/consultar/, BACK],
      ]);

      await runQueriesMenu(createSession());

      expect(stripAnsi(errors)).toContain('socket hang up');
    });

    it('Ctrl+C no se queda en el submenú: vuelve al menú principal', async () => {
      const cancellation = Object.assign(new Error('cancelado'), { name: 'ExitPromptError' });

      getTaxpayer.mockRejectedValueOnce(cancellation);
      script = createScript([
        [/consultar/, 'Datos de un CUIT'],
        [/CUIT a consultar/, '20333333334'],
      ]);

      await expect(runQueriesMenu(createSession())).rejects.toThrow('cancelado');
    });
  });

  it('si un cliente recibe FCE, con la fecha de hoy', async () => {
    script = createScript([
      [/consultar/, 'Si un cliente recibe FCE'],
      [/CUIT del cliente/, '20201797064'],
      [/consultar/, BACK],
    ]);

    await runQueriesMenu(createSession());

    expect(getObligation).toHaveBeenCalledWith(20201797064, expect.stringMatching(/^\d{8}$/));
    expect(stripAnsi(output)).toContain('RÉGIMEN FCE MIPYMES');
  });

  it('monedas y cotizaciones: dólar primero y sin pesos; muestra la cotización y vuelve a la lista', async () => {
    listTable.mockResolvedValueOnce([
      { description: 'Pesos Argentinos', id: 'PES' },
      { description: 'Euro', id: '060' },
      { description: 'Dólar Estadounidense', id: 'DOL' },
    ]);
    script = createScript([
      [/consultar/, 'Monedas y cotizaciones'],
      [/moneda/, 'Euro'],
      [/moneda/, 'Euro'],
      [/moneda/, BACK],
      [/consultar/, BACK],
    ]);

    await runQueriesMenu(createSession());

    expect(listTable).toHaveBeenCalledWith('monedas');
    expect(filterLists[0]?.header).toMatch(/CÓDIGO\s+MONEDA/);
    expect(filterLists[0]?.rows.map((row) => row.split(/\s+/)[0])).toEqual(['DOL', '060']);
    // ARCA da la cotización de a una moneda; la segunda vez sale de lo ya consultado.
    expect(getQuotation).toHaveBeenCalledTimes(1);
    expect(getQuotation).toHaveBeenCalledWith('060');
    expect(stripAnsi(output)).toContain('COTIZACIÓN OFICIAL');
    // El nombre sale de la tabla de monedas, sin otra consulta a ARCA.
    expect(stripAnsi(output)).toMatch(/Moneda\s+Euro \(060\)/);
  });

  describe('tablas de ARCA', () => {
    it('ofrece las tablas de `arcli parametros` menos monedas, con la ayuda abajo', async () => {
      script = createScript([
        [/consultar/, 'Tablas de ARCA'],
        [/tabla/, BACK],
        [/consultar/, BACK],
      ]);

      await runQueriesMenu(createSession());

      const [, choices] = script.chooseStep.mock.calls[1] ?? [];

      expect(choices).toHaveLength(8);
      expect(choices).not.toContainEqual(expect.objectContaining({ value: 'monedas' }));
      expect(choices?.[0]).toMatchObject({
        description: expect.stringContaining('--alicuota'),
        name: 'Alícuotas de IVA',
      });
    });

    it('una tabla corta va en su panel, con encabezado y ayuda', async () => {
      listTable.mockResolvedValueOnce([
        { description: 'Productos', id: '1' },
        { description: 'Servicios', id: '2' },
      ]);
      script = createScript([
        [/consultar/, 'Tablas de ARCA'],
        [/tabla/, 'Conceptos'],
        [/tabla/, BACK],
        [/consultar/, BACK],
      ]);

      await runQueriesMenu(createSession());

      const text = stripAnsi(output);

      expect(text).toMatch(/CÓDIGO\s+CONCEPTO/);
      expect(text).toContain('`--concepto` va con el nombre');
      expect(filterLists).toHaveLength(0);
    });

    it('una tabla que no entra en una página (`filasPorLista`) va en la lista filtrable', async () => {
      listTable.mockResolvedValueOnce(
        Array.from({ length: 6 }, (_, index) => ({ description: `Tributo ${index + 1}`, id: String(index + 1) })),
      );
      script = createScript([
        [/consultar/, 'Tablas de ARCA'],
        [/tabla/, 'Tributos'],
        [/tabla/, BACK],
        [/consultar/, BACK],
      ]);

      await runQueriesMenu(createSession({ filasPorLista: 5 }));

      expect(filterLists).toEqual([
        { header: expect.stringMatching(/CÓDIGO\s+TRIBUTO/), message: 'Tributos', rows: expect.any(Array) },
      ]);
      expect(filterLists[0]?.rows).toHaveLength(6);
    });
  });
});
