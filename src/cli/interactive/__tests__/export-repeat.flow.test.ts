import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import type { ExportGateway, ExportIssuedVoucher } from '../../../modules/export/export.types';
import { BACK, runWizard } from '../../../modules/interactive/wizard';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import type { IFEXAuthorizeOutput } from '../../../services/arca/arca-sdk.types';
import { stripAnsi } from '../../../ui';
import { attachExportPdf } from '../../commands/export.command.pdf';
import { buildExportRepeatInput, exportRepeatSteps, runExportRepeatFlow } from '../export-repeat.flow';
import type { Choice } from '../prompts';
import type { InteractiveSession } from '../session';

import { createScript, rejecting } from './script';

let script = createScript([]);

/** Una factura E de bienes en dólares, cobrada en dólares, con dos ítems y FOB. */
const INVOICE: ExportIssuedVoucher = {
  activities: [620100],
  arcaType: 19,
  cae: '76443017205075',
  clientAddress: '123 Main St, Miami, FL',
  clientCountryCuit: 55000002126,
  clientName: 'ACME LLC',
  clientTaxId: '12-3456789',
  currencyCode: 'DOL',
  date: '20261030',
  destinationCountry: 212,
  exchangeRate: 1174.605,
  exportType: 1,
  incoterm: 'FOB',
  incotermDescription: 'FOB',
  items: [
    { description: 'Bienes varios', discount: 0, quantity: 2, total: 1000, unit: 1, unitPrice: 500 },
    { description: 'Flete', discount: 0, quantity: 1, total: 500, unit: 7, unitPrice: 500 },
  ],
  number: 1,
  paymentTerms: 'Carta de crédito',
  pointOfSale: 4,
  result: 'A',
  sameCurrency: true,
  total: 1500,
};

