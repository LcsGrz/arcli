import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import type { ExportGateway } from '../../../modules/export/export.types';
import { BACK } from '../../../modules/interactive/wizard';
import { exportAnswer } from '../../../testing/arca-answers';
import { fakeBillingGateway } from '../../../testing/arca-gateways';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
import { outputState } from '../../closed-output';
import { attachExportPdf } from '../../commands/export.command.pdf';
import { describeEmittedInThisRun, resetEmittedInThisRun } from '../../emitted-vouchers';
import { runExportFlow } from '../export.flow';
import { withOutputGuard } from '../output-guard';
import type { InteractiveSession } from '../session';

import { createScript, editing, onlyChoices, rejecting, type ScriptedAnswer, singleExportItem } from './script';

let script = createScript([]);
const savedConfig = vi.fn();

const gateway: ExportGateway = {
  authorize: vi.fn(async () =>
    exportAnswer({
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
    }),
  ),
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
  chooseFromFilterList: (...args: Parameters<typeof script.chooseFromFilterList>) =>
    script.chooseFromFilterList(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseOrTypeStep: (...args: Parameters<typeof script.chooseOrTypeStep>) => script.chooseOrTypeStep(...args),
  chooseOne: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(args[0], args[1]),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  confirm: (message: string, yesLabel: string, noLabel = 'Cancelar') =>
    script.chooseStep(message, [
      { name: yesLabel, value: true },
      { name: noLabel, value: false },
    ]),
  editRowsStep: (...args: Parameters<typeof script.editRowsStep>) => script.editRowsStep(...args),
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
    billingGateway: fakeBillingGateway(),
    historyGateway: { getLastNumber: vi.fn(), getVoucher: vi.fn() },
    runtime: {
      config: arcliConfigSchema.parse({ cuit: '20111111112', puntoVentaPorDefecto: 4, ...config }),
      cuit: 20111111112,
      environment: 'testing',
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

describe('runExportFlow', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(gateway.authorize).mockClear();
    savedConfig.mockClear();
  });

  afterEach(() => {
    resetEmittedInThisRun();
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  it('con stdout roto en "¿Emitimos?" no emite (ERR-18)', async () => {
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, 'estados unidos'],
      [/ID impositivo/, '12-3456789'],
      [/Qué exportás/, 'Servicios'],
      [/moneda/, 'Dólares'],
      [/Te pagan en dólares/, 'Sí'],
      ...singleExportItem('1.500', 'Consultoría de software'),
      [/Forma de pago/, 'Transferencia Internacional'],
      [/Actividad de WSFEX/, '620100'],
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos la factura de exportación E en testing/, 'Sí, emitir ahora'],
    ]);

    vi.mocked(process.stdout.write).mockImplementation((chunk) => {
      if (String(chunk).includes('Esto equivale a')) {
        outputState.failures.set('stdout', new Error('write'));
      }

      return true;
    });

    try {
      await expect(withOutputGuard(async () => void (await runExportFlow(createSession())))).rejects.toThrow();
      expect(gateway.authorize).not.toHaveBeenCalled();
    } finally {
      outputState.failures.clear();
    }
  });

  it('emite una E de servicios en dólares y ofrece guardar la actividad escrita a mano', async () => {
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, 'estados unidos'],
      [/ID impositivo/, '12-3456789'],
      [/Qué exportás/, 'Servicios'],
      [/moneda/, 'Dólares'],
      [/Te pagan en dólares/, 'Sí'],
      ...singleExportItem('1.500', 'Consultoría de software'),
      [/Forma de pago/, 'Transferencia Internacional'],
      [/Actividad de WSFEX/, '620100'],
      [/Fecha de pago/, ''],
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
    // Si despues no se puede escribir la salida, el aviso dice que se emitio (ERR-18).
    expect(describeEmittedInThisRun()).toEqual([expect.stringContaining('fe del punto de venta 4, 7.')]);
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
      [/moneda/, 'Pesos'],
      ...singleExportItem('100'),
      [/Forma de pago/, 'Transferencia Internacional'],
      [/Actividad de WSFEX/, ''],
      [/Fecha de pago/, ''],
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
      [/moneda/, 'Pesos'],
      ...singleExportItem('800'),
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

  it('informa los ítems (el total es su suma), y con los opcionales idioma, observaciones y descripción del incoterm; la cotización acordada va antes de los ítems', async () => {
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, '212'],
      [/ID impositivo/, ''],
      [/Qué exportás/, 'Bienes'],
      [/moneda/, 'Dólares'],
      [/Te pagan en dólares/, 'No'],
      [/Cotización de USD \(la oficial de ARCA es 1\.174,60\)/, '1.200,5'],
      // Sin "Monto total": el total es la suma de los ítems (NAV-10).
      [/Descripción del ítem 1/, 'Bienes varios'],
      [/Cantidad/, '2'],
      [/Unidad/, 'kilogramos'],
      [/^(?:Importe|Precio unitario)/, '500'],
      [/Descripción del ítem 2 \(Enter para terminar\)/, 'Flete'],
      [/Cantidad/, '1'],
      [/Unidad/, 'unidades'],
      [/^(?:Importe|Precio unitario)/, '500'],
      [/Descripción del ítem 3/, ''],
      [/Importe total de la factura de exportación E: 1\.500 USD \(2 ítems\)/, 'Confirmar'],
      [/Incoterm/, 'FOB'],
      [/Permisos de embarque/, ''],
      [/Forma de pago/, 'Transferencia Internacional'],
      [/Agregamos algún opcional/, ['Idioma', 'Observaciones', 'Descripción del incoterm']],
      [/Idioma del comprobante/, 'Inglés'],
      [/^Observaciones \(/, 'Pedido 42'],
      [/Observaciones comerciales/, ''],
      [/Descripción del incoterm FOB/, 'Free on board, BA'],
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
    expect(printed()).toContain("-m 1500 --cliente 'ACME LLC'");
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
      [/ID impositivo/, ''],
      [/Qué exportás/, 'Servicios'],
      [/moneda/, 'Pesos'],
      ...singleExportItem('100'),
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
      [/ARCA no tiene un CUIT publicado para ATLANTIDA/, ''],
      [/ID impositivo del cliente en su país \(sin CUIT del país, ARCA lo pide\)/, 'IE1234567T'],
      [/Qué exportás/, 'Servicios'],
      [/moneda/, 'Pesos'],
      ...singleExportItem('100'),
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
        [/moneda/, 'Pesos'],
        [
          /Descripción del ítem 1/,
          rejecting('Consultoría', ['a'.repeat(4001), /más de 4\.000 caracteres.*error 1770/]),
        ],
        ...singleExportItem('100').slice(1),
        // Contenido en la sugerencia "Transferencia Internacional": en el texto libre lo escrito gana (TUI-26).
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

    // TUI-22: "Fecha de pago" va antes de los opcionales, donde se elige la fecha del comprobante. Al preguntarla se
    // compara con la más temprana que ARCA acepta para el comprobante (hoy - 5); la comparación exacta la hacen
    // "Fecha del comprobante" y `finalize`.
    it('la fecha de pago anterior a la más temprana del comprobante da el error 1674 y vuelve a preguntar', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-30T12:00:00-03:00'));
      script = createScript([
        [/cliente del exterior/, 'ACME LLC'],
        [/Domicilio/, '123 Main St'],
        [/País de destino/, '212'],
        [/ID impositivo/, ''],
        [/Qué exportás/, 'Servicios'],
        [/moneda/, 'Pesos'],
        ...singleExportItem('100'),
        [/Forma de pago/, 'Transferencia Internacional'],
        [
          /Fecha de pago/,
          rejecting('15/11/2026', [
            '24/10/2026',
            /^La fecha de pago no puede ser anterior al 25\/10\/2026: es la fecha más temprana que ARCA acepta para el comprobante, y un pago anterior a él lo rechaza \(error 1674\)\.$/,
          ]),
        ],
        [/Agregamos algún opcional/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

      const validate = script.askTextStep.mock.calls.find(([message]) => /Fecha de pago/.test(message))?.[1]?.validate;

      // Antes de hoy vale al preguntarla: con una fecha del comprobante anterior, ARCA la acepta.
      expect(validate?.('25/10/2026')).toBe(true);
      expect(validate?.('30/10/2026')).toBe(true);
      expect(printed()).toContain('--fecha-pago 15/11/2026');
      expect(script.asked.findIndex((message) => /Fecha de pago/.test(message))).toBeLessThan(
        script.asked.findIndex((message) => /Agregamos/.test(message)),
      );
    });

    it('la fecha del comprobante va en los opcionales con las reglas de `--fecha` y no puede quedar después de la de pago, como `--fecha-pago` (EXPO-11, EXPO-12)', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-18T12:00:00-03:00'));
      const quotations = vi.spyOn(gateway, 'getQuotations');

      script = createScript([
        [/cliente del exterior/, 'ACME LLC'],
        [/Domicilio/, '123 Main St'],
        [/País de destino/, '212'],
        [/ID impositivo/, ''],
        [/Qué exportás/, 'Servicios'],
        [/moneda/, 'Dólares'],
        [/Te pagan en dólares/, 'No'],
        ...singleExportItem('100'),
        [/Forma de pago/, 'Transferencia Internacional'],
        // Anterior a hoy pero no a la más temprana posible: vale al preguntarla.
        [/Fecha de pago/, '17/11/2026'],
        [/Agregamos algún opcional/, ['Fecha del comprobante']],
        [
          /Fecha del comprobante/,
          rejecting(
            '16/11',
            ['12/11/2026', /del 13\/11\/2026 al 23\/11\/2026.*error 1500/],
            ['18/11/2026', /anterior a la del comprobante \(18\/11\/2026\).*error 1674/],
          ),
        ],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

      // Servicios en dólares: la vista previa usa la de aduana del día hábil anterior a la fecha elegida (EXPO-7). El
      // aviso de la cotización, antes de elegir la fecha, mostró la del día hábil anterior a hoy (NAV-9).
      expect(quotations.mock.calls).toEqual([['20261117'], ['20261115']]);
      expect(printed()).toContain('--fecha 16/11/2026');
      expect(printed()).toContain('--fecha-pago 17/11/2026');
    });

    it('si la fecha del comprobante que queda deja la de pago antes, `finalize` vuelve a "Fecha de pago" con el error', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-18T12:00:00-03:00'));
      script = createScript([
        [/cliente del exterior/, 'ACME LLC'],
        [/Domicilio/, '123 Main St'],
        [/País de destino/, '212'],
        [/ID impositivo/, ''],
        [/Qué exportás/, 'Servicios'],
        [/moneda/, 'Pesos'],
        ...singleExportItem('100'),
        [/Forma de pago/, 'Transferencia Internacional'],
        // Válida contra la más temprana posible (13/11), pero sin elegir la fecha del comprobante va la de hoy.
        [/Fecha de pago/, '15/11/2026'],
        [/Agregamos algún opcional/, []],
        [/Fecha de pago/, '20/11/2026'],
        [/Agregamos algún opcional/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

      expect(printed().replace(/\s+/g, ' ')).toContain(
        'La fecha de pago no puede ser anterior a la del comprobante (hoy): ARCA la rechaza (error 1674). Escribí una desde el 18/11/2026, o volvé y elegí una fecha del comprobante anterior en los opcionales.',
      );
      const payments = script.askTextStep.mock.calls.filter(([message]) => /Fecha de pago/.test(message));

      expect(payments.map(([, options]) => options?.previousAnswer)).toEqual([undefined, '15/11/2026']);
      // De vuelta, ya se sabe que va la de hoy: la misma no pasa.
      expect(payments[1]?.[1]?.validate?.('15/11/2026')).toMatch(/del comprobante \(hoy\).*error 1674/);
      expect(printed()).toContain('--fecha-pago 20/11/2026');
    });

    it('con Enter la fecha de pago es la del comprobante que se elige después, como sin `--fecha-pago`', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-18T12:00:00-03:00'));
      script = createScript([
        [/cliente del exterior/, 'ACME LLC'],
        [/Domicilio/, '123 Main St'],
        [/País de destino/, '212'],
        [/ID impositivo/, ''],
        [/Qué exportás/, 'Servicios'],
        [/moneda/, 'Pesos'],
        ...singleExportItem('100'),
        [/Forma de pago/, 'Transferencia Internacional'],
        [/Fecha de pago/, ''],
        [/Agregamos algún opcional/, ['Fecha del comprobante']],
        [/Fecha del comprobante/, '20/11/2026'],
        [/Emitimos/, 'Sí, emitir ahora'],
      ]);

      await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

      expect(gateway.authorize).toHaveBeenCalledWith(
        expect.objectContaining({ Fecha_cbte: '20261120', Fecha_pago: '20261120' }),
      );
      expect(printed()).toContain('--fecha 20/11/2026');
      expect(printed()).not.toContain('--fecha-pago');
    });

    it('en bienes el incoterm es obligatorio (1640): no ofrece "Sin incoterm"', async () => {
      script = createScript([
        [/cliente del exterior/, 'ACME LLC'],
        [/Domicilio/, '123 Main St'],
        [/País de destino/, '212'],
        [/ID impositivo/, ''],
        [/Qué exportás/, 'Bienes'],
        [/moneda/, 'Pesos'],
        ...singleExportItem('800'),
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

    it('en servicios en dólares no pregunta la cotización: ARCA exige la suya (2053)', async () => {
      script = createScript([
        [/cliente del exterior/, 'ACME LLC'],
        [/Domicilio/, '123 Main St'],
        [/País de destino/, '212'],
        [/ID impositivo/, ''],
        [/Qué exportás/, 'Servicios'],
        [/moneda/, 'Dólares'],
        [/Te pagan en dólares/, 'No'],
        ...singleExportItem('100'),
        [/Forma de pago/, 'Transferencia Internacional'],
        [/Fecha de pago/, ''],
        [/Agregamos algún opcional/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

      const optionals = script.chooseManyStep.mock.calls.find(([message]) => /Agregamos/.test(message))?.[1] ?? [];

      expect(optionals.map((choice) => choice.name)).not.toContain('Cotización');
      expect(script.asked.some((message) => message.startsWith('Cotización'))).toBe(false);
      expect(printed()).not.toContain('--cm');
    });

    it('en bienes con el pago en dólares tampoco pregunta la cotización (1604)', async () => {
      script = createScript([
        [/cliente del exterior/, 'ACME LLC'],
        [/Domicilio/, '123 Main St'],
        [/País de destino/, '212'],
        [/ID impositivo/, ''],
        [/Qué exportás/, 'Bienes'],
        [/moneda/, 'Dólares'],
        [/Te pagan en dólares/, 'Sí'],
        ...singleExportItem('100'),
        [/Incoterm/, 'FOB'],
        [/Permisos de embarque/, ''],
        [/Forma de pago/, 'Transferencia Internacional'],
        [/Agregamos algún opcional/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

      const optionals = script.chooseManyStep.mock.calls.find(([message]) => /Agregamos/.test(message))?.[1] ?? [];

      expect(optionals.map((choice) => choice.name)).not.toContain('Cotización');
      expect(script.asked.some((message) => message.startsWith('Cotización'))).toBe(false);
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
        [/moneda/, 'Pesos'],
        ...singleExportItem('100', 'Consultoría'),
        [/Forma de pago/, 'Transferencia Internacional'],
        [/Fecha de pago/, ''],
        [/Agregamos algún opcional/, []],
        [/Emitimos/, 'No, dejar sin emitir'],
      ]);

      await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

      const units = script.chooseFromFilterList.mock.calls.find(([message]) => /Unidad/.test(message))?.[1] ?? [];

      expect(units.map((row) => row.label)).toEqual(['unidades']);
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
      [/moneda/, 'Dólares'],
      [/Te pagan en dólares/, 'Sí'],
      ...singleExportItem('1.500'),
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
      [/moneda/, 'Dólares'],
      [/Te pagan en dólares/, 'No'],
      [/Cotización de USD/, '1.180'],
      ...singleExportItem('800', 'Café'),
      [/Incoterm/, 'FOB'],
      [/Permisos de embarque/, '26001EC01000123A'],
      [/Forma de pago/, 'Carta de crédito'],
      [/Actividad de WSFEX/, '620100'],
      [/Agregamos algún opcional/, BACK],
      [/Actividad de WSFEX/, BACK],
      [/Forma de pago/, BACK],
      [/Permisos de embarque/, BACK],
      [/Incoterm/, BACK],
      // Con ítems cargados arranca en el editor; Esc ahí vuelve al paso anterior (NAV-10).
      [/^Ítems de .*: modificá o eliminá ítems/, BACK],
      [/Cotización de USD/, BACK],
      [/Te pagan en dólares/, BACK],
      [/moneda/, BACK],
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

    // REV-60: al volver, cada pregunta arranca con lo respondido: escrito en las de texto, marcado en las listas. El
    // CUIT del país también (REV-74, #10).
    const typed = Object.fromEntries(
      script.askTextStep.mock.calls
        .filter(([, options]) => options?.previousAnswer !== undefined)
        .map(([message, options]) => [message.split(' (')[0], options?.previousAnswer]),
    );
    const marked = script.chooseStep.mock.calls.slice(-4).map((call) => call[2]);
    // En las listas donde tambien se escribe, lo respondido arranca marcado (o escrito, si no es de la lista).
    const chosen = Object.fromEntries(
      script.chooseOrTypeStep.mock.calls
        .filter(([, , options]) => options.previous !== undefined)
        .map(([message, , options]) => [message.split('.')[0], options.previous]),
    );

    // La actividad y la forma de pago son listas donde tambien se escribe (TUI-25, TUI-26): lo respondido arranca marcado.
    expect(chosen).toEqual({
      'ARCA no tiene un CUIT publicado para ATLANTIDA': 55000002126,
      'Actividad de WSFEX:': 620100,
      'Forma de pago:': 'Carta de crédito',
      'País de destino:': 'ATLANTIDA',
    });
    expect(typed).toEqual({
      // Escrita a mano, arranca con la escrita y no con la de ARCA (NAV-9).
      'Cotización de USD': '1180',
      'Domicilio del cliente:': '123 Main St',
      'ID impositivo del cliente en su país:': '12-3456789',
      'Nombre o razón social del cliente del exterior:': 'ACME LLC',
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
      [/moneda/, 'Pesos'],
      ...singleExportItem('1.500'),
      [/Incoterm/, 'FOB'],
      [/Permisos de embarque/, '26001EC01000123A'],
      [/Forma de pago/, BACK],
      [/Permisos de embarque/, BACK],
      [/Incoterm/, BACK],
      [/^Ítems de .*: modificá o eliminá ítems/, BACK],
      [/moneda/, BACK],
      [/Qué exportás/, 'Servicios'],
      [/moneda/, 'Pesos'],
      // Con la misma moneda, los ítems siguen: arranca en el editor.
      [/^Ítems de .*: modificá o eliminá ítems/, editing({})],
      [/Importe total/, 'Confirmar'],
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
      [/moneda/, 'Pesos'],
      ...singleExportItem('100'),
      [/Forma de pago/, ''],
      [
        /Actividad de WSFEX/,
        rejecting('620100', ['999999', /no está en la tabla de actividades.*2105/], ['abc', /actividad/i]),
      ],
      [/Fecha de pago/, ''],
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
      [/moneda/, 'Pesos'],
      ...singleExportItem('100'),
      [/Forma de pago/, ''],
      [/Actividad de WSFEX/, '999999'],
      [/Fecha de pago/, ''],
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
      [/moneda/, 'Pesos'],
      ...singleExportItem('100'),
      [/Incoterm \(ARCA no devolvió la lista\)/, rejecting('fob', ['', /obligatorio/])],
      [/Permisos de embarque/, ''],
      [/Forma de pago/, ''],
      [/Actividad de WSFEX/, ''],
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

  it('si ARCA contesta algo que no se puede leer, el menu recibe "sin confirmar" y no hay PDF ni se ofrece guardar (ERR-16)', async () => {
    vi.mocked(gateway.authorize).mockImplementationOnce(async () => exportAnswer(undefined));

    script = servicesUntilConfirmation('Sí, emitir ahora');

    await expect(runExportFlow(createSession({ exportacion: { actividad: 620100 } }))).rejects.toMatchObject({
      code: 'EMISSION_UNCERTAIN',
      verifyCommand: 'arcli consultar fe 7 --pv 4 --testing',
    });
    expect(attachExportPdf).not.toHaveBeenCalled();
    expect(savedConfig).not.toHaveBeenCalled();
  });

  it('si ARCA contesta vacío, el menu recibe "sin confirmar" y no hay PDF ni se ofrece guardar (ERR-20)', async () => {
    savedConfig.mockClear();
    vi.mocked(attachExportPdf).mockClear();
    vi.mocked(gateway.authorize).mockImplementationOnce(async () => exportAnswer({}));
    script = servicesUntilConfirmation('Sí, emitir ahora');

    await expect(runExportFlow(createSession({ exportacion: { actividad: 620100 } }))).rejects.toMatchObject({
      code: 'EMISSION_UNCERTAIN',
      verifyCommand: 'arcli consultar fe 7 --pv 4 --testing',
    });
    expect(attachExportPdf).not.toHaveBeenCalled();
    expect(savedConfig).not.toHaveBeenCalled();
  });

  it('si ARCA rechaza la E, lo muestra y no hay PDF', async () => {
    vi.mocked(gateway.authorize).mockImplementationOnce(async () =>
      exportAnswer({
        FEXAuthorizeResult: {
          FEXErr: { ErrCode: 1580, ErrMsg: 'Debe informar el CUIT del país o el ID impositivo' },
          FEXEvents: { EventCode: 0, EventMsg: '' },
        },
      }),
    );
    script = servicesUntilConfirmation('Sí, emitir ahora');

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } })).catch(() => undefined);

    expect(printed()).toMatch(/1580|CUIT del país/);
  });

  // Un rechazo no es una emision (#11, #16): la actividad escrita a mano no se ofrece guardar.
  it('si ARCA rechaza la E, no ofrece guardar la actividad escrita', async () => {
    savedConfig.mockClear();
    vi.mocked(gateway.authorize).mockImplementationOnce(async () =>
      exportAnswer({
        FEXAuthorizeResult: {
          FEXErr: { ErrCode: 1580, ErrMsg: 'Debe informar el CUIT del país o el ID impositivo' },
          FEXEvents: { EventCode: 0, EventMsg: '' },
        },
      }),
    );
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, '212'],
      [/ID impositivo/, ''],
      [/Qué exportás/, 'Servicios'],
      [/moneda/, 'Dólares'],
      [/Te pagan en dólares/, 'Sí'],
      ...singleExportItem('1.500'),
      [/Forma de pago/, ''],
      [/Actividad de WSFEX/, '620100'],
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'Sí, emitir ahora'],
    ]);

    await runExportFlow(createSession()).catch(() => undefined);

    expect(gateway.authorize).toHaveBeenCalled();
    expect(script.asked.some((message) => /Guardamos la actividad/.test(message))).toBe(false);
    expect(savedConfig).not.toHaveBeenCalled();
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

  const cancelled = Object.assign(new Error('x'), { name: 'ExitPromptError' });

  it.each([
    ['cortado por la salida rota', true, cancelled, 1],
    ['cancelado con Ctrl+C', false, cancelled, 0],
    ['que falló', false, { error: { code: 'PDF_PLUGIN_MISSING', message: 'x' } }, 1],
    ['generado', false, { path: '/x.pdf' }, 0],
  ])('un PDF %s: lo que dice el aviso de la salida (ERR-18)', async (_name, lost, outcome, missing) => {
    vi.mocked(attachExportPdf).mockImplementationOnce(async (result) => {
      if (outcome instanceof Error) {
        throw outcome;
      }

      return { ...result, pdf: outcome } as never;
    });
    script = servicesUntilConfirmation('Sí, emitir ahora');

    if (lost) {
      outputState.failures.set('stdout', new Error('write'));
    }

    try {
      await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));
      expect(describeEmittedInThisRun().filter((line) => line.startsWith('No se generó el PDF: fe'))).toHaveLength(
        missing,
      );
    } finally {
      outputState.failures.clear();
      resetEmittedInThisRun();
    }
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

describe('runExportFlow: la cotización después de la moneda (NAV-9)', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(gateway.authorize).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  /** Una E de bienes en dólares cobrada en pesos (o en pesos), hasta emitir, con `rate` en la cotización. */
  function goodsIn(currency: 'Dólares' | 'Pesos', rate?: ScriptedAnswer) {
    return createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, '212'],
      [/ID impositivo/, ''],
      [/Qué exportás/, 'Bienes'],
      [/moneda/, currency],
      ...(rate === undefined
        ? []
        : ([
            [/Te pagan en dólares/, 'No'],
            [/^Cotización de USD/, rate],
          ] as const)),
      ...singleExportItem('1.500'),
      [/Incoterm/, 'FOB'],
      [/Permisos de embarque/, ''],
      [/Forma de pago/, 'Transferencia Internacional'],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'Sí, emitir ahora'],
    ]);
  }

  function exchangeRateQuestion() {
    return script.askTextStep.mock.calls.find(([message]) => message.startsWith('Cotización'));
  }

  it('arranca con la de aduana de ARCA; sin tocarla, el comando va sin --cm y la solicitud lleva la de ARCA', async () => {
    script = goodsIn('Dólares', '1174,60');

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

    expect(exchangeRateQuestion()?.[0]).toBe('Cotización de USD (la oficial de ARCA es 1.174,60):');
    expect(exchangeRateQuestion()?.[1]).toMatchObject({ previousAnswer: '1174,60' });
    expect(gateway.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ CanMisMonExt: 'N', Moneda_ctz: 1174.6, Moneda_Id: 'DOL' }),
    );
    expect(printed()).not.toContain('--cm');
  });

  it('editada, el comando la lleva con --cm y la solicitud también', async () => {
    script = goodsIn('Dólares', '1.300');

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

    expect(gateway.authorize).toHaveBeenCalledWith(expect.objectContaining({ Moneda_ctz: 1300 }));
    expect(printed()).toContain('--moneda DOL --cm 1300');
  });

  it('valida como `--cm`: 0 y 1 no son cotizaciones', async () => {
    script = goodsIn('Dólares', rejecting('1.300', ['0', /mayor a 0|acordada/], ['1', /acordada/]));

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

    expect(gateway.authorize).toHaveBeenCalledWith(expect.objectContaining({ Moneda_ctz: 1300 }));
  });

  it('sin red arranca vacía: la escrita es la acordada y va con --cm', async () => {
    script = goodsIn('Dólares', '1.180');
    vi.spyOn(gateway, 'getQuotations').mockRejectedValueOnce(new Error('Sin conexión'));

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

    expect(exchangeRateQuestion()?.[0]).toBe('Cotización de USD:');
    expect(exchangeRateQuestion()?.[1]?.previousAnswer).toBeUndefined();
    expect(gateway.authorize).toHaveBeenCalledWith(expect.objectContaining({ Moneda_ctz: 1180 }));
    expect(printed()).toContain('--cm 1180');
  });

  it('en pesos no se pregunta', async () => {
    script = goodsIn('Pesos');

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

    expect(exchangeRateQuestion()).toBeUndefined();
    expect(gateway.authorize).toHaveBeenCalledWith(expect.objectContaining({ Moneda_ctz: 1, Moneda_Id: 'PES' }));
    expect(printed()).not.toContain('Cotización:');
  });

  /** Lo impreso en una línea: los avisos se cortan al ancho del panel. */
  const flat = () => printed().replace(/\s+/g, ' ');

  /** Una E en dólares de `kind`, hasta emitir, con "¿Te pagan en dólares?" en `paid`. */
  function fixedRate(kind: 'Bienes' | 'Servicios', paid: 'No' | 'Sí') {
    return createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, '212'],
      [/ID impositivo/, ''],
      [/Qué exportás/, kind],
      [/moneda/, 'Dólares'],
      [/Te pagan en dólares/, paid],
      ...singleExportItem('1.500'),
      ...(kind === 'Bienes'
        ? ([
            [/Incoterm/, 'FOB'],
            [/Permisos de embarque/, ''],
          ] as const)
        : []),
      [/Forma de pago/, 'Transferencia Internacional'],
      ...(kind === 'Servicios' ? ([[/Fecha de pago/, '']] as const) : []),
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'Sí, emitir ahora'],
    ]);
  }

  it('en servicios no la pregunta: la muestra después de la moneda, la misma que va a ARCA (2053)', async () => {
    script = fixedRate('Servicios', 'No');
    vi.spyOn(gateway, 'getQuotations').mockResolvedValue([{ code: 'DOL', date: '20261029', rate: 1174.605 }]);

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

    expect(exchangeRateQuestion()).toBeUndefined();
    expect(flat()).toContain(
      'Cotización: 1.174,605 por USD, la de aduana del día hábil anterior. ARCA no acepta otra en servicios.',
    );
    // El orden (despues de la moneda, antes del monto) lo muestran los golden de la E de servicios.
    expect(gateway.authorize).toHaveBeenCalledWith(expect.objectContaining({ Moneda_ctz: 1174.605 }));
    expect(printed()).not.toContain('--cm');
  });

  it('con "¿Te pagan en dólares? Sí" tampoco: la muestra con el motivo (1604)', async () => {
    script = fixedRate('Bienes', 'Sí');

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

    expect(exchangeRateQuestion()).toBeUndefined();
    expect(flat()).toContain(
      'Cotización: 1.174,60 por USD, la oficial del día hábil anterior. ARCA no acepta otra si te pagan en USD.',
    );
    expect(gateway.authorize).toHaveBeenCalledWith(expect.objectContaining({ CanMisMonExt: 'S', Moneda_ctz: 1174.6 }));
  });

  it('sin red avisa que va la de ARCA y sigue; la vista previa la vuelve a consultar', async () => {
    script = fixedRate('Servicios', 'Sí');
    vi.spyOn(gateway, 'getQuotations').mockRejectedValueOnce(new Error('Sin conexión'));

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

    expect(flat()).toContain('No se pudo consultar la cotización: va la de ARCA del día hábil anterior.');
    expect(gateway.authorize).toHaveBeenCalledWith(expect.objectContaining({ Moneda_ctz: 1174.6 }));
  });
});

describe('runExportFlow: el país y el CUIT del país de una lista donde también se escribe (TUI-24, TUI-36, TUI-35)', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(gateway.authorize).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  /**
   * Emite una E de servicios en pesos con las respuestas del destino (el país y lo que siga hasta "¿Qué exportás?") y
   * devuelve lo que fue a ARCA y el comando equivalente.
   */
  async function emitted(destination: ReadonlyArray<readonly [RegExp, ScriptedAnswer]>) {
    vi.mocked(gateway.authorize).mockClear();
    vi.mocked(process.stdout.write).mockClear();
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      ...destination,
      [/Qué exportás/, 'Servicios'],
      [/moneda/, 'Pesos'],
      ...singleExportItem('100'),
      [/Forma de pago/, ''],
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'Sí, emitir ahora'],
    ]);

    await runExportFlow(createSession({ exportacion: { actividad: 620100 } }));

    // La linea del comando, dentro del panel "Esto equivale a:".
    const command = /arcli fe [^\n│]*/.exec(printed())?.[0].trim();
    const sent = vi.mocked(gateway.authorize).mock.calls[0]?.[0];

    expect(script.remaining()).toBe(0);

    return { command, sent };
  }

  // Criterio 7: lo de hoy, que tiene que seguir igual con la lista.
  it('el país por nombre, en mayúsculas o minúsculas, o por código de ARCA, manda lo mismo a ARCA y arma el mismo comando', async () => {
    const byName = await emitted([
      [/País de destino/, 'ESTADOS UNIDOS'],
      [/ID impositivo/, ''],
    ]);

    expect(byName.sent).toMatchObject({ Dst_cmp: 212 });
    expect(byName.command).toBe(
      "arcli fe -m 100 --cliente 'ACME LLC' --domicilio-cliente '123 Main St' --pais-destino 'ESTADOS UNIDOS' --actividad 620100 --moneda PES --testing --emitir",
    );

    for (const typed of ['estados unidos', '212']) {
      expect(
        await emitted([
          [/País de destino/, typed],
          [/ID impositivo/, ''],
        ]),
        typed,
      ).toEqual(byName);
    }
  });

  // Criterio 7.
  it('escribir "estados" deja ESTADOS UNIDOS en la lista y Enter la elige: lo mismo que escribirlo entero', async () => {
    const byName = await emitted([
      [/País de destino/, 'ESTADOS UNIDOS'],
      [/ID impositivo/, ''],
    ]);
    const partial = await emitted([
      [/País de destino/, 'estados'],
      [/ID impositivo/, ''],
    ]);

    expect(partial).toEqual(byName);
  });

  // Criterio 7: código y nombre, con el código como palabra clave y el encabezado de las tablas de ARCA.
  it('la lista del país muestra el código y el nombre de la tabla de ARCA, con encabezado CÓDIGO y PAÍS', async () => {
    await emitted([
      [/País de destino/, '212'],
      [/ID impositivo/, ''],
    ]);

    const [, rows, options] =
      script.chooseOrTypeStep.mock.calls.find(([message]) => /País de destino/.test(message)) ?? [];

    expect(rows?.map((row) => row.label.replace(/\s+/g, ' ').trim())).toEqual(
      expect.arrayContaining(['212 ESTADOS UNIDOS']),
    );
    expect(options?.header).toMatch(/CÓDIGO\s+PAÍS/);
  });

  // Criterio 8: sin CUIT publicado para el destino, cualquiera de la tabla vale (`resolveExportClientCountryCuit`).
  it('sin CUIT para el destino, la lista trae los CUIT de la tabla y escribir parte del país lo elige, sin otra lista', async () => {
    vi.spyOn(gateway, 'getDestinationCountries').mockResolvedValue([{ code: 999, name: 'ATLANTIDA' }]);
    vi.spyOn(gateway, 'getDestinationCountryCuits').mockResolvedValue([
      { countryName: 'ESTADOS UNIDOS - Persona Jurídica', cuit: 55000002126 },
      { countryName: 'OTROS PAISES - Persona Jurídica', cuit: 55000009999 },
    ]);

    const { command } = await emitted([
      [/País de destino/, 'atlantida'],
      [/ARCA no tiene un CUIT publicado para ATLANTIDA/, 'otros'],
      [/ID impositivo/, ''],
    ]);
    const [, rows] =
      script.chooseOrTypeStep.mock.calls.find(([message]) => /ARCA no tiene un CUIT publicado/.test(message)) ?? [];

    expect(new Set(rows?.map((row) => row.value))).toEqual(new Set([55000002126, 55000009999]));
    expect(command).toContain('--pais-destino ATLANTIDA --cuit-pais 55000009999');
  });

  // Criterio 8: lo de hoy. Un número que no está en la tabla da el error de `--cuit-pais`, y Enter vacío deja la E
  // con el ID impositivo.
  it('sin CUIT para el destino, un número que no está en la tabla da el error de `--cuit-pais` y vacío pide el ID impositivo', async () => {
    vi.spyOn(gateway, 'getDestinationCountries').mockResolvedValue([{ code: 999, name: 'ATLANTIDA' }]);

    const { command } = await emitted([
      [/País de destino/, 'atlantida'],
      [
        /ARCA no tiene un CUIT publicado para ATLANTIDA/,
        rejecting('', ['55000000000', /^El CUIT de país 55000000000 no existe en la tabla de ARCA\.$/]),
      ],
      [/ID impositivo del cliente en su país \(sin CUIT del país, ARCA lo pide\)/, 'IE1234567T'],
    ]);

    expect(command).toContain('--pais-destino ATLANTIDA --id-impositivo IE1234567T');
    expect(command).not.toContain('--cuit-pais');
  });

  // Criterio 11: lo de hoy (obligatorio y en mayúsculas) lo fija "sin tabla de incoterms…"; esto, que sea el mismo
  // componente con la lista vacía.
  it('sin tabla de incoterms, el incoterm se pregunta con la lista vacía: obligatorio y en mayúsculas', async () => {
    vi.spyOn(gateway, 'getIncoterms').mockResolvedValue([]);
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, '212'],
      [/ID impositivo/, ''],
      [/Qué exportás/, 'Bienes'],
      [/moneda/, 'Pesos'],
      ...singleExportItem('100'),
      [/Incoterm \(ARCA no devolvió la lista\)/, rejecting('fob', ['', /obligatorio/])],
      [/Permisos de embarque/, ''],
      [/Forma de pago/, ''],
      [/Actividad de WSFEX/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'No, dejar sin emitir'],
    ]);

    await runExportFlow(createSession());

    const incoterm = script.chooseOrTypeStep.mock.calls.find(([message]) => /Incoterm/.test(message));

    expect(incoterm?.[1]).toEqual([]);
    expect(printed()).toContain('--incoterm FOB');
  });
});
