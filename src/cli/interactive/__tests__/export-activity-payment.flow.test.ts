import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import type { ExportGateway, ExportIssuedVoucher, ExportVoucherPayload } from '../../../modules/export/export.types';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import type { IFEXAuthorizeOutput } from '../../../services/arca/arca-sdk.types';
import { stripAnsi } from '../../../ui';
import { runExportFlow } from '../export.flow';
import { runExportRepeatFlow } from '../export-repeat.flow';
import type { Choice } from '../prompts';
import type { InteractiveSession } from '../session';

import { createScript, KEEP_EXPORT_ITEMS, rejecting, type ScriptedAnswer, singleExportItem } from './script';

/**
 * TUI-25 y TUI-26: la actividad de WSFEX y la forma de pago de la factura E, de "Emitir factura E" y de "Repetir" E. Las
 * notas E no las preguntan: las copian del asociado (`export.notes.ts`).
 */

let script = createScript([]);
const savedConfig = vi.fn();

/** La 1 del punto de venta 4: una E de servicios en dólares, sin actividad, cobrada con carta de crédito. */
const SERVICES: ExportIssuedVoucher = {
  activities: [],
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
  exportType: 2,
  incoterm: undefined,
  items: [{ description: 'Consultoría', discount: 0, quantity: 1, total: 1500, unit: 7, unitPrice: 1500 }],
  number: 1,
  paymentTerms: 'Carta de crédito',
  pointOfSale: 4,
  result: 'A',
  sameCurrency: true,
  total: 1500,
};