const gateway: ExportGateway = {
  authorize: vi.fn(async (): Promise<IFEXAuthorizeOutput> => ({
    FEXAuthorizeResult: {
      FEXErr: { ErrCode: 0, ErrMsg: 'OK' },
      FEXEvents: { EventCode: 0, EventMsg: '' },
      FEXResultAuth: {
        Cae: '76123456789012',
        Cbte_nro: 2,
        Cbte_tipo: 19,
        Cuit: 20111111112,
        Fch_cbte: '20261114',
        Fch_venc_Cae: '20261124',
        Id: 1,
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
  getIncoterms: async () => [{ code: 'FOB', name: 'FOB' }],
  getLanguages: async () => [],
  getLastRequestId: async () => 0,
  getLastVoucherNumber: vi.fn(async () => 1),
  getQuotations: async () => [{ code: 'DOL', date: '20261114', rate: 1450.25 }],
  getUnits: async () => [
    { id: 1, name: 'kilogramos' },
    { id: 7, name: 'unidades' },
  ],
  getVoucher: vi.fn(async (query) => (query.number === 1 && query.pointOfSale === 4 ? INVOICE : null)),
};

const confirmFromScript = (message: string, yesLabel: string, noLabel = 'No') =>
  script.chooseStep(message, [
    { name: yesLabel, value: true },
    { name: noLabel, value: false },
  ]);

// El comando equivalente sale con las comillas de la shell del SO: POSIX fijo para que el CI en Windows espere lo mismo.
vi.mock('../../../lib/shell/shell-argument', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/shell/shell-argument')>();

  return { ...actual, formatShellCommand: (args: readonly string[]) => actual.formatShellCommand(args, 'linux') };
});

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseOne: <T>(message: string, choices: ReadonlyArray<Choice<T>>) => script.chooseStep(message, choices),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  chooseStepWhileLoading: (...args: Parameters<typeof script.chooseStepWhileLoading>) =>
    script.chooseStepWhileLoading(...args),
  confirm: (message: string, yesLabel: string, noLabel?: string) => confirmFromScript(message, yesLabel, noLabel),
  eraseLastAnswer: () => undefined,
  fitPageSize: () => 12,
}));

vi.mock('../../../services/arca/arca-client.factory', () => ({
  ArcaClientFactory: class {
    public createExportGateway() {
      return gateway;
    }
  },
}));

vi.mock('../../commands/export.command.pdf', () => ({
  attachExportPdf: vi.fn(async (result: unknown) => result),
}));

function createSession(config: Record<string, unknown> = {}): InteractiveSession {
  return {
    arca: {} as never,
    billingGateway: { createVoucher: vi.fn(), getNextVoucherNumber: vi.fn(), getQuotation: vi.fn() },
    historyGateway: { getLastNumber: vi.fn(), getVoucher: vi.fn() },
    runtime: {
      config: arcliConfigSchema.parse({ cuit: '20111111112', puntoVentaPorDefecto: 4, ...config }),
      environment: 'testing',
      pointOfSale: 4,
    } as unknown as ResolvedArcaRuntime,
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

describe('runExportRepeatFlow', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(gateway.authorize).mockClear();
    vi.mocked(attachExportPdf).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  it('copia cliente, destino, moneda, incoterm e ítems, con la cotización de hoy y los permisos nuevos', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/Permisos de embarque/, '26001EC01000123A'],
      [/Agregamos algún opcional/, []],
      [/Emitimos la factura de exportación E en testing/, 'Sí, emitir ahora'],
    ]);

    await runExportRepeatFlow(createSession(), 4);

    expect(gateway.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        Actividades: { Actividad: [{ Id: 620100 }] },
        CanMisMonExt: 'S',
        Cliente: 'ACME LLC',
        Cuit_pais_cliente: 55000002126,
        Domicilio_cliente: '123 Main St, Miami, FL',
        Dst_cmp: 212,
        Forma_pago: 'Carta de crédito',
        Id_impositivo: '12-3456789',
        Imp_total: 1500,
        Incoterms: 'FOB',
        Items: {
          Item: [
            expect.objectContaining({ Pro_ds: 'Bienes varios', Pro_qty: 2, Pro_umed: 1 }),
            expect.objectContaining({ Pro_ds: 'Flete', Pro_qty: 1, Pro_umed: 7 }),
          ],
        },
        Moneda_ctz: 1450.25,
        Moneda_Id: 'DOL',
        Permiso_existente: 'S',
        Tipo_expo: 1,
      }),
    );
    // En bienes no se pregunta ni se manda la fecha de pago: ARCA la rechaza (error 1673).
    expect(vi.mocked(gateway.authorize).mock.calls[0]?.[0]).not.toHaveProperty('Fecha_pago');
    expect(printed()).toContain('Se copian el cliente ACME LLC, ESTADOS UNIDOS, la moneda, el incoterm y los ítems.');
    // El CUIT del país es el que ARCA publica para el destino: no hace falta repetirlo.
    expect(printed()).not.toContain('--cuit-pais');
    expect(printed()).toContain("--item 'Bienes varios|2|500|1' --item 'Flete|1|500'");
    // "Sí, emitir ahora" ya decidió el PDF: después de emitir no se pregunta.
    expect(vi.mocked(attachExportPdf).mock.calls[0]?.[1].input.pdf).toBe(false);
  });

  it('en servicios pregunta la fecha de pago, que en bienes no va (ARCA la rechaza, 1673)', async () => {
    const services: ExportIssuedVoucher = { ...INVOICE, exportType: 2, incoterm: undefined };
    const original = vi.mocked(gateway.getVoucher).getMockImplementation();

    vi.mocked(gateway.getVoucher).mockImplementation(async (query) =>
      query.number === 1 && query.pointOfSale === 4 ? services : null,
    );
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'Sí, emitir ahora'],
    ]);

    try {
      await runExportRepeatFlow(createSession(), 4);
    } finally {
      vi.mocked(gateway.getVoucher).mockImplementation(original as NonNullable<typeof original>);
    }

    expect(gateway.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ Fecha_pago: expect.any(String), Tipo_expo: 2 }),
    );
  });

  it('sin actividad en la factura ni en la config la pregunta, y Enter la deja sin informar (#219)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T12:00:00-03:00'));

    const services: ExportIssuedVoucher = { ...INVOICE, activities: [], exportType: 2, incoterm: undefined };

    vi.mocked(gateway.getVoucher).mockImplementationOnce(async () => services);
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/Fecha de pago/, rejecting('20/11/2026', ['13/11/2026', /anterior a la del comprobante \(hoy\).*error 1674/])],
      [/actividad de WSFEX.*Enter para no informarla/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'Sí, emitir ahora'],
    ]);

    try {
      await runExportRepeatFlow(createSession(), 4);
    } finally {
      vi.useRealTimers();
    }

    const sent = vi.mocked(gateway.authorize).mock.calls[0]?.[0];

    expect(sent).not.toHaveProperty('Actividades');
    expect(sent).toMatchObject({ Fecha_pago: '20261120', Tipo_expo: 2 });
    expect(printed()).not.toContain('--actividad');
    expect(printed()).toContain('--fecha-pago 20/11/2026');
  });

  it('la fecha no se copia: se elige en los opcionales, con las reglas de `--fecha` y la cotización de esa fecha (EXPO-11)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T12:00:00-03:00'));
    const quotations = vi.spyOn(gateway, 'getQuotations');

    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, ['Fecha del comprobante']],
      [/Fecha del comprobante/, rejecting('10/11', ['08/11/2026', /del 09\/11\/2026 al 19\/11\/2026.*error 1500/])],
      [/Emitimos/, 'Sí, emitir ahora'],
    ]);

    try {
      await runExportRepeatFlow(createSession(), 4);
    } finally {
      vi.useRealTimers();
    }

    expect(gateway.authorize).toHaveBeenCalledWith(expect.objectContaining({ Fecha_cbte: '20261110' }));
    // Cobrada en dólares: la cotización del día hábil anterior a la fecha elegida (EXPO-7).
    expect(quotations).toHaveBeenCalledWith('20261109');
    expect(printed()).toContain('--fecha 10/11/2026');
  });

  it('no copia los ítems de seña, anticipo o bonificación (1775): sale un renglón con el total', async () => {
    const withAdvance: ExportIssuedVoucher = {
      ...INVOICE,
      items: [
        { description: 'Bienes varios', discount: 0, quantity: 2, total: 1600, unit: 1, unitPrice: 800 },
        { description: 'Anticipo', discount: 0, quantity: 0, total: -100, unit: 97, unitPrice: 0 },
      ],
    };

    vi.mocked(gateway.getVoucher).mockImplementationOnce(async () => withAdvance);
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportRepeatFlow(createSession(), 4);

    expect(printed().replace(/[│┃╏\s]+/g, ' ')).toContain(
      'La factura tiene ítems de seña, anticipo o bonificación (unidades 97 y 99), que el asistente no informa: sale un renglón con el monto total.',
    );
    expect(printed()).not.toContain('--item');
  });

  it('con otro monto avisa que los ítems no se copian y sale un renglón con el total', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'No'],
      [/Monto total en DOL/, '2.000'],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportRepeatFlow(createSession(), 4);

    expect(gateway.authorize).not.toHaveBeenCalled();
    expect(printed()).toContain('Con otro monto los ítems de la factura no suman');
    expect(printed()).not.toContain('--item');
    expect(printed()).toContain('arcli fe -m 2000');
  });

  it('con `pdf nunca` la confirmación también ofrece emitir y generar el PDF', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'Sí, emitir y generar el PDF'],
    ]);

    await runExportRepeatFlow(createSession({ pdf: 'nunca' }), 4);

    expect(gateway.authorize).toHaveBeenCalledTimes(1);
    expect(vi.mocked(attachExportPdf).mock.calls[0]?.[1].input.pdf).toBe(true);
  });

  it('el punto de venta escrito a mano llega a la emisión y al comando equivalente', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'Sí, emitir ahora'],
    ]);

    const session = createSession();

    await runExportRepeatFlow({ ...session, typedPointOfSale: 4 }, 4);

    expect(gateway.authorize).toHaveBeenCalledWith(expect.objectContaining({ Punto_vta: 4 }));
    expect(printed()).toContain('--pv 4');
  });

  it('volver desde la lista vuelve al selector de comprobantes', async () => {
    script = createScript([[/Cuál repetimos/, BACK]]);

    await expect(runExportRepeatFlow(createSession(), 4)).resolves.toBe(BACK);
  });
});

