import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatConfigValue } from '../../../modules/config/config.presenter';
import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import { getConfigField, resolveActiveEnvironment } from '../../../modules/interactive/config-fields';
import { canChooseNoteCurrency, noteCurrencyChoices } from '../../../modules/interactive/note-currency';
import { BACK } from '../../../modules/interactive/wizard';
import { BUNDLED_MONOTRIBUTO_TABLE } from '../../../modules/monotributo/monotributo.bundled';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
import { loadMonotributoReport } from '../../monotributo-report';
import { runHistoryFlow } from '../history.flow';
import { runMonotributoQuery } from '../monotributo.flow';
import { confirm } from '../prompts';
import { offerSavingToConfig } from '../save-to-config';
import type { InteractiveSession } from '../session';
import { runStatusFlow } from '../status.flow';

import { createScript } from './script';

let script = createScript([]);
const changeValues = vi.fn();

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  browseBlocks: vi.fn(),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  confirm: vi.fn(),
  isPromptCancellation: (error: unknown) => error instanceof Error && error.name === 'ExitPromptError',
}));

vi.mock('../../../modules/config/config.service', () => ({
  ConfigService: class {
    public close() {}
    public changeValues = changeValues;
  },
}));

vi.mock('../../monotributo-report', () => ({ loadMonotributoReport: vi.fn() }));

const parameters = vi.hoisted(() => ({
  getQuotation: vi.fn(),
  getSalesPoints: vi.fn(async () => [{ blocked: false, emissionType: 'CAE', number: 3 }]),
  getServerStatus: vi.fn(async () => ({ appServer: 'OK', authServer: 'OK', dbServer: 'OK' })),
}));

vi.mock('../../../services/arca/arca-parameters.gateway', () => ({
  ArcaParametersGateway: class {
    public getQuotation = parameters.getQuotation;
    public getSalesPoints = parameters.getSalesPoints;
    public getServerStatus = parameters.getServerStatus;
  },
}));

vi.mock('../../../services/arca/wsfex-status', () => ({
  fetchWsfexServerStatus: async () => ({ app: 'OK', auth: 'OK', db: 'OK' }),
}));

function createSession(pointOfSale = 3): InteractiveSession {
  return {
    arca: {} as never,
    billingGateway: { createVoucher: vi.fn(), getNextVoucherNumber: vi.fn(), getQuotation: vi.fn() },
    historyGateway: { getLastNumber: vi.fn(async () => 0), getVoucher: vi.fn() },
    runtime: {
      config: { cert: {}, entornoPorDefecto: 'testing', key: {}, output: {} },
      environment: 'testing',
      pointOfSale,
    } as unknown as CliArcaRuntime,
    service: {} as never,
  };
}

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
  vi.mocked(confirm).mockReset();
  changeValues.mockClear();
  expect(script.remaining()).toBe(0);
});

describe('Estado de ARCA', () => {
  it('si la cotización falla, el estado se muestra igual, sin la cotización', async () => {
    parameters.getQuotation.mockRejectedValueOnce(new Error('ARCA no responde'));

    await runStatusFlow(createSession());

    expect(stripAnsi(output)).toMatch(/ESTADO/i);
    expect(stripAnsi(output)).not.toMatch(/COTIZACIÓN OFICIAL/);
  });

  it('con la cotización, la muestra debajo del estado', async () => {
    parameters.getQuotation.mockResolvedValueOnce({ currency: 'DOL', date: '20261118', rate: 1450.5 });

    await runStatusFlow(createSession());

    expect(stripAnsi(output)).toMatch(/COTIZACIÓN OFICIAL/);
  });

  it('si ARCA no responde, el error llega al menú', async () => {
    parameters.getServerStatus.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    parameters.getQuotation.mockResolvedValueOnce(undefined);

    await expect(runStatusFlow(createSession())).rejects.toThrow('ETIMEDOUT');
  });
});

describe('ofrecer guardar en la config', () => {
  it('"Sí" guarda cada dato; "No" y Ctrl+C no guardan nada', async () => {
    vi.mocked(confirm)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(Object.assign(new Error('Ctrl+C'), { name: 'ExitPromptError' }));

    await offerSavingToConfig('¿Guardamos?', [
      ['cbu', '0110599520000012345678'],
      ['aliasCbu', 'mi.alias'],
    ]);
    await offerSavingToConfig('¿Guardamos?', [['cbu', '1']]);
    await offerSavingToConfig('¿Guardamos?', [['cbu', '2']]);

    expect(changeValues.mock.calls).toEqual([
      [
        {
          remove: [],
          set: [
            ['cbu', '0110599520000012345678'],
            ['aliasCbu', 'mi.alias'],
          ],
        },
      ],
    ]);
  });

  it('un error que no es Ctrl+C no se tapa', async () => {
    vi.mocked(confirm).mockRejectedValueOnce(new Error('stdin cerrado'));

    await expect(offerSavingToConfig('¿Guardamos?', [['cbu', '1']])).rejects.toThrow('stdin cerrado');
  });
});

