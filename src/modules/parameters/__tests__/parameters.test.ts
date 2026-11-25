import { describe, expect, it } from 'vitest';

import { stripAnsi } from '../../../ui/primitives';
import {
  filterCurrentEntries,
  type ParametersGateway,
  quotableCurrencies,
  resolveParameterTable,
  salesPointToEntry,
} from '../parameters';
import {
  formatParameterEntriesAsText,
  formatParameterRows,
  formatQuotationAsText,
  formatStatusAsText,
  serializeStatus,
} from '../parameters.presenter';
import { buildStatusReport, type ExportServerStatus } from '../status';

function createGateway(overrides: Partial<ParametersGateway> = {}): ParametersGateway {
  return {
    getQuotation: async () => ({ currency: 'DOL', rate: 1 }),
    getSalesPoints: async () => [],
    getServerStatus: async () => ({ app: 'OK', auth: 'OK', db: 'OK' }),
    listTable: async () => [],
    ...overrides,
  };
}

describe('parameters', () => {
  it('accepts known tables case-insensitively and rejects the rest', () => {
    expect(resolveParameterTable(' Alicuotas ')).toBe('alicuotas');
    expect(() => resolveParameterTable('foo')).toThrow(/no existe/);
  });

  it('keeps only entries still valid today', () => {
    const entries = [
      { description: 'vigente', id: '1' },
      { description: 'vence después', id: '2', validTo: '20271231' },
      { description: 'vencida', id: '3', validTo: '20200101' },
    ];

    expect(filterCurrentEntries(entries, '20261005').map((entry) => entry.id)).toEqual(['1', '2']);
  });

  it('keeps an entry that expires today and drops one that expired yesterday (TEST-19)', () => {
    const entries = [
      { description: 'vence hoy', id: '1', validTo: '20261005' },
      { description: 'venció ayer', id: '2', validTo: '20261004' },
    ];

    expect(filterCurrentEntries(entries, '20261005').map((entry) => entry.id)).toEqual(['1']);
  });

  it('describes sales points', () => {
    expect(salesPointToEntry({ blocked: true, emissionType: 'CAE', number: 3 })).toMatchObject({
      detail: 'bloqueado',
      id: '3',
    });
    expect(salesPointToEntry({ blocked: false, emissionType: 'CAE', number: 4 }).detail).toBe('habilitado');
  });

  it('lists a table with a header row and what the code is for', () => {
    const text = stripAnsi(
      formatParameterEntriesAsText(
        'iva-receptor',
        [
          { description: 'IVA Responsable Inscripto', detail: 'A/M/C', id: '1' },
          { description: 'Consumidor Final', detail: 'B/C', id: '5' },
        ],
        'testing',
      ),
    );

    expect(text).toMatch(/CÓDIGO\s+CONDICIÓN\s+COMPROBANTES/);
    expect(text).toMatch(/1\s+IVA Responsable Inscripto\s+A\/M\/C/);
    expect(text).toContain('`--ir` va con el nombre');
  });

  it('aligns the columns under the header, and skips the detail column when no entry has one', () => {
    const { header, rows } = formatParameterRows('monedas', [
      { description: 'Dólar Estadounidense', id: 'DOL' },
      { description: 'Euro', id: '060' },
    ]);

    expect(header).toBe('CÓDIGO  MONEDA');
    expect(rows).toEqual(['DOL     Dólar Estadounidense', '060     Euro']);
  });

  it('offers the dollar first and no pesos to quote', () => {
    const currencies = quotableCurrencies([
      { description: 'Pesos Argentinos', id: 'PES' },
      { description: 'Euro', id: '060' },
      { description: 'Dólar Estadounidense', id: 'DOL' },
    ]);

    expect(currencies.map((entry) => entry.id)).toEqual(['DOL', '060']);
  });

  it('explains empty sales points in testing', () => {
    expect(formatParameterEntriesAsText('puntos-venta', [], 'testing')).toContain('En testing ARCA no informa');
  });
});

