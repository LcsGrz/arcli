import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import type { ExportGateway } from '../../../modules/export/export.types';
import { BACK } from '../../../modules/interactive/wizard';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import type { IFEXAuthorizeOutput } from '../../../services/arca/arca-sdk.types';
import { stripAnsi } from '../../../ui';
import { attachExportPdf } from '../../commands/export.command.pdf';
import { runExportFlow } from '../export.flow';
import type { InteractiveSession } from '../session';

import { createScript, onlyChoices, rejecting } from './script';

let script = createScript([]);
const savedConfig = vi.fn();

const gateway: ExportGateway = {
  authorize: vi.fn(async (): Promise<IFEXAuthorizeOutput> => ({
    FEXAuthorizeResult: {
      FEXErr: { ErrCode: 0, ErrMsg: 'OK' },
      FEXEvents: { EventCode: 0, EventMsg: '' },
      FEXResultAuth: {
        Cae: '76123456789012',
        Cbte_nro: 7,
        Cbte_tipo: 19,
        Fch_cbte: '20261030',
        Fch_venc_Cae: '20261109',
        Id: 1,
        Motivos_Obs: '',
        Punto_vta: 4,
        Reproceso: 'N',
        Resultado: 'A',
        Cuit: 20111111112,
      },
    },
  })),
  checkPermit: async () => 'OK',
  getActivities: async () => [{ id: 620100, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA' }],
  getCurrencies: async () => [{ code: 'DOL', name: 'Dólar Estadounidense' }],
  getDestinationCountries: async () => [
    { code: 200, name: 'ARGENTINA' },
    { code: 212, name: 'ESTADOS UNIDOS' },
  ],
  getDestinationCountryCuits: async () => [{ countryName: 'ESTADOS UNIDOS - Persona Jurídica', cuit: 55000002126 }],
  getIncoterms: async () => [
    { code: 'EXW', name: 'EXW' },
    { code: 'FOB', name: 'FOB' },
  ],
  getLanguages: async () => [],
  getLastRequestId: async () => 0,
  getLastVoucherNumber: vi.fn(async () => 6),
  getQuotations: async () => [{ code: 'DOL', date: '20261030', rate: 1174.6 }],
  getUnits: async () => [{ id: 7, name: 'unidades' }],
  getVoucher: async () => null,
};

// El comando equivalente sale con las comillas de la shell del SO: POSIX fijo para que el CI en Windows espere lo mismo.
vi.mock('../../../lib/shell/shell-argument', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/shell/shell-argument')>();

  return { ...actual, formatShellCommand: (args: readonly string[]) => actual.formatShellCommand(args, 'linux') };
});

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseOne: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(args[0], args[1]),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  confirm: (message: string, yesLabel: string, noLabel = 'Cancelar') =>
    script.chooseStep(message, [
      { name: yesLabel, value: true },
      { name: noLabel, value: false },
    ]),
  isPromptCancellation: (error: unknown) => error instanceof Error && error.name === 'ExitPromptError',
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

vi.mock('../../../modules/config/config.service', () => ({
  ConfigService: class {
    public close() {}
    public setValue(key: string, value: string) {
      savedConfig(key, value);
    }
  },
}));

function createSession(config: Record<string, unknown> = {}): InteractiveSession {
  return {
    arca: {} as never,
    billingGateway: { createVoucher: vi.fn(), getNextVoucherNumber: vi.fn(), getQuotation: vi.fn() },
    historyGateway: { getLastNumber: vi.fn(), getVoucher: vi.fn() },
    runtime: {
      config: arcliConfigSchema.parse({ cuit: '20111111112', puntoVentaPorDefecto: 4, ...config }),
      environment: 'testing',
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

describe('runExportFlow', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(gateway.authorize).mockClear();
    savedConfig.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  it('emite una E de servicios en dólares y ofrece guardar la actividad escrita a mano', async () => {
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, 'estados unidos'],
      [/ID impositivo/, '12-3456789'],
      [/Qué exportás/, 'Servicios'],
      [/Monto total/, '1.500'],
      [/Descripción/, 'Consultoría de software'],
      [/moneda/, 'Dólares'],
      [/Te pagan en dólares/, 'Sí'],
      [/Forma de pago/, 'Transferencia Internacional'],
      [/Fecha de pago/, ''],
      [/actividad/, '620100'],
      [/Agregamos algún opcional/, []],
      [/Emitimos la factura de exportación E en testing/, 'Sí, emitir ahora'],
      [/Guardamos la actividad 620100/, 'Sí, guardar'],
    ]);

    await runExportFlow(createSession());

    expect(gateway.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        Actividades: { Actividad: [{ Id: 620100 }] },
        CanMisMonExt: 'S',
        Cbte_nro: 7,
        Cliente: 'ACME LLC',
        Dst_cmp: 212,
        Id_impositivo: '12-3456789',
        Imp_total: 1500,
        Moneda_ctz: 1174.6,
        Moneda_Id: 'DOL',
        Punto_vta: 4,
        Tipo_expo: 2,
      }),
    );
    expect(printed()).toContain(
      "arcli fe -m 1500 --cliente 'ACME LLC' --domicilio-cliente '123 Main St' --pais-destino 'ESTADOS UNIDOS' --id-impositivo 12-3456789 --actividad 620100 --descripcion 'Consultoría de software' --moneda DOL --misma-moneda --testing --emitir",
    );
    expect(savedConfig).toHaveBeenCalledWith('exportacion.actividad', '620100');
  });

  it('la actividad es opcional: con Enter la E va sin el bloque Actividades y no ofrece guardarla', async () => {
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, '212'],
      [/ID impositivo/, ''],
      [/Qué exportás/, 'Servicios'],
      [/Monto total/, '100'],
      [/Descripción/, ''],
      [/moneda/, 'Pesos'],
      [/Forma de pago/, 'Transferencia Internacional'],
      [/Fecha de pago/, ''],
      [/actividad.*Enter para no informarla/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'Sí, emitir ahora'],
    ]);

    await runExportFlow(createSession());

    expect(vi.mocked(gateway.authorize).mock.calls[0]?.[0]).not.toHaveProperty('Actividades');
    expect(printed()).not.toContain('--actividad');
    expect(savedConfig).not.toHaveBeenCalled();
  });

  it('en bienes pregunta el incoterm y los permisos y no la fecha de pago, toma la actividad de la config y no emite si se cancela', async () => {
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, '212'],
      [/ID impositivo/, ''],
      [/Qué exportás/, 'Bienes'],
      [/Monto total/, '800'],
      [/Descripción/, ''],
      [/moneda/, 'Pesos'],
      [/Incoterm/, 'FOB'],
      [/Permisos de embarque/, '26001EC01000123A, 26001EC01000124B'],
      [/Forma de pago/, 'Carta de crédito'],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

    expect(gateway.authorize).not.toHaveBeenCalled();
    expect(savedConfig).not.toHaveBeenCalled();
    expect(printed()).toContain('No se emitió nada.');
    expect(printed()).toContain(
      "--tipo-expo 1 --actividad 620100 --moneda PES --incoterm FOB --permiso 26001EC01000123A --permiso 26001EC01000124B --permiso-existente --forma-pago 'Carta de crédito'",
    );
  });

  it('con los opcionales informa ítems, idioma, observaciones, descripción del incoterm y cotización', async () => {
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, '212'],
      [/ID impositivo/, ''],
      [/Qué exportás/, 'Bienes'],
      [/Monto total/, '1.500'],
      [/Descripción/, ''],
      [/moneda/, 'Dólares'],
      [/Te pagan en dólares/, 'No'],
      [/Incoterm/, 'FOB'],
      [/Permisos de embarque/, ''],
      [/Forma de pago/, 'Transferencia Internacional'],
      [/Agregamos algún opcional/, ['Ítems', 'Idioma', 'Observaciones', 'Descripción del incoterm', 'Cotización']],
      [/Descripción del ítem 1/, 'Bienes varios'],
      [/Cantidad/, '2'],
      [/Precio unitario/, '500'],
      [/Unidad/, 'kilogramos'],
      // La suma (1.000) no da el monto: avisa y sigue pidiendo ítems.
      [/Descripción del ítem 2 \(Enter para terminar\)/, ''],
      [/Descripción del ítem 2/, 'Flete'],
      [/Cantidad/, '1'],
      [/Precio unitario/, '500'],
      [/Unidad/, 'unidades'],
      [/Descripción del ítem 3/, ''],
      [/Idioma del comprobante/, 'Inglés'],
      [/^Observaciones \(/, 'Pedido 42'],
      [/Observaciones comerciales/, ''],
      [/Descripción del incoterm FOB/, 'Free on board, BA'],
      [/Cotización de USD/, '1.200,5'],
      [/Emitimos/, 'Sí, emitir ahora'],
    ]);
    vi.spyOn(gateway, 'getLanguages').mockResolvedValue([
      { id: 1, name: 'Español' },
      { id: 2, name: 'Inglés' },
    ]);
    vi.spyOn(gateway, 'getUnits').mockResolvedValue([
      { id: 1, name: 'kilogramos' },
      { id: 7, name: 'unidades' },
    ]);

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

    expect(printed()).toContain('La suma de los ítems (1.000) no coincide con el monto total (1.500)');
    expect(gateway.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        Idioma_cbte: 2,
        Incoterms: 'FOB',
        Incoterms_Ds: 'Free on board, BA',
        Items: {
          Item: [
            expect.objectContaining({ Pro_ds: 'Bienes varios', Pro_qty: 2, Pro_total_item: 1000, Pro_umed: 1 }),
            expect.objectContaining({ Pro_ds: 'Flete', Pro_qty: 1, Pro_total_item: 500, Pro_umed: 7 }),
          ],
        },
        Moneda_ctz: 1200.5,
        Obs: 'Pedido 42',
      }),
    );
    expect(printed()).toContain(
      "--item 'Bienes varios|2|500|1' --item 'Flete|1|500' --moneda DOL --cm 1200,50 --incoterm FOB --incoterms-desc 'Free on board, BA' --idioma 2 --observaciones 'Pedido 42' --testing --emitir",
    );
  });

  it('si ARCA no tiene CUIT para el destino, lo pide y se puede buscar por nombre', async () => {
    vi.spyOn(gateway, 'getDestinationCountries').mockResolvedValue([{ code: 999, name: 'ATLANTIDA' }]);
    vi.spyOn(gateway, 'getDestinationCountryCuits').mockResolvedValue([
      { countryName: 'ESTADOS UNIDOS - Persona Jurídica', cuit: 55000002126 },
      { countryName: 'OTROS PAISES - Persona Jurídica', cuit: 55000009999 },
    ]);
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, 'atlantida'],
      [/ARCA no tiene un CUIT publicado para ATLANTIDA/, 'otros'],
      [/CUIT del país/, 'OTROS PAISES'],
      [/ID impositivo/, ''],
      [/Qué exportás/, 'Servicios'],
      [/Monto total/, '100'],
      [/Descripción/, ''],
      [/moneda/, 'Pesos'],
      [/Forma de pago/, 'Transferencia Internacional'],
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

    expect(printed()).toContain('--pais-destino ATLANTIDA --cuit-pais 55000009999');
  });

  it('sin CUIT para el destino se puede dejar vacio: entonces pide el ID impositivo (error 1580)', async () => {
    vi.spyOn(gateway, 'getDestinationCountries').mockResolvedValue([{ code: 999, name: 'ATLANTIDA' }]);
    vi.spyOn(gateway, 'getDestinationCountryCuits').mockResolvedValue([
      { countryName: 'ESTADOS UNIDOS - Persona Jurídica', cuit: 55000002126 },
    ]);
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, 'atlantida'],
      [/dejalo vacío para informar solo el ID impositivo/, ''],
      [/ID impositivo del cliente en su país \(sin CUIT del país, ARCA lo pide\)/, 'IE1234567T'],
      [/Qué exportás/, 'Servicios'],
      [/Monto total/, '100'],
      [/Descripción/, ''],
      [/moneda/, 'Pesos'],
      [/Forma de pago/, 'Transferencia Internacional'],
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

    expect(printed()).toContain('--pais-destino ATLANTIDA --id-impositivo IE1234567T');
    expect(printed()).not.toContain('--cuit-pais');
  });

  it('valida el país contra la tabla de ARCA: Argentina no es destino de exportación', async () => {
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, 'argentina'],
    ]);

    await expect(runExportFlow(createSession())).rejects.toThrow(/Argentina no es un destino de exportación/);
  });

  describe('reglas de WSFEX en el asistente (#219)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('los textos más largos que los de ARCA dan el error y vuelven a preguntar', async () => {
      script = createScript([
        [
          /cliente del exterior/,
          rejecting('ACME LLC', ['', /El cliente es obligatorio/], ['a'.repeat(201), /200 caracteres.*error 1651/]),
        ],
        [/Domicilio/, rejecting('123 Main St', ['a'.repeat(301), /300 caracteres.*error 1661/])],
        [/País de destino/, '212'],
        [/ID impositivo/, rejecting('', ['a'.repeat(51), /50 caracteres/])],
        [/Qué exportás/, 'Servicios'],
        [/Monto total/, '100'],
        [/Descripción/, rejecting('Consultoría', ['a'.repeat(4001), /más de 4\.000 caracteres.*error 1770/])],
        [/moneda/, 'Pesos'],
        [/Forma de pago/, rejecting('Transferencia', ['a'.repeat(51), /50 caracteres/])],
        [/Fecha de pago/, ''],
        [/Agregamos algún opcional/, ['Observaciones']],
        [/^Observaciones \(/, rejecting('Pedido 42', ['a'.repeat(1001), /más de 1\.000 caracteres.*error 1665/])],
        [/Observaciones comerciales/, rejecting('', ['a'.repeat(4001), /más de 4\.000 caracteres.*error 1665/])],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

      expect(gateway.authorize).not.toHaveBeenCalled();
      expect(printed()).toContain(
        "--descripcion 'Consultoría' --moneda PES --forma-pago Transferencia --observaciones 'Pedido 42'",
      );
    });

    it('la fecha de pago anterior a hoy da el error 1674 y vuelve a preguntar; hoy o después pasa', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-30T12:00:00-03:00'));
      script = createScript([
        [/cliente del exterior/, 'ACME LLC'],
        [/Domicilio/, '123 Main St'],
        [/País de destino/, '212'],
        [/ID impositivo/, ''],
        [/Qué exportás/, 'Servicios'],
        [/Monto total/, '100'],
        [/Descripción/, ''],
        [/moneda/, 'Pesos'],
        [/Forma de pago/, 'Transferencia Internacional'],
        [
          /Fecha de pago/,
          rejecting('15/11/2026', [
            '29/10/2026',
            /^La fecha de pago no puede ser anterior a la del comprobante \(hoy\): ARCA la rechaza \(error 1674\)\.$/,
          ]),
        ],
        [/Agregamos algún opcional/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

      const validate = script.askTextStep.mock.calls.find(([message]) => /Fecha de pago/.test(message))?.[1]?.validate;

      expect(validate?.('30/10/2026')).toBe(true);
      expect(printed()).toContain('--fecha-pago 15/11/2026');
    });

    it('la fecha del comprobante va en los opcionales con las reglas de `--fecha`, y la cotización es la de esa fecha (EXPO-11)', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-18T12:00:00-03:00'));
      const quotations = vi.spyOn(gateway, 'getQuotations');

      script = createScript([
        [/cliente del exterior/, 'ACME LLC'],
        [/Domicilio/, '123 Main St'],
        [/País de destino/, '212'],
        [/ID impositivo/, ''],
        [/Qué exportás/, 'Servicios'],
        [/Monto total/, '100'],
        [/Descripción/, ''],
        [/moneda/, 'Dólares'],
        [/Te pagan en dólares/, 'No'],
        [/Forma de pago/, 'Transferencia Internacional'],
        [/Fecha de pago/, '19/11/2026'],
        [/Agregamos algún opcional/, ['Fecha del comprobante']],
        [
          /Fecha del comprobante/,
          rejecting(
            '16/11',
            ['12/11/2026', /del 13\/11\/2026 al 23\/11\/2026.*error 1500/],
            ['20/11/2026', /posterior a la de pago \(19\/11\/2026\).*error 1674/],
          ),
        ],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

      // Servicios en dólares: la de aduana del día hábil anterior a la fecha elegida (EXPO-7), no la de hoy.
      expect(quotations).toHaveBeenCalledWith('20261115');
      expect(quotations).not.toHaveBeenCalledWith('20261117');
      expect(printed()).toContain('--fecha 16/11/2026');
      expect(printed()).toContain('--fecha-pago 19/11/2026');
    });

    it('en bienes el incoterm es obligatorio (1640): no ofrece "Sin incoterm"', async () => {
      script = createScript([
        [/cliente del exterior/, 'ACME LLC'],
        [/Domicilio/, '123 Main St'],
        [/País de destino/, '212'],
        [/ID impositivo/, ''],
        [/Qué exportás/, 'Bienes'],
        [/Monto total/, '800'],
        [/Descripción/, ''],
        [/moneda/, 'Pesos'],
        [/Incoterm/, 'EXW'],
        [/Permisos de embarque/, ''],
        [/Forma de pago/, 'Transferencia Internacional'],
        [/Agregamos algún opcional/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

      const incoterms = script.chooseStep.mock.calls.find(([message]) => /Incoterm/.test(message))?.[1] ?? [];

      expect(onlyChoices(incoterms).map((choice) => choice.name)).toEqual(['EXW', 'FOB']);
      expect(printed()).toContain('--incoterm EXW');
    });

    it('en servicios en dólares no ofrece la cotización a mano: ARCA exige la suya (2053)', async () => {
      script = createScript([
        [/cliente del exterior/, 'ACME LLC'],
        [/Domicilio/, '123 Main St'],
        [/País de destino/, '212'],
        [/ID impositivo/, ''],
        [/Qué exportás/, 'Servicios'],
        [/Monto total/, '100'],
        [/Descripción/, ''],
        [/moneda/, 'Dólares'],
        [/Te pagan en dólares/, 'No'],
        [/Forma de pago/, 'Transferencia Internacional'],
        [/Fecha de pago/, ''],
        [/Agregamos algún opcional/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

      const optionals = script.chooseManyStep.mock.calls.find(([message]) => /Agregamos/.test(message))?.[1] ?? [];

      expect(optionals.map((choice) => choice.name)).not.toContain('Cotización');
      expect(printed()).not.toContain('--cm');
    });

    it('en bienes con el pago en dólares tampoco ofrece la cotización (1604)', async () => {
      script = createScript([
        [/cliente del exterior/, 'ACME LLC'],
        [/Domicilio/, '123 Main St'],
        [/País de destino/, '212'],
        [/ID impositivo/, ''],
        [/Qué exportás/, 'Bienes'],
        [/Monto total/, '100'],
        [/Descripción/, ''],
        [/moneda/, 'Dólares'],
        [/Te pagan en dólares/, 'Sí'],
        [/Incoterm/, 'FOB'],
        [/Permisos de embarque/, ''],
        [/Forma de pago/, 'Transferencia Internacional'],
        [/Agregamos algún opcional/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

      const optionals = script.chooseManyStep.mock.calls.find(([message]) => /Agregamos/.test(message))?.[1] ?? [];

      expect(optionals.map((choice) => choice.name)).not.toContain('Cotización');
      expect(printed()).toContain('--misma-moneda');
    });

    it('en los ítems no ofrece las unidades 0, 97 y 99, que van sin cantidad ni precio (1775)', async () => {
      vi.spyOn(gateway, 'getUnits').mockResolvedValue([
        { id: 0, name: 'sin descripción' },
        { id: 7, name: 'unidades' },
        { id: 97, name: 'seña/anticipo' },
        { id: 99, name: 'bonificación' },
      ]);
      script = createScript([
        [/cliente del exterior/, 'ACME LLC'],
        [/Domicilio/, '123 Main St'],
        [/País de destino/, '212'],
        [/ID impositivo/, ''],
        [/Qué exportás/, 'Servicios'],
        [/Monto total/, '100'],
        [/Descripción/, ''],
        [/moneda/, 'Pesos'],
        [/Forma de pago/, 'Transferencia Internacional'],
        [/Fecha de pago/, ''],
        [/Agregamos algún opcional/, ['Ítems']],
        [/Descripción del ítem 1/, 'Consultoría'],
        [/Cantidad/, '1'],
        [/Precio unitario/, '100'],
        [/Unidad/, 'unidades'],
        [/Descripción del ítem 2/, ''],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

      const units = script.chooseStep.mock.calls.find(([message]) => /Unidad/.test(message))?.[1] ?? [];

      expect(onlyChoices(units).map((choice) => choice.name)).toEqual(['unidades']);
    });
  });

  it('volver desde el primer paso vuelve al selector de comprobantes', async () => {
    script = createScript([[/cliente del exterior/, BACK]]);

    await expect(runExportFlow(createSession())).resolves.toBe(BACK);
  });
});

describe('runExportFlow: volver en cada paso, ARCA que falla y el PDF despues de emitir', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(gateway.authorize).mockClear();
    vi.mocked(attachExportPdf).mockClear();
    savedConfig.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  /** Una E de servicios en dólares cobrada en dólares hasta la confirmación, con lo que respondan las ultimas. */
  const servicesUntilConfirmation = (confirmation: string) =>
    createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, '212'],
      [/ID impositivo/, ''],
      [/Qué exportás/, 'Servicios'],
      [/Monto total/, '1.500'],
      [/Descripción/, ''],
      [/moneda/, 'Dólares'],
      [/Te pagan en dólares/, 'Sí'],
      [/Forma de pago/, ''],
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, confirmation],
    ]);

  it('volver desde los opcionales hasta el cliente pasa por cada paso y sale al selector', async () => {
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, 'atlantida'],
      [/ARCA no tiene un CUIT publicado/, '55000002126'],
      [/ID impositivo/, '12-3456789'],
      [/Qué exportás/, 'Bienes'],
      [/Monto total/, '800'],
      [/Descripción/, 'Café'],
      [/moneda/, 'Dólares'],
      [/Te pagan en dólares/, 'No'],
      [/Incoterm/, 'FOB'],
      [/Permisos de embarque/, '26001EC01000123A'],
      [/Forma de pago/, 'Carta de crédito'],
      [/actividad/, '620100'],
      [/Agregamos algún opcional/, BACK],
      [/actividad/, BACK],
      [/Forma de pago/, BACK],
      [/Permisos de embarque/, BACK],
      [/Incoterm/, BACK],
      [/Te pagan en dólares/, BACK],
      [/moneda/, BACK],
      [/Descripción/, BACK],
      [/Monto total/, BACK],
      [/Qué exportás/, BACK],
      [/ID impositivo/, BACK],
      [/ARCA no tiene un CUIT publicado/, BACK],
      [/País de destino/, BACK],
      [/Domicilio/, BACK],
      [/cliente del exterior/, BACK],
    ]);
    vi.spyOn(gateway, 'getDestinationCountries').mockResolvedValue([
      { code: 212, name: 'ESTADOS UNIDOS' },
      { code: 999, name: 'ATLANTIDA' },
    ]);

    await expect(runExportFlow(createSession())).resolves.toBe(BACK);
    expect(gateway.authorize).not.toHaveBeenCalled();

    // REV-60: al volver, cada pregunta arranca con lo respondido: escrito en las de texto, marcado en las listas.
    const typed = Object.fromEntries(
      script.askTextStep.mock.calls
        .filter(([, options]) => options?.previousAnswer !== undefined)
        .map(([message, options]) => [message.split(' (')[0], options?.previousAnswer]),
    );
    const marked = script.chooseStep.mock.calls.slice(-4).map((call) => call[2]);

    expect(typed).toEqual({
      'Código de actividad de WSFEX, por ejemplo 620100': '620100',
      'Descripción del servicio o producto': 'Café',
      'Domicilio del cliente:': '123 Main St',
      'Forma de pago:': 'Carta de crédito',
      'ID impositivo del cliente en su país': '12-3456789',
      'Monto total:': '800',
      'Nombre o razón social del cliente del exterior:': 'ACME LLC',
      'País de destino': 'ATLANTIDA',
      'Permisos de embarque ya existentes, separados por coma': '26001EC01000123A',
    });
    expect(marked).toEqual(['FOB', false, 'DOL', 1]);
  });

  it('pasar de bienes a servicios no deja el incoterm ni los permisos elegidos', async () => {
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, '212'],
      [/ID impositivo/, ''],
      [/Qué exportás/, 'Bienes'],
      [/Monto total/, '1.500'],
      [/Descripción/, ''],
      [/moneda/, 'Pesos'],
      [/Incoterm/, 'FOB'],
      [/Permisos de embarque/, '26001EC01000123A'],
      [/Forma de pago/, BACK],
      [/Permisos de embarque/, BACK],
      [/Incoterm/, BACK],
      [/moneda/, BACK],
      [/Descripción/, BACK],
      [/Monto total/, BACK],
      [/Qué exportás/, 'Servicios'],
      [/Monto total/, '1.500'],
      [/Descripción/, ''],
      [/moneda/, 'Pesos'],
      [/Forma de pago/, ''],
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'Sí, emitir ahora'],
    ]);

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

    const sent = vi.mocked(gateway.authorize).mock.calls[0]?.[0];

    expect(sent).toMatchObject({ Tipo_expo: 2 });
    expect(sent?.Incoterms).toBeFalsy();
    expect(sent?.Permisos).toBeFalsy();
    expect(printed()).not.toContain('--incoterm');
    expect(printed()).not.toContain('--permiso');
  });

  it('una actividad que no esta en la tabla de WSFEX se rechaza; sin tabla, cualquiera vale y avisa', async () => {
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, '212'],
      [/ID impositivo/, ''],
      [/Qué exportás/, 'Servicios'],
      [/Monto total/, '100'],
      [/Descripción/, ''],
      [/moneda/, 'Pesos'],
      [/Forma de pago/, ''],
      [/Fecha de pago/, ''],
      [/actividad/, rejecting('620100', ['999999', /no está en la tabla de actividades.*2105/], ['abc', /actividad/i])],
      [/Agregamos algún opcional/, []],
      // Sin emitir no se ofrece guardar la actividad (REV-62).
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportFlow(createSession());

    // ARCA no devolvio la tabla: no se puede controlar, asi que se acepta.
    vi.spyOn(gateway, 'getActivities').mockResolvedValue([]);
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, '212'],
      [/ID impositivo/, ''],
      [/Qué exportás/, 'Servicios'],
      [/Monto total/, '100'],
      [/Descripción/, ''],
      [/moneda/, 'Pesos'],
      [/Forma de pago/, ''],
      [/Fecha de pago/, ''],
      [/actividad/, '999999'],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportFlow(createSession());

    expect(printed()).toContain('--actividad 999999');
    expect(printed()).toMatch(/tabla de actividades de WSFEX: 999999 va sin validar/);
    expect(savedConfig).not.toHaveBeenCalled();
  });

  it('sin tabla de incoterms, el de una E de bienes se escribe a mano y va sin validar, con aviso (REV-62)', async () => {
    vi.spyOn(gateway, 'getIncoterms').mockResolvedValue([]);
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, '212'],
      [/ID impositivo/, ''],
      [/Qué exportás/, 'Bienes'],
      [/Monto total/, '100'],
      [/Descripción/, ''],
      [/moneda/, 'Pesos'],
      [/Incoterm \(ARCA no devolvió la lista\)/, rejecting('fob', ['', /obligatorio/])],
      [/Permisos de embarque/, ''],
      [/Forma de pago/, ''],
      [/actividad/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportFlow(createSession());

    expect(printed()).toContain('--incoterm FOB');
    expect(printed()).toMatch(/tabla de incoterms de WSFEX: FOB va sin validar/);
  });

  it('si ARCA falla al emitir, el error llega al menu y no se ofrece el PDF ni guardar la actividad', async () => {
    vi.mocked(gateway.authorize).mockRejectedValueOnce(new Error('ECONNRESET: ARCA no respondió'));
    script = servicesUntilConfirmation('Sí, emitir ahora');

    await expect(runExportFlow(createSession({ exportacion: { actividad: 620100 } }))).rejects.toThrow('ECONNRESET');
    expect(attachExportPdf).not.toHaveBeenCalled();
  });

  it('si ARCA rechaza la E, lo muestra y no hay PDF', async () => {
    vi.mocked(gateway.authorize).mockResolvedValueOnce({
      FEXAuthorizeResult: {
        FEXErr: { ErrCode: 1580, ErrMsg: 'Debe informar el CUIT del país o el ID impositivo' },
        FEXEvents: { EventCode: 0, EventMsg: '' },
      },
    } as IFEXAuthorizeOutput);
    script = servicesUntilConfirmation('Sí, emitir ahora');

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } })).catch(() => undefined);

    expect(printed()).toMatch(/1580|CUIT del país/);
  });

  it('con el PDF generado, muestra dónde quedó', async () => {
    vi.mocked(attachExportPdf).mockImplementationOnce(
      async (result) =>
        ({
          ...(result as object),
          pdf: { path: '/tmp/fe-4-7.pdf' },
        }) as never,
    );
    script = servicesUntilConfirmation('Sí, emitir ahora');

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

    expect(printed()).toContain('PDF guardado en /tmp/fe-4-7.pdf');
  });

  it('Ctrl+C mientras se piden los datos del PDF no dice "No se emitió nada": ya quedó emitida', async () => {
    vi.mocked(attachExportPdf).mockRejectedValueOnce(Object.assign(new Error('Ctrl+C'), { name: 'ExitPromptError' }));
    script = servicesUntilConfirmation('Sí, emitir ahora');

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

    expect(gateway.authorize).toHaveBeenCalledOnce();
    expect(printed()).toContain('El comprobante ya quedó emitido; no se generó el PDF.');
    expect(printed()).not.toContain('No se emitió nada');
  });

  it('otro error del PDF despues de emitir no se tapa', async () => {
    vi.mocked(attachExportPdf).mockRejectedValueOnce(new Error('disco lleno'));
    script = servicesUntilConfirmation('Sí, emitir ahora');

    await expect(runExportFlow(createSession({ exportacion: { actividad: 620100 } }))).rejects.toThrow('disco lleno');
  });

  it('si ARCA falla al leer las tablas, no pregunta nada', async () => {
    vi.spyOn(gateway, 'getDestinationCountries').mockRejectedValueOnce(new Error('ARCA no responde'));
    script = createScript([]);

    await expect(runExportFlow(createSession())).rejects.toThrow('ARCA no responde');
    expect(script.asked).toEqual([]);
  });
});