describe('exportRepeatSteps: volver, cambiar respuestas y lo que se pregunta segun la factura', () => {
  const TABLES = {
    countries: [
      { code: 212, name: 'ESTADOS UNIDOS' },
      { code: 999, name: 'ATLANTIDA' },
    ],
    countryCuits: [{ countryName: 'ESTADOS UNIDOS - Persona Jurídica', cuit: 55000002126 }],
  };

  /** Los pasos sobre una sola factura E, la 1 del punto de venta 4. */
  async function repeatOf(original: ExportIssuedVoucher, session = createSession()) {
    const stepsGateway = { ...gateway, getLastVoucherNumber: async () => 1, getVoucher: async () => original };
    const state = await runWizard(exportRepeatSteps(session, stepsGateway, TABLES, 4), {});

    return state && buildExportRepeatInput(state, session.runtime.config.exportacion?.actividad);
  }

  /** Los nombres de los opcionales que ofrece la seleccion la vez `call`. */
  function offeredOptionals(call = 0): string[] {
    return (script.chooseManyStep.mock.calls[call]?.[1] ?? []).map((choice) => choice.name);
  }

  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  it('si el destino ya no esta en la tabla de ARCA avisa y vuelve al selector de comprobantes', async () => {
    script = createScript([[/Cuál repetimos/, '00004-00000001']]);

    expect(await repeatOf({ ...INVOICE, destinationCountry: 1 })).toBeUndefined();
    expect(printed()).toContain('El destino de la factura (1) ya no está en la tabla de países de ARCA');
  });

  it('volver desde "¿Mismo monto?" vuelve a la lista', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, BACK],
      [/Cuál repetimos/, BACK],
    ]);

    expect(await repeatOf(INVOICE)).toBeUndefined();
  });

  it('volver desde el monto escrito vuelve a "¿Mismo monto?" con "No" marcado, y de ahi a la lista con la factura marcada', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'No'],
      [/Monto total en DOL/, BACK],
      [/Mismo monto/, BACK],
      [/Cuál repetimos/, BACK],
    ]);

    expect(await repeatOf(INVOICE)).toBeUndefined();

    const defaults = script.chooseStep.mock.calls.map((call) => call[2]);

    expect(defaults[2]).toBe('otro');
    expect(defaults[3]).toMatchObject({ number: 1, pointOfSale: 4 });
  });

  it('otro monto saca los ítems; volver y elegir "Sí" los trae de nuevo', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'No'],
      [/Monto total en DOL/, '2.000'],
      [/Permisos de embarque/, BACK],
      [/Monto total en DOL/, BACK],
      [/Mismo monto/, 'Sí'],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    const input = await repeatOf(INVOICE);

    expect(input?.amount).toBe(1500);
    expect(input?.items?.map((item) => item.description)).toEqual(['Bienes varios', 'Flete']);
    // Al volver, el monto arranca escrito.
    expect(script.askTextStep.mock.calls[2]?.[1]).toMatchObject({ previousAnswer: '2000' });
    // En la seleccion de opcionales se ven los ítems recuperados.
    expect(script.chooseManyStep.mock.calls[0]?.[1].find((choice) => choice.value === 'items')?.description).toBe(
      '2 ítems',
    );
  });

  it('otro monto igual al de la factura deja los ítems sin avisar', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'No'],
      [/Monto total en DOL/, '1.500'],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    expect((await repeatOf(INVOICE))?.items).toHaveLength(2);
    expect(printed()).not.toContain('Con otro monto');
  });

  it('si la factura no trae `CanMisMonExt` lo pregunta; cobrada en pesos ofrece la cotización', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/Te pagan en la moneda de la factura/, 'No, en pesos'],
      [/Permisos de embarque/, BACK],
      [/Te pagan en la moneda de la factura/, BACK],
      [/Mismo monto/, 'Sí'],
      [/Te pagan en la moneda de la factura/, 'No, en pesos'],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    expect(await repeatOf({ ...INVOICE, sameCurrency: undefined })).toMatchObject({ sameCurrency: false });
    expect(offeredOptionals()).toContain('Cotización');
  });

  it('cobrada en la misma moneda o en servicios no ofrece otra cotización', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);
    await repeatOf(INVOICE);
    expect(offeredOptionals()).not.toContain('Cotización');

    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
    ]);
    await repeatOf({ ...INVOICE, exportType: 2, incoterm: undefined, sameCurrency: false });
    expect(offeredOptionals()).not.toContain('Cotización');
    // Sin incoterm tampoco se ofrece su descripcion.
    expect(offeredOptionals()).not.toContain('Descripción del incoterm');
  });

  it('una E en pesos no pregunta la moneda de pago ni ofrece cotización', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    expect(await repeatOf({ ...INVOICE, currencyCode: 'PES', sameCurrency: undefined })).toMatchObject({
      currencyCode: 'PES',
      sameCurrency: false,
    });
    expect(offeredOptionals()).not.toContain('Cotización');
  });

  it('sin CUIT de país publicado ni ID impositivo pregunta el CUIT; volver desde ahi vuelve al monto', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/ARCA no tiene un CUIT publicado para ATLANTIDA/, BACK],
      [/Mismo monto/, 'Sí'],
      [/ARCA no tiene un CUIT publicado para ATLANTIDA/, rejecting('55000002126', ['', /Escribí el CUIT/])],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    expect(
      await repeatOf({ ...INVOICE, clientCountryCuit: undefined, clientTaxId: ' ', destinationCountry: 999 }),
    ).toMatchObject({ clientCountryCuit: 55000002126, destinationCountry: 'ATLANTIDA' });
  });

  it('con ID impositivo no pregunta el CUIT del país aunque ARCA no tenga uno para el destino', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    expect(await repeatOf({ ...INVOICE, clientCountryCuit: undefined, destinationCountry: 999 })).toMatchObject({
      clientCountryCuit: undefined,
      clientTaxId: '12-3456789',
    });
  });

  it('en servicios, volver desde la fecha de pago vuelve al monto, y la actividad escrita se valida', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/Fecha de pago/, BACK],
      [/Mismo monto/, 'Sí'],
      [/Fecha de pago/, ''],
      [/actividad de WSFEX/, rejecting('620100', ['abc', /La actividad/])],
      [/Agregamos algún opcional/, BACK],
      [/actividad de WSFEX/, BACK],
      [/Fecha de pago/, ''],
      [/actividad de WSFEX/, '620200'],
      [/Agregamos algún opcional/, []],
    ]);

    expect(await repeatOf({ ...INVOICE, activities: [], exportType: 2, incoterm: undefined })).toMatchObject({
      activity: 620200,
      paymentDate: undefined,
    });
  });

  it('con la actividad en la config no la pregunta y la usa', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    expect(
      await repeatOf(
        { ...INVOICE, activities: [], exportType: 2, incoterm: undefined },
        createSession({ exportacion: { actividad: 620100 } }),
      ),
    ).toMatchObject({ activity: 620100 });
  });

  it('los permisos escritos van como existentes', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/Mismo monto/, 'Sí'],
      [/Permisos de embarque/, '26001EC01000123A, 26001EC01000124B'],
      [/Agregamos algún opcional/, []],
    ]);

    expect(await repeatOf(INVOICE)).toMatchObject({
      permits: ['26001EC01000123A', '26001EC01000124B'],
      permitsExisting: true,
    });
  });
});