describe('entorno en el texto', () => {
  it('names production with its accent', async () => {
    const report = await buildStatusReport({
      getExportServerStatus: async () => ({ app: 'OK', auth: 'OK', db: 'OK' }),
      now: Date.now,
      environment: 'produccion',
      gateway: createGateway(),
      pointOfSale: 3,
    });

    expect(stripAnsi(formatQuotationAsText({ currency: 'DOL', rate: 1 }, 'produccion'))).toContain(
      'COTIZACIÓN OFICIAL · PRODUCCIÓN',
    );
    expect(stripAnsi(formatStatusAsText(report))).toMatch(/Entorno\s+producción/);
    expect(serializeStatus(report).entorno).toBe('produccion');
  });
});

describe('formatQuotationAsText', () => {
  it('muestra el nombre de la moneda junto al código si se lo pasan', () => {
    const quotation = { currency: '060', date: '20261116', rate: 1520.75 };

    expect(stripAnsi(formatQuotationAsText(quotation, 'testing', { currencyName: 'Euro' }))).toMatch(
      /Moneda\s+Euro \(060\)/,
    );
    expect(stripAnsi(formatQuotationAsText(quotation, 'testing'))).toMatch(/Moneda\s+060\s/);
  });

  it('sin fecha de ARCA no muestra la fila, ni N/D (TUI-20)', () => {
    const text = stripAnsi(formatQuotationAsText({ currency: 'DOL', rate: 1 }, 'testing'));

    expect(text).not.toContain('Fecha');
    expect(text).not.toContain('N/D');
  });
});

describe('formatStatusAsText sin estado de un servidor (TUI-20)', () => {
  it('la fila va igual y dice que ARCA no lo informa', async () => {
    const report = await buildStatusReport({
      getExportServerStatus: async () => ({ app: 'OK', auth: 'OK', db: 'OK' }),
      now: Date.now,
      environment: 'testing',
      gateway: createGateway({ getServerStatus: async () => ({ app: 'OK', auth: 'OK', db: '' }) }),
      pointOfSale: undefined,
    });

    expect(stripAnsi(formatStatusAsText(report))).toMatch(/Base de datos\s+ARCA no lo informa/);
  });
});

describe('buildStatusReport', () => {
  it('is ready when servers are OK and the point of sale is enabled', async () => {
    const report = await buildStatusReport({
      getExportServerStatus: async () => ({ app: 'OK', auth: 'OK', db: 'OK' }),
      now: Date.now,
      environment: 'produccion',
      gateway: createGateway({ getSalesPoints: async () => [{ blocked: false, emissionType: 'CAE', number: 3 }] }),
      pointOfSale: 3,
    });

    expect(report).toMatchObject({ pointOfSale: { kind: 'habilitado' }, ready: true });
    expect(serializeStatus(report)).toMatchObject({ listo: true, puntoVenta: { estado: 'habilitado' } });
  });

  it('cannot verify the point of sale in testing but still is ready', async () => {
    const report = await buildStatusReport({
      getExportServerStatus: async () => ({ app: 'OK', auth: 'OK', db: 'OK' }),
      now: Date.now,
      environment: 'testing',
      gateway: createGateway(),
      pointOfSale: 3,
    });

    expect(report).toMatchObject({ pointOfSale: { kind: 'sin-datos' }, ready: true });
  });

  it('is not ready with a missing, blocked or unconfigured point of sale', async () => {
    const points = async () => [
      { blocked: true, emissionType: 'CAE', number: 3 },
      { blocked: false, emissionType: 'CAE', number: 4 },
    ];

    const blocked = await buildStatusReport({
      getExportServerStatus: async () => ({ app: 'OK', auth: 'OK', db: 'OK' }),
      now: Date.now,
      environment: 'produccion',
      gateway: createGateway({ getSalesPoints: points }),
      pointOfSale: 3,
    });
    const missing = await buildStatusReport({
      getExportServerStatus: async () => ({ app: 'OK', auth: 'OK', db: 'OK' }),
      now: Date.now,
      environment: 'produccion',
      gateway: createGateway({ getSalesPoints: points }),
      pointOfSale: 9,
    });
    const unset = await buildStatusReport({
      getExportServerStatus: async () => ({ app: 'OK', auth: 'OK', db: 'OK' }),
      now: Date.now,
      environment: 'produccion',
      gateway: createGateway(),
    });

    expect([blocked.pointOfSale.kind, missing.pointOfSale.kind, unset.pointOfSale.kind]).toEqual([
      'bloqueado',
      'no-encontrado',
      'sin-configurar',
    ]);
    expect([blocked.ready, missing.ready, unset.ready]).toEqual([false, false, false]);
    expect(formatStatusAsText(missing)).toContain('arcli parametros puntos-venta');
    expect(formatStatusAsText(missing)).toContain('Los de "Factura');
    expect(formatStatusAsText(missing)).toContain('#punto-de-venta-para-web-service');
    expect(formatStatusAsText(blocked)).not.toContain('Los de "Factura');
  });

  it('is not ready when a server is down and measures latency', async () => {
    let clock = 1000;
    const report = await buildStatusReport({
      getExportServerStatus: async () => ({ app: 'OK', auth: 'OK', db: 'OK' }),
      environment: 'testing',
      gateway: createGateway({
        getServerStatus: async () => {
          clock += 120;

          return { app: 'OK', auth: 'OK', db: 'ERROR' };
        },
      }),
      now: () => clock,
      pointOfSale: 3,
    });

    expect(report).toMatchObject({ latencyMs: 120, ready: false });
    expect(formatStatusAsText(report)).toContain('ARCA tiene problemas');
  });
});