const gateway: ExportGateway = {
  // ARCA autoriza el número pedido.
  authorize: vi.fn(async (payload: ExportVoucherPayload): Promise<IFEXAuthorizeOutput> => ({
    FEXAuthorizeResult: {
      FEXErr: { ErrCode: 0, ErrMsg: 'OK' },
      FEXEvents: { EventCode: 0, EventMsg: '' },
      FEXResultAuth: {
        Cae: '76123456789012',
        Cbte_nro: payload.Cbte_nro,
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
  getActivities: async () => [],
  getCurrencies: async () => [{ code: 'DOL', name: 'Dólar Estadounidense' }],
  getDestinationCountries: async () => [{ code: 212, name: 'ESTADOS UNIDOS' }],
  getDestinationCountryCuits: async () => [{ countryName: 'ESTADOS UNIDOS - Persona Jurídica', cuit: 55000002126 }],
  getIncoterms: async () => [{ code: 'FOB', name: 'FOB' }],
  getLanguages: async () => [],
  getLastRequestId: async () => 0,
  getLastVoucherNumber: async () => 1,
  getQuotations: async () => [{ code: 'DOL', date: '20261114', rate: 1450.25 }],
  getUnits: async () => [{ id: 7, name: 'unidades' }],
  getVoucher: async (query) => (query.number === 1 && query.pointOfSale === 4 ? SERVICES : null),
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
  chooseOne: <T>(message: string, choices: ReadonlyArray<Choice<T>>) => script.chooseStep(message, choices),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  chooseStepWhileLoading: (...args: Parameters<typeof script.chooseStepWhileLoading>) =>
    script.chooseStepWhileLoading(...args),
  confirm: (message: string, yesLabel: string, noLabel = 'No') =>
    script.chooseStep(message, [
      { name: yesLabel, value: true },
      { name: noLabel, value: false },
    ]),
  editRowsStep: (...args: Parameters<typeof script.editRowsStep>) => script.editRowsStep(...args),
  eraseLastAnswer: () => undefined,
  fitPageSize: () => 12,
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

/**
 * TUI-25 y TUI-26: la actividad de WSFEX y la forma de pago, de una lista donde también se escribe (`chooseOrTypeStep`).
 * Lo que hoy funciona (el código escrito entero, el error de un código fuera de la tabla, la forma de pago por defecto o
 * escrita) va en tests normales: con la lista tiene que dar el mismo pedido a ARCA y el mismo comando.
 */
describe('runExportFlow: la actividad y la forma de pago de una lista donde también se escribe (TUI-25, TUI-26)', () => {
  const ACTIVITIES = [
    { id: 620100, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA' },
    { id: 471100, name: 'VENTA AL POR MENOR EN HIPERMERCADOS' },
  ];

  /** El comando de la E de `emitted` con la actividad 620100 y la forma de pago por defecto. */
  const COMMAND_WITH_ACTIVITY =
    "arcli fe -m 100 --cliente 'ACME LLC' --domicilio-cliente '123 Main St' --pais-destino 'ESTADOS UNIDOS' --actividad 620100 --moneda PES --testing --emitir";

  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(gateway, 'getActivities').mockResolvedValue(ACTIVITIES);
    vi.mocked(gateway.authorize).mockClear();
    savedConfig.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  /**
   * Emite una E de servicios en pesos, sin actividad en la config, con las respuestas de la forma de pago y la actividad
   * (y "No" a guardar la actividad, si se informa una), y devuelve lo que fue a ARCA y el comando equivalente.
   */
  async function emitted(paymentAndActivity: ReadonlyArray<readonly [RegExp, ScriptedAnswer]>, withActivity = true) {
    vi.mocked(gateway.authorize).mockClear();
    vi.mocked(process.stdout.write).mockClear();
    script = createScript([
      [/cliente del exterior/, 'ACME LLC'],
      [/Domicilio/, '123 Main St'],
      [/País de destino/, '212'],
      [/ID impositivo/, ''],
      [/Qué exportás/, 'Servicios'],
      [/moneda/, 'Pesos'],
      ...singleExportItem('100'),
      ...paymentAndActivity,
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'Sí, emitir ahora'],
      ...(withActivity ? [[/Guardamos la actividad/, 'No'] as const] : []),
    ]);

    await runExportFlow(createSession());

    // La linea del comando, dentro del panel "Esto equivale a:".
    const command = /arcli fe [^\n│]*/.exec(printed())?.[0].trim();
    const sent = vi.mocked(gateway.authorize).mock.calls[0]?.[0];

    expect(script.remaining()).toBe(0);

    return { command, sent };
  }

  /** La llamada a la lista de una pregunta, si la pregunta fue una lista. */
  function listCall(question: RegExp) {
    return script.chooseOrTypeStep.mock.calls.find(([message]) => question.test(message));
  }

  // Criterio 1: lo de hoy, que tiene que seguir igual con la lista.
  it('el código entero de la tabla manda la actividad a ARCA y la lleva al comando con `--actividad`', async () => {
    const { command, sent } = await emitted([
      [/Forma de pago/, ''],
      [/actividad/i, '620100'],
    ]);

    expect(sent).toMatchObject({ Actividades: { Actividad: [{ Id: 620100 }] } });
    expect(command).toBe(COMMAND_WITH_ACTIVITY);
  });

  // Criterio 1: lo de hoy. El mensaje es el de `exportActivityProblem`, con las de la misma familia.
  it('un código escrito que no está en la tabla da el mismo error que hoy y vuelve a preguntar', async () => {
    const { sent } = await emitted([
      [/Forma de pago/, ''],
      [
        /actividad/i,
        rejecting('620100', [
          '620900',
          /^La actividad 620900 no está en la tabla de actividades de WSFEX y ARCA la rechaza \(error 2105\)\. Las que empiezan con 620 son 620100\.$/,
        ]),
      ],
    ]);

    expect(sent).toMatchObject({ Actividades: { Actividad: [{ Id: 620100 }] } });
  });

  // Criterio 1.
  it('escribir "6201" deja la actividad de la tabla en la lista y Enter la elige: lo mismo que el código entero', async () => {
    const { command, sent } = await emitted([
      [/Forma de pago/, ''],
      [/actividad/i, '6201'],
    ]);

    expect(sent).toMatchObject({ Actividades: { Actividad: [{ Id: 620100 }] } });
    expect(command).toBe(COMMAND_WITH_ACTIVITY);
  });

  // Criterio 1.
  it('escribir parte de la descripción ("consultores") elige la actividad: lo mismo que el código entero', async () => {
    const { command, sent } = await emitted([
      [/Forma de pago/, ''],
      [/actividad/i, 'consultores'],
    ]);

    expect(sent).toMatchObject({ Actividades: { Actividad: [{ Id: 620100 }] } });
    expect(command).toBe(COMMAND_WITH_ACTIVITY);
  });

  // Criterio 1: las filas salen de la tabla de WSFEX, con el código y la descripción.
  it('la lista de la actividad muestra el código y la descripción de la tabla, con encabezado CÓDIGO y DESCRIPCIÓN', async () => {
    await emitted([
      [/Forma de pago/, ''],
      [/actividad/i, '620100'],
    ]);

    const [, rows, options] = listCall(/actividad/i) ?? [];

    expect(rows?.map((row) => stripAnsi(row.label).replace(/\s+/g, ' ').trim())).toEqual([
      '620100 SERVICIOS DE CONSULTORES EN INFORMATICA',
      '471100 VENTA AL POR MENOR EN HIPERMERCADOS',
    ]);
    expect(options?.header).toMatch(/CÓDIGO\s+DESCRIPCIÓN/);
  });

  // Criterio 1: opcional, con la fila de "sin actividad" marcada con el filtro vacío; Enter ahí la deja sin informar.
  it('con el filtro vacío, la fila "Sin actividad" deja la E sin el bloque Actividades y el comando sin `--actividad`', async () => {
    const { command, sent } = await emitted(
      [
        [/Forma de pago/, ''],
        [/actividad/i, ''],
      ],
      false,
    );
    const [, , options] = listCall(/actividad/i) ?? [];

    expect(options?.optional).toBe(true);
    expect(options?.emptyLabel).toMatch(/sin actividad/i);
    expect(sent).not.toHaveProperty('Actividades');
    expect(command).not.toContain('--actividad');
    expect(savedConfig).not.toHaveBeenCalled();
  });

  // Criterio 2: sin tabla, el mismo componente con la lista vacía es una pregunta de texto, como hoy (lo de hoy lo fija
  // "una actividad que no esta en la tabla de WSFEX se rechaza; sin tabla, cualquiera vale y avisa").
  it('con la tabla vacía se pregunta como texto: el código escrito va sin validar, con aviso', async () => {
    vi.mocked(gateway.getActivities).mockResolvedValue([]);

    const { command } = await emitted([
      [/Forma de pago/, ''],
      [/actividad/i, '999999'],
    ]);
    const [, rows, options] = listCall(/actividad/i) ?? [];

    expect(rows).toEqual([]);
    expect(options?.optional).toBe(true);
    expect(command).toContain('--actividad 999999');
    expect(printed()).toMatch(/tabla de actividades de WSFEX: 999999 va sin validar/);
  });

  // Criterio 3: lo de hoy. Con la forma de pago por defecto, ARCA la recibe y el comando no lleva `--forma-pago`.
  it('Enter en la forma de pago manda "Transferencia Internacional" y el comando va sin `--forma-pago`', async () => {
    const { command, sent } = await emitted([
      [/Forma de pago/, ''],
      [/actividad/i, '620100'],
    ]);

    expect(sent).toMatchObject({ Forma_pago: 'Transferencia Internacional' });
    expect(command).toBe(COMMAND_WITH_ACTIVITY);
  });

  // Criterio 3: lo de hoy. Escrita igual que la de por defecto, tampoco lleva `--forma-pago`.
  it('"Transferencia Internacional" escrita es la de por defecto: el comando va sin `--forma-pago`', async () => {
    const { command, sent } = await emitted([
      [/Forma de pago/, 'Transferencia Internacional'],
      [/actividad/i, '620100'],
    ]);

    expect(sent).toMatchObject({ Forma_pago: 'Transferencia Internacional' });
    expect(command).toBe(COMMAND_WITH_ACTIVITY);
  });

  // Criterio 3: lo de hoy. Un texto propio va tal cual a ARCA y al comando.
  it('una forma de pago escrita que no es una sugerencia va tal cual a ARCA y al comando con `--forma-pago`', async () => {
    const { command, sent } = await emitted([
      [/Forma de pago/, 'Según contrato 42'],
      [/actividad/i, '620100'],
    ]);

    expect(sent).toMatchObject({ Forma_pago: 'Según contrato 42' });
    expect(command).toBe(
      "arcli fe -m 100 --cliente 'ACME LLC' --domicilio-cliente '123 Main St' --pais-destino 'ESTADOS UNIDOS' --actividad 620100 --moneda PES --forma-pago 'Según contrato 42' --testing --emitir",
    );
  });

  // Criterio 3.
  it('la forma de pago es una lista de sugerencias que arranca en "Transferencia Internacional"', async () => {
    const { command, sent } = await emitted([
      [/Forma de pago/, ''],
      [/actividad/i, '620100'],
    ]);
    const [, rows, options] = listCall(/Forma de pago/) ?? [];

    expect(rows?.length ?? 0).toBeGreaterThan(1);
    expect(rows?.[0]?.value).toBe('Transferencia Internacional');
    // Arranca marcada: sin `previous`, la primera fila; con `previous`, la de por defecto.
    expect(options?.previous ?? rows?.[0]?.value).toBe('Transferencia Internacional');
    expect(sent).toMatchObject({ Forma_pago: 'Transferencia Internacional' });
    expect(command).toBe(COMMAND_WITH_ACTIVITY);
  });

  // Criterio 3.
  it('elegir otra sugerencia de la lista manda ese texto a ARCA y al comando con `--forma-pago`', async () => {
    await emitted([
      [/Forma de pago/, ''],
      [/actividad/i, '620100'],
    ]);

    const other = listCall(/Forma de pago/)?.[1][1];

    expect(other?.value).toEqual(expect.any(String));
    expect(other?.value).not.toBe('Transferencia Internacional');

    const { command, sent } = await emitted([
      [/Forma de pago/, stripAnsi(other?.label ?? '').trim()],
      [/actividad/i, '620100'],
    ]);

    expect(sent).toMatchObject({ Forma_pago: other?.value });
    expect(command).toMatch(/ --forma-pago /);
  });

  // Criterio 3: en la lista también se escribe, con la misma regla que `--forma-pago` (50 caracteres).
  it('en la lista de la forma de pago se escribe: más de 50 caracteres da el error y un texto propio vale', async () => {
    const { sent } = await emitted([
      [/Forma de pago/, rejecting('Según contrato 42', ['a'.repeat(51), /50 caracteres/])],
      [/actividad/i, '620100'],
    ]);

    expect(listCall(/Forma de pago/)).toBeDefined();
    expect(sent).toMatchObject({ Forma_pago: 'Según contrato 42' });
  });
});

/**
 * TUI-25 en "Repetir" E: la factura sin actividad y sin actividad en la config pregunta la misma lista que "Emitir
 * factura" E. La forma de pago no se pregunta: se copia de la factura (`copyExportInvoice`).
 */
describe('runExportRepeatFlow: la actividad de una lista donde también se escribe (TUI-25)', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(gateway, 'getActivities').mockResolvedValue([
      { id: 620100, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA' },
    ]);
    vi.mocked(gateway.authorize).mockClear();
    savedConfig.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  /** Repite la factura de servicios con `activity` como respuesta y devuelve lo que fue a ARCA y el comando. */
  async function repeatedWith(activity: string) {
    vi.mocked(gateway.authorize).mockClear();
    vi.mocked(process.stdout.write).mockClear();
    script = createScript([
      [/Cuál repetimos/, '00004-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [/actividad/i, activity],
      [/Fecha de pago/, ''],
      [/Agregamos algún opcional/, []],
      [/Emitimos/, 'Sí, emitir ahora'],
      [/Guardamos la actividad/, 'No'],
    ]);

    await runExportRepeatFlow(createSession(), 4);

    return {
      command: /arcli fe [^\n│]*/.exec(printed())?.[0].trim(),
      sent: vi.mocked(gateway.authorize).mock.calls[0]?.[0],
    };
  }

  // Criterio 1: lo de hoy. La forma de pago copiada va a ARCA aunque no se pregunte.
  it('el código escrito va a ARCA y al comando con `--actividad`, con la forma de pago de la factura', async () => {
    const { command, sent } = await repeatedWith('620100');

    expect(sent).toMatchObject({ Actividades: { Actividad: [{ Id: 620100 }] }, Forma_pago: 'Carta de crédito' });
    expect(command).toContain('--actividad 620100');
    expect(script.asked.some((message) => /Forma de pago/.test(message))).toBe(false);
  });

  // Criterio 1.
  it('elegir la actividad por parte de la descripción da lo mismo que escribir el código, y la fila "Sin actividad" está', async () => {
    const byCode = await repeatedWith('620100');
    const byDescription = await repeatedWith('consultores');
    const options = script.chooseOrTypeStep.mock.calls.find(([message]) => /actividad/i.test(message))?.[2];

    expect(byDescription).toEqual(byCode);
    expect(options?.optional).toBe(true);
    expect(options?.emptyLabel).toMatch(/sin actividad/i);
  });
});
