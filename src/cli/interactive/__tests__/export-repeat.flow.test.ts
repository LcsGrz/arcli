import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import type { ExportGateway, ExportIssuedVoucher } from '../../../modules/export/export.types';
import { buildExportRepeatInput } from '../../../modules/interactive/export-repeat-input';
import { BACK, runWizard } from '../../../modules/interactive/wizard';
import { exportAnswer } from '../../../testing/arca-answers';
import { fakeBillingGateway } from '../../../testing/arca-gateways';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
import { attachExportPdf } from '../../commands/export.command.pdf';
import { exportRepeatSteps, runExportRepeatFlow } from '../export-repeat.flow';
import type { Choice } from '../prompts';
import type { InteractiveSession } from '../session';

import { createScript, editing, KEEP_EXPORT_ITEMS, rejecting } from './script';

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
  authorize: vi.fn(async () =>
    exportAnswer({
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
    }),
  ),
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
  chooseFromFilterList: (...args: Parameters<typeof script.chooseFromFilterList>) =>
    script.chooseFromFilterList(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseOrTypeStep: (...args: Parameters<typeof script.chooseOrTypeStep>) => script.chooseOrTypeStep(...args),
  chooseOne: <T>(message: string, choices: ReadonlyArray<Choice<T>>) => script.chooseStep(message, choices),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  chooseStepWhileLoading: (...args: Parameters<typeof script.chooseStepWhileLoading>) =>
    script.chooseStepWhileLoading(...args),
  confirm: (message: string, yesLabel: string, noLabel?: string) => confirmFromScript(message, yesLabel, noLabel),
  editRowsStep: (...args: Parameters<typeof script.editRowsStep>) => script.editRowsStep(...args),
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

const savedConfig = vi.fn();

vi.mock('../../../modules/config/config.service', () => ({
  ConfigService: class {
    public close() {}
    public changeValues({ set }: { set: ReadonlyArray<readonly [string, string]> }) {
      set.forEach(([key, value]) => savedConfig(key, value));
    }
  },
}));

vi.mock('../../commands/export.command.pdf', () => ({
  attachExportPdf: vi.fn(async (result: unknown) => result),
}));

function createSession(config: Record<string, unknown> = {}): InteractiveSession {
  return {
    arca: {} as never,
    billingGateway: fakeBillingGateway(),
    historyGateway: { getLastNumber: vi.fn(), getVoucher: vi.fn() },
    runtime: {
      config: arcliConfigSchema.parse({ cuit: '20111111112', puntoVentaPorDefecto: 4, ...config }),
      cuit: 20111111112,
      environment: 'testing',
      pointOfSale: 4,
    } as unknown as CliArcaRuntime,
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
      ...KEEP_EXPORT_ITEMS,
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

  // La tabla de actividades la consulta el asistente solo si pregunta la actividad. Con la de la factura, la consulta la
  // vista previa (`ExportService.resolve`, como `arcli fe --actividad`), una sola vez: si ARCA falla, falla ahi.
  it('con la actividad en la factura, el asistente no consulta la tabla de actividades', async () => {
    const activities = vi.spyOn(gateway, 'getActivities');
    let asked = 0;

    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'Sí, emitir ahora'],
    ]);
    script.askTextStep.mockImplementationOnce(async (...args) => {
      asked = activities.mock.calls.length;

      return script.askTextStep.getMockImplementation()?.(...args) as never;
    });

    await runExportRepeatFlow(createSession(), 4);

    expect(asked).toBe(0);
    expect(activities).toHaveBeenCalledOnce();
    expect(gateway.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ Actividades: { Actividad: [{ Id: 620100 }] } }),
    );
  });

  it('en servicios pregunta la fecha de pago, que en bienes no va (ARCA la rechaza, 1673)', async () => {
    const services: ExportIssuedVoucher = { ...INVOICE, exportType: 2, incoterm: undefined };
    const original = vi.mocked(gateway.getVoucher).getMockImplementation();

    vi.mocked(gateway.getVoucher).mockImplementation(async (query) =>
      query.number === 1 && query.pointOfSale === 4 ? services : null,
    );
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
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
      ...KEEP_EXPORT_ITEMS,
      [/Actividad de WSFEX/, ''],
      // Antes de los opcionales, contra la más temprana que ARCA acepta para la fecha del comprobante (TUI-22).
      [
        /Fecha de pago/,
        rejecting('20/11/2026', ['08/11/2026', /anterior al 09\/11\/2026: es la fecha más temprana.*error 1674/]),
      ],
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

  // REV-74, #11: la misma regla y la misma tabla que "Emitir factura" E, y la misma oferta de guardarla si se emite.
  it('#11: la actividad escrita se valida con la tabla de WSFEX y, emitida, se ofrece guardar', async () => {
    const services: ExportIssuedVoucher = { ...INVOICE, activities: [], exportType: 2, incoterm: undefined };

    savedConfig.mockClear();
    vi.mocked(gateway.getVoucher).mockImplementationOnce(async () => services);
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [/Actividad de WSFEX/, rejecting('620100', ['620900', /no está en la tabla de actividades de WSFEX.*2105/])],
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'Sí, emitir ahora'],
      [/Guardamos la actividad 620100 en la config/, 'Sí, guardar'],
    ]);

    await runExportRepeatFlow(createSession(), 4);

    expect(vi.mocked(gateway.authorize).mock.calls[0]?.[0]).toMatchObject({
      Actividades: { Actividad: [{ Id: 620100 }] },
    });
    expect(savedConfig).toHaveBeenCalledWith('exportacion.actividad', '620100');
  });

  it('#11: la actividad copiada de la factura no se ofrece guardar, y sin emitir tampoco la escrita', async () => {
    const services: ExportIssuedVoucher = { ...INVOICE, activities: [], exportType: 2, incoterm: undefined };

    savedConfig.mockClear();
    vi.mocked(gateway.getVoucher).mockImplementationOnce(async () => services);
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [/Actividad de WSFEX/, '620100'],
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportRepeatFlow(createSession(), 4);

    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'Sí, emitir ahora'],
    ]);

    await runExportRepeatFlow(createSession(), 4);

    expect(savedConfig).not.toHaveBeenCalled();
  });

  it('la fecha no se copia: se elige en los opcionales, con las reglas de `--fecha` y la cotización de esa fecha (EXPO-11)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T12:00:00-03:00'));
    const quotations = vi.spyOn(gateway, 'getQuotations');

    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
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

  it('la fecha de pago se compara con la fecha del comprobante elegida después, no con hoy, como `--fecha-pago` (EXPO-12, TUI-22)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T12:00:00-03:00'));
    vi.mocked(gateway.getVoucher).mockImplementationOnce(async () => ({
      ...INVOICE,
      exportType: 2,
      incoterm: undefined,
    }));
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      // Anterior a hoy, pero no a la más temprana posible: vale al preguntarla.
      [/Fecha de pago/, '12/11/2026'],
      [/Agregamos algún opcional/, ['Fecha del comprobante']],
      [
        /Fecha del comprobante/,
        rejecting('10/11/2026', ['13/11/2026', /anterior a la del comprobante \(13\/11\/2026\).*error 1674/]),
      ],
      [/Emitimos/, 'Sí, emitir ahora'],
    ]);

    try {
      await runExportRepeatFlow(createSession(), 4);
    } finally {
      vi.useRealTimers();
    }

    expect(gateway.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ Fecha_cbte: '20261110', Fecha_pago: '20261112' }),
    );
    expect(printed()).toContain('--fecha 10/11/2026');
    expect(printed()).toContain('--fecha-pago 12/11/2026');
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
      ...KEEP_EXPORT_ITEMS,
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportRepeatFlow(createSession(), 4);

    expect(printed().replace(/[│┃╏\s]+/g, ' ')).toContain(
      'El comprobante tiene ítems de seña, anticipo o bonificación (unidades 97 y 99), que el asistente no informa: sale un renglón con el monto total.',
    );
    // El editor arranca con ese renglón (NAV-10).
    expect(script.editRowsStep.mock.calls[0]?.[1].map((row) => row.title)).toEqual(['Según detalle']);
    expect(printed()).not.toContain('--item');
    expect(printed()).not.toContain('Anticipo');
  });

  it('sin "¿Mismo monto?": otro precio se cambia en el editor, y el monto es la suma de los ítems (NAV-10)', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/^Ítems de .*: modificá o eliminá ítems/, editing({ edit: ['Flete'] })],
      [/^Descripción del ítem 2:/, ''],
      [/Cantidad/, ''],
      [/Unidad/, 'unidades'],
      [/^(?:Importe|Precio unitario) en USD/, '1.000'],
      [/Importe total de la factura de exportación E: 2\.000 USD \(2 ítems\)/, 'Confirmar'],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportRepeatFlow(createSession(), 4);

    expect(gateway.authorize).not.toHaveBeenCalled();
    expect(script.asked.some((message) => /Mismo monto|Monto total/.test(message))).toBe(false);
    expect(printed()).toContain('arcli fe -m 2000');
    expect(printed()).toContain("--item 'Bienes varios|2|500|1' --item 'Flete|1|1000'");
  });

  it('con `pdf nunca` la confirmación también ofrece emitir y generar el PDF', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
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
      ...KEEP_EXPORT_ITEMS,
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
    activities: [{ id: 620100, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA' }],
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

    return (
      state && buildExportRepeatInput(state, { configuredActivity: session.runtime.config.exportacion?.actividad })
    );
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

  it('volver desde el editor vuelve a la lista', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/^Ítems de .*: modificá o eliminá ítems/, BACK],
      [/Cuál repetimos/, BACK],
    ]);

    expect(await repeatOf(INVOICE)).toBeUndefined();
  });

  it('Volver desde el total va al editor y de ahí a la lista, con la factura marcada; con la misma, el editor arranca con lo modificado', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      [/^Ítems de .*: modificá o eliminá ítems/, editing({ remove: ['Flete'] })],
      [/Importe total/, BACK],
      [/^Ítems de .*: modificá o eliminá ítems/, BACK],
      [/Cuál repetimos/, '00004-00000001'],
      [/^Ítems de .*: modificá o eliminá ítems/, editing({})],
      [/Importe total/, 'Confirmar'],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    const input = await repeatOf(INVOICE);

    expect(input?.amount).toBe(1000);
    expect(input?.items?.map((item) => item.description)).toEqual(['Bienes varios']);
    expect(script.chooseStep.mock.calls[2]?.[2]).toMatchObject({ number: 1, pointOfSale: 4 });
    expect(script.editRowsStep.mock.calls[2]?.[1].map((row) => row.title)).toEqual(['Bienes varios']);
  });

  it('si la factura no trae `CanMisMonExt` lo pregunta; cobrada en pesos pregunta la cotización con la de aduana escrita (NAV-9)', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [/Te pagan en la moneda de la factura/, 'No, en pesos'],
      [/Cotización de USD \(la oficial de ARCA es 1\.450,25\)/, '1450,25'],
      [/Permisos de embarque/, BACK],
      // Sin tocarla, al volver arranca de nuevo con la de ARCA.
      [/Cotización de USD/, BACK],
      [/Te pagan en la moneda de la factura/, BACK],
      ...KEEP_EXPORT_ITEMS,
      [/Te pagan en la moneda de la factura/, 'No, en pesos'],
      [/Cotización de USD/, '1.500'],
      [/Permisos de embarque/, BACK],
      // Escrita a mano, al volver arranca con la escrita.
      [/Cotización de USD/, '1.500'],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    expect(await repeatOf({ ...INVOICE, sameCurrency: undefined })).toMatchObject({
      exchangeRate: 1500,
      sameCurrency: false,
    });
    expect(
      script.askTextStep.mock.calls
        .filter(([message]) => message.startsWith('Cotización'))
        .map(([, options]) => options?.previousAnswer),
    ).toEqual(['1450,25', '1450,25', '1450,25', '1500']);
    expect(offeredOptionals()).not.toContain('Cotización');
  });

  it('sin tocar la de aduana, la entrada no lleva cotización, como el CLI sin `--cm`', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [/Te pagan en la moneda de la factura/, 'No, en pesos'],
      [/Cotización de USD/, '1450,25'],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    expect((await repeatOf({ ...INVOICE, sameCurrency: undefined }))?.exchangeRate).toBeUndefined();
  });

  it('cobrada en la misma moneda o en servicios no pregunta la cotización: ARCA exige la suya (1604, 2053)', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);
    await repeatOf(INVOICE);
    expect(offeredOptionals()).not.toContain('Cotización');
    // Se muestra, con el motivo, en el lugar de la pregunta (NAV-9).
    expect(printed().replace(/\s+/g, ' ')).toContain(
      'Cotización: 1.450,25 por USD, la oficial del día hábil anterior. ARCA no acepta otra si te pagan en USD.',
    );

    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
    ]);
    await repeatOf({ ...INVOICE, exportType: 2, incoterm: undefined, sameCurrency: false });
    expect(printed().replace(/\s+/g, ' ')).toContain(
      'Cotización: 1.450,25 por USD, la de aduana del día hábil anterior. ARCA no acepta otra en servicios.',
    );
    // Sin incoterm tampoco se ofrece su descripcion.
    expect(offeredOptionals()).not.toContain('Descripción del incoterm');
  });

  it('una E en pesos no pregunta la moneda de pago ni la cotización', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    expect(await repeatOf({ ...INVOICE, currencyCode: 'PES', sameCurrency: undefined })).toMatchObject({
      currencyCode: 'PES',
      sameCurrency: false,
    });
  });

  // Un dato fiscal sin default razonable: sin la fila de "sin CUIT", Enter vacío no elige el primero de la tabla.
  it('sin CUIT de país publicado ni ID impositivo pregunta el CUIT; volver desde ahí vuelve a los ítems', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [/ARCA no tiene un CUIT publicado para ATLANTIDA/, BACK],
      ...KEEP_EXPORT_ITEMS,
      [
        /ARCA no tiene un CUIT publicado para ATLANTIDA/,
        rejecting('55000002126', ['', /^Elegí un CUIT de la lista o escribí el número\.$/]),
      ],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    expect(
      await repeatOf({ ...INVOICE, clientCountryCuit: undefined, clientTaxId: ' ', destinationCountry: 999 }),
    ).toMatchObject({ clientCountryCuit: 55000002126, destinationCountry: 'ATLANTIDA' });
  });

  // REV-74, #10: volver al CUIT del país desde el paso siguiente lo muestra marcado.
  it('volver al CUIT del país desde los permisos lo muestra marcado', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [/ARCA no tiene un CUIT publicado para ATLANTIDA/, '55000002126'],
      [/Permisos de embarque/, BACK],
      [/ARCA no tiene un CUIT publicado para ATLANTIDA/, '55000002126'],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    await repeatOf({ ...INVOICE, clientCountryCuit: undefined, clientTaxId: ' ', destinationCountry: 999 });

    const prefills = script.chooseOrTypeStep.mock.calls
      .filter(([message]) => /ARCA no tiene un CUIT publicado/.test(message))
      .map((call) => call[2].previous);

    expect(prefills).toEqual([undefined, 55000002126]);
  });

  it('con ID impositivo no pregunta el CUIT del país aunque ARCA no tenga uno para el destino', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    expect(await repeatOf({ ...INVOICE, clientCountryCuit: undefined, destinationCountry: 999 })).toMatchObject({
      clientCountryCuit: undefined,
      clientTaxId: '12-3456789',
    });
  });

  // Criterio 8: sin CUIT publicado para el destino, cualquiera de la tabla vale (`resolveExportClientCountryCuit`).
  it('sin CUIT para el destino, la lista trae los CUIT de la tabla y escribir parte del país lo elige, sin otra lista', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [/ARCA no tiene un CUIT publicado para ATLANTIDA/, 'unidos'],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    expect(
      await repeatOf({ ...INVOICE, clientCountryCuit: undefined, clientTaxId: ' ', destinationCountry: 999 }),
    ).toMatchObject({ clientCountryCuit: 55000002126, destinationCountry: 'ATLANTIDA' });

    const [, rows, options] =
      script.chooseOrTypeStep.mock.calls.find(([message]) => /ARCA no tiene un CUIT publicado/.test(message)) ?? [];

    expect(rows?.map((row) => row.value)).toEqual([55000002126]);
    // Sin ID impositivo, ARCA pide el CUIT: no se puede dejar vacío.
    expect(options?.optional).toBeFalsy();
  });

  // Criterio 8: lo de hoy, el mismo error que `--cuit-pais` para un número que no está en la tabla.
  it('sin CUIT para el destino, un número que no está en la tabla da el error de `--cuit-pais`', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [
        /ARCA no tiene un CUIT publicado para ATLANTIDA/,
        rejecting('55000002126', ['55000000000', /^El CUIT de país 55000000000 no existe en la tabla de ARCA\.$/]),
      ],
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    expect(
      await repeatOf({ ...INVOICE, clientCountryCuit: undefined, clientTaxId: ' ', destinationCountry: 999 }),
    ).toMatchObject({ clientCountryCuit: 55000002126 });
  });

  it('en servicios, volver desde la fecha de pago vuelve a la actividad (TUI-22), y la actividad escrita se valida', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [/Actividad de WSFEX/, rejecting('620100', ['abc', /La actividad/])],
      [/Fecha de pago/, BACK],
      [/Actividad de WSFEX/, BACK],
      ...KEEP_EXPORT_ITEMS,
      [/Actividad de WSFEX/, rejecting('620100', ['620200', /no está en la tabla de actividades de WSFEX.*2105/])],
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    // Con la tabla de WSFEX, como "Emitir factura" (REV-74, #11).
    expect(await repeatOf({ ...INVOICE, activities: [], exportType: 2, incoterm: undefined })).toMatchObject({
      activity: 620100,
      paymentDate: undefined,
    });
  });

  // Como en A, B y C ("lo respondido con otra factura no pisa lo copiado de la elegida"): lo copiado sigue a la factura.
  it('al volver y elegir otra factura, lo respondido con la anterior no pisa lo copiado de la nueva', async () => {
    const first: ExportIssuedVoucher = { ...INVOICE, incotermDescription: 'Free on board', language: 2 };
    const second: ExportIssuedVoucher = {
      ...INVOICE,
      clientCountryCuit: 55000002118,
      incoterm: 'CIF',
      incotermDescription: 'Cost insurance freight',
      language: 3,
      number: 2,
    };
    const stepsGateway = {
      ...gateway,
      getLanguages: async () => [
        { id: 1, name: 'Español' },
        { id: 2, name: 'Inglés' },
        { id: 3, name: 'Portugués' },
      ],
      getLastVoucherNumber: async () => 2,
      getVoucher: async (query: { readonly number: number }) => [first, second][query.number - 1] ?? null,
    };
    let returned = false;
    const after = {
      name: 'despues',
      run: async () => {
        if (returned) {
          return {};
        }

        returned = true;

        return BACK;
      },
    };

    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, ['Idioma', 'CUIT del país', 'Descripción del incoterm']],
      [/Idioma del comprobante/, 'Español'],
      [/CUIT del país del cliente/, '55000002126'],
      [/Descripción del incoterm FOB/, 'Mi descripción'],
      // "despues" vuelve: se retrocede hasta la factura y se elige otra.
      [/Agregamos algún opcional/, BACK],
      [/Permisos de embarque/, BACK],
      [/^Ítems de .*: modificá o eliminá ítems/, BACK],
      [/Cuál repetimos/, '00004-00000002'],
      ...KEEP_EXPORT_ITEMS,
      [/Permisos de embarque/, ''],
      [/Agregamos algún opcional/, []],
    ]);

    const state = await runWizard([...exportRepeatSteps(createSession(), stepsGateway, TABLES, 4), after], {});

    expect(state?.options).toEqual({
      clientCountryCuit: 55000002118,
      incotermDescription: 'Cost insurance freight',
      language: 3,
    });
    // Los ítems siguen a la factura: con otra, el editor arranca con los de esa (NAV-10).
    expect(state?.items).toEqual(
      second.items?.map(({ description, quantity, unit, unitPrice }) => ({
        code: undefined,
        description,
        quantity,
        unit,
        unitPrice,
      })),
    );
    // Lo que se había marcado sigue a la factura anterior: con la nueva arranca sin marcar.
    expect(script.chooseManyStep.mock.calls.at(-1)?.[2]).toEqual([]);
  });

  // REV-65 y TUI-22: la fecha de pago va antes de los opcionales y no depende de ellos.
  describe('la fecha de pago recordada', () => {
    /** Los pasos con uno mas al final, que vuelve una vez: asi se llega de nuevo a la fecha de pago ya respondida. */
    async function repeatWithStepAfter() {
      const original = { ...INVOICE, exportType: 2 as const, incoterm: undefined };
      const stepsGateway = { ...gateway, getLastVoucherNumber: async () => 1, getVoucher: async () => original };
      let returned = false;
      const after = {
        name: 'despues',
        run: async () => {
          if (returned) {
            return {};
          }

          returned = true;

          return BACK;
        },
      };

      return runWizard([...exportRepeatSteps(createSession(), stepsGateway, TABLES, 4), after], {});
    }

    function paymentDatePrefills(): Array<string | undefined> {
      return script.askTextStep.mock.calls
        .filter(([message]) => /Fecha de pago/.test(message))
        .map((call) => call[1]?.previousAnswer);
    }

    it('cambiar un opcional la conserva', async () => {
      script = createScript([
        [/Cuál repetimos/, '00004-00000001'],
        ...KEEP_EXPORT_ITEMS,
        [/Fecha de pago/, '20/11/2026'],
        [/Agregamos algún opcional/, ['Observaciones']],
        [/^Observaciones \(/, 'Pedido 42'],
        [/Observaciones comerciales/, ''],
        [/Agregamos algún opcional/, BACK],
        [/Fecha de pago/, '20/11/2026'],
        [/Agregamos algún opcional/, ['Observaciones']],
        [/^Observaciones \(/, 'Pedido 43'],
        [/Observaciones comerciales/, ''],
      ]);

      expect(await repeatWithStepAfter()).toMatchObject({ paymentDate: '20/11/2026' });
      expect(paymentDatePrefills()).toEqual([undefined, '20/11/2026']);
    });

    it('cambiar una respuesta anterior (los ítems) la conserva', async () => {
      script = createScript([
        [/Cuál repetimos/, '00004-00000001'],
        ...KEEP_EXPORT_ITEMS,
        [/Fecha de pago/, '20/11/2026'],
        [/Agregamos algún opcional/, []],
        [/Agregamos algún opcional/, BACK],
        [/Fecha de pago/, BACK],
        [/^Ítems de .*: modificá o eliminá ítems/, editing({ remove: ['Flete'] })],
        [/Importe total/, 'Confirmar'],
        [/Fecha de pago/, '20/11/2026'],
        [/Agregamos algún opcional/, []],
      ]);

      expect(await repeatWithStepAfter()).toMatchObject({
        items: [expect.objectContaining({ description: 'Bienes varios' })],
        paymentDate: '20/11/2026',
      });
      expect(paymentDatePrefills()).toEqual([undefined, '20/11/2026', '20/11/2026']);
    });

    // TUI-22: la fecha de pago va antes; la del comprobante, elegida despues, se controla contra ella.
    it('cambiar la fecha del comprobante la conserva, y "Fecha del comprobante" no deja una posterior a ella', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-14T12:00:00-03:00'));
      script = createScript([
        [/Cuál repetimos/, '00004-00000001'],
        ...KEEP_EXPORT_ITEMS,
        [/Fecha de pago/, '16/11/2026'],
        [/Agregamos algún opcional/, ['Fecha del comprobante']],
        [/Fecha del comprobante/, '14/11/2026'],
        [/Agregamos algún opcional/, ['Fecha del comprobante']],
        [
          /Fecha del comprobante/,
          rejecting('15/11/2026', ['18/11/2026', /anterior a la del comprobante \(18\/11\/2026\).*error 1674/]),
        ],
      ]);

      try {
        expect(await repeatWithStepAfter()).toMatchObject({
          options: expect.objectContaining({ voucherDate: '15/11/2026' }),
          paymentDate: '16/11/2026',
        });
      } finally {
        vi.useRealTimers();
      }

      expect(paymentDatePrefills()).toEqual([undefined]);
    });
  });

  it('con la actividad en la config no la pregunta y la usa', async () => {
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
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
      ...KEEP_EXPORT_ITEMS,
      [/Permisos de embarque/, '26001EC01000123A, 26001EC01000124B'],
      [/Agregamos algún opcional/, []],
    ]);

    expect(await repeatOf(INVOICE)).toMatchObject({
      permits: ['26001EC01000123A', '26001EC01000124B'],
      permitsExisting: true,
    });
  });
});