describe('Categorías del monotributo sin categoría propia', () => {
  it('no marca ninguna al elegir, y volver ahí no muestra nada', async () => {
    vi.mocked(loadMonotributoReport).mockResolvedValue({
      consultedOn: null,
      notices: ['Sin conexión: es la tabla incluida en ARCLI.'],
      ownCategory: null,
      source: 'incluida',
      table: BUNDLED_MONOTRIBUTO_TABLE,
      version: '2.6.0',
    });
    script = createScript([
      [/Y ahora/, 'Ver una categoría'],
      [/Qué categoría/, BACK],
      [/Y ahora/, BACK],
    ]);

    await runMonotributoQuery(createSession());

    expect(script.chooseStep.mock.calls[1]?.[2]).toBeUndefined();
    expect(stripAnsi(output)).toContain('Sin conexión');
  });
});

describe('Mis comprobantes sin punto de venta', () => {
  it('lo pide, y volver ahí sale sin listar nada', async () => {
    script = createScript([[/Punto de venta/, BACK]]);

    const session = createSession(0);

    await runHistoryFlow(session);

    expect(session.historyGateway.getLastNumber).not.toHaveBeenCalled();
  });
});

describe('moneda de una nota', () => {
  it('sin moneda informada, la factura cuenta como en pesos', () => {
    expect(canChooseNoteCurrency(undefined)).toBe(false);
    expect(canChooseNoteCurrency({ currency: ' pes ' })).toBe(false);
    expect(canChooseNoteCurrency({ currency: 'DOL' })).toBe(true);
    expect(noteCurrencyChoices({}).map((choice) => choice.name)).toEqual(['En ARS, como el comprobante', 'En pesos']);
  });
});

describe('datos de la config en el menú', () => {
  const config = arcliConfigSchema.parse({
    cert: { testing: '/Users/ana/arcli/certificados/20123456786/testing.crt' },
    condicionVenta: 'tarjeta-debito',
    consultarPadron: false,
    cuit: '20123456786',
    verificarFce: true,
  });
  const paths = { pdfFolder: '/Users/ana/arcli/comprobantes', ticketPath: '/Users/ana/arcli/tickets' };

  it('sin valor dice "sin configurar"; las rutas van enmascaradas y las opciones con su nombre', () => {
    expect(formatConfigValue('cuenta', config, paths)).toBe('sin configurar');
    expect(formatConfigValue('cert.testing', config, paths)).not.toContain('/Users/ana');
    expect(formatConfigValue('condicionVenta', config, paths)).toBe('Tarjeta de Débito');
    expect(formatConfigValue('consultarPadron', config, paths)).toMatch(/^no$/i);
    expect(formatConfigValue('verificarFce', config, paths)).toMatch(/^s[ií]$/i);
  });

  it('montos de la config con el formato argentino; sin valor guardado, el por defecto', () => {
    const withAmounts = arcliConfigSchema.parse({
      cotizacionPorDefecto: 1185.5,
      monedaPorDefecto: 'USD',
      monotributo: { tope: 30_000_000 },
    });

    expect(formatConfigValue('cotizacion', withAmounts, paths)).toBe('1.185,50');
    expect(formatConfigValue('monotributo.tope', withAmounts, paths)).toBe('$ 30.000.000');
    expect(formatConfigValue('consultarPadron', withAmounts, paths)).toBe('sí (por defecto)');
    expect(formatConfigValue('verificarFce', withAmounts, paths)).toBe('no (por defecto)');
    // Sin cotización, o con el 1 que la config guarda al crearse, se usa la oficial de ARCA.
    expect(formatConfigValue('cotizacion', arcliConfigSchema.parse({}), paths)).toBe(
      'la oficial de ARCA (por defecto)',
    );
    expect(formatConfigValue('cotizacion', arcliConfigSchema.parse({ cotizacionPorDefecto: 1 }), paths)).toBe(
      'la oficial de ARCA (por defecto)',
    );
  });

  it('una clave que no existe es un error de programación', () => {
    expect(() => getConfigField('no-existe' as never)).toThrow('Campo de config desconocido');
  });

  it('--produccion y --testing juntos no cuentan: queda el entorno de la config', () => {
    expect(resolveActiveEnvironment({ entornoPorDefecto: 'testing' }, { produccion: true, testing: true })).toBe(
      'testing',
    );
    expect(resolveActiveEnvironment({ entornoPorDefecto: 'produccion' }, { testing: true })).toBe('testing');
  });
});