describe('los servidores de exportación, WSFEX (ARQ-22)', () => {
  type Overrides = Partial<ParametersGateway> & { readonly getExportServerStatus?: ExportServerStatus };
  const build = (
    { getExportServerStatus = async () => ({ app: 'OK', auth: 'OK', db: 'OK' }), ...gateway }: Overrides = {},
    timeoutMs?: number,
  ) =>
    buildStatusReport({
      environment: 'testing',
      gateway: createGateway(gateway),
      getExportServerStatus,
      now: () => 1000,
      pointOfSale: 3,
      timeoutMs,
    });
  const text = async (overrides: Overrides = {}, timeoutMs?: number) =>
    stripAnsi(formatStatusAsText(await build(overrides, timeoutMs)));

  it('van en una línea propia y en `servidoresExportacion`', async () => {
    expect(await text()).toMatch(/Exportación \(WSFEX\)\s+OK\s/);
    expect(serializeStatus(await build())).toMatchObject({
      listo: true,
      servidoresExportacion: { aplicacion: 'OK', autenticacion: 'OK', baseDeDatos: 'OK' },
    });
  });

  it('si uno no está en OK los nombra, y lo demás no cambia', async () => {
    const getExportServerStatus = async () => ({ app: 'OK', auth: '', db: 'ERROR' });

    expect(await text({ getExportServerStatus })).toMatch(
      /Exportación \(WSFEX\)\s+base de datos: ERROR, autenticación: ARCA no lo informa/,
    );
    expect(await text({ getExportServerStatus })).toContain('ARCA responde: se puede emitir');
    expect(serializeStatus(await build({ getExportServerStatus }))).toMatchObject({ listo: true });
  });

  it.each<[string, () => Promise<never>]>([
    ['falla', () => Promise.reject(new Error('ETIMEDOUT'))],
    [
      'lanza antes de consultar',
      () => {
        throw new TypeError('sin método');
      },
    ],
    ['no contesta', () => new Promise(() => undefined)],
  ])('si %s no cambia el resto', async (_name, getExportServerStatus) => {
    const expected = { ...serializeStatus(await build()), servidoresExportacion: null };

    expect(serializeStatus(await build({ getExportServerStatus }, 10))).toEqual(expected);
    expect(await text({ getExportServerStatus }, 10)).toMatch(/Exportación \(WSFEX\)\s+sin respuesta/);
  });

  it('si falla lo de siempre, el error es el de siempre', async () => {
    await expect(build({ getServerStatus: () => Promise.reject(new Error('ETIMEDOUT')) })).rejects.toThrow('ETIMEDOUT');
  });

  it.each<[string, Partial<ParametersGateway>]>([
    ['no contesta', {}],
    ['lo de siempre falla antes', { getServerStatus: () => Promise.reject(new Error('ETIMEDOUT')) }],
    ['los puntos de venta fallan', { getSalesPoints: () => Promise.reject(new Error('ETIMEDOUT')) }],
  ])('la consulta se cancela si %s: no deja el proceso vivo', async (_name, overrides) => {
    let signal: AbortSignal | undefined;
    const getExportServerStatus: ExportServerStatus = (given) => {
      signal = given;

      return new Promise(() => undefined);
    };

    await build({ ...overrides, getExportServerStatus }, 10).catch(() => undefined);

    expect(signal?.aborted).toBe(true);
  });
});
