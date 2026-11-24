import { afterAll, afterEach, beforeAll, beforeEach, describe, it, vi } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import { runInvoiceFlow } from '../invoice.flow';
import { runNoteFlow } from '../note.flow';
import { runRepeatFlow } from '../repeat.flow';
import type { InteractiveSession } from '../session';

import { createScreens, expectScreens, recordFlow, withoutTerminal } from './screens';
import { createBillingSession, createExportGateway, NOW } from './screens.fixtures';
import { editing, type ScriptedAnswer } from './script';

/**
 * Golden de pantallas del asistente (NAV-0), por flujo: factura A, B y C, FCE, recibo, consumidor final, notas (sobre
 * una factura y por período), "Repetir" (en pesos y en moneda extranjera) y la E (factura, notas y "Repetir"). Cada
 * uno con el camino tipico, uno con Volver en el medio, uno con opcionales marcados y otro desmarcandolos. Fijan lo
 * que hace hoy el asistente antes del refactor del navegador: un cambio en una pregunta, una opcion, lo que arranca
 * marcado, la vista previa, el comando equivalente o la solicitud a ARCA aparece como diferencia y se justifica en el
 * PR. Mecanismo y como regenerarlos, en `screens.ts`.
 */

// Las fechas se calculan en hora local: la de Argentina, para que el golden sea el mismo en cualquier equipo o CI.
const originalTimeZone = process.env.TZ;

process.env.TZ = 'America/Argentina/Buenos_Aires';

let screens = createScreens([]);
const savedConfig = vi.fn();

// "(nuevo)" depende de la version: fija, para que el golden no cambie con cada release.
vi.mock('../../version', () => ({ CLI_VERSION: '2.6.0' }));

// El comando equivalente sale con las comillas de la shell del SO: POSIX fijo para que el CI en Windows espere lo mismo.
vi.mock('../../../lib/shell/shell-argument', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/shell/shell-argument')>();

  return { ...actual, formatShellCommand: (args: readonly string[]) => actual.formatShellCommand(args, 'linux') };
});

vi.mock('../../../modules/interactive/equivalent-command', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/interactive/equivalent-command')>();

  return {
    ...actual,
    buildEquivalentCommand: (...args: Parameters<typeof actual.buildEquivalentCommand>) => {
      const command = actual.buildEquivalentCommand(...args);

      screens.section('comando equivalente', command);

      return command;
    },
  };
});

vi.mock('../../../modules/interactive/export-equivalent-command', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/interactive/export-equivalent-command')>();

  return {
    ...actual,
    buildExportEquivalentCommand: (...args: Parameters<typeof actual.buildExportEquivalentCommand>) => {
      const command = actual.buildExportEquivalentCommand(...args);

      screens.section('comando equivalente', command);

      return command;
    },
  };
});

vi.mock('../prompts', () => ({
  askText: async () => '',
  askTextStep: (...args: Parameters<typeof screens.prompts.askTextStep>) => screens.prompts.askTextStep(...args),
  chooseFromFilterList: (...args: Parameters<typeof screens.prompts.chooseFromFilterList>) =>
    screens.prompts.chooseFromFilterList(...args),
  chooseManyStep: (...args: Parameters<typeof screens.prompts.chooseManyStep>) =>
    screens.prompts.chooseManyStep(...args),
  chooseOrTypeStep: (...args: Parameters<typeof screens.prompts.chooseOrTypeStep>) =>
    screens.prompts.chooseOrTypeStep(...args),
  chooseOne: (...args: Parameters<typeof screens.prompts.chooseOne>) => screens.prompts.chooseOne(...args),
  chooseStep: (...args: Parameters<typeof screens.prompts.chooseStep>) => screens.prompts.chooseStep(...args),
  chooseStepWhileLoading: (...args: Parameters<typeof screens.prompts.chooseStepWhileLoading>) =>
    screens.prompts.chooseStepWhileLoading(...args),
  confirm: (...args: Parameters<typeof screens.prompts.confirm>) => screens.prompts.confirm(...args),
  editRowsStep: (...args: Parameters<typeof screens.prompts.editRowsStep>) => screens.prompts.editRowsStep(...args),
  eraseLastAnswer: () => undefined,
  fitPageSize: () => 12,
  isPromptCancellation: () => false,
}));

const exportGateway = createExportGateway();

vi.mock('../../../services/arca/arca-client.factory', () => ({
  ArcaClientFactory: class {
    public createExportGateway() {
      return exportGateway;
    }
  },
}));

vi.mock('../../../modules/config/config.service', () => ({
  ConfigService: class {
    public close() {}
    public changeValues({ set }: { set: ReadonlyArray<readonly [string, string]> }) {
      set.forEach(([key, value]) => savedConfig(key, value));
    }
  },
}));

type Steps = ReadonlyArray<readonly [RegExp, ScriptedAnswer]>;

const NO_EMIT = [/Emitimos/, 'No, dejar sin emitir'] as const;

interface GoldenOptions {
  readonly config?: Record<string, unknown>;
  /** El flujo; por defecto, "Emitir factura". */
  readonly run?: (session: InteractiveSession) => Promise<unknown>;
}

async function golden(name: string, steps: Steps, options: GoldenOptions = {}) {
  const run = options.run ?? ((session: InteractiveSession) => runInvoiceFlow(session));

  screens = createScreens(steps);
  await recordFlow(screens, () => run(createBillingSession(options.config)));
  await expectScreens(screens, name);
}

const receipt = { run: (session: InteractiveSession) => runInvoiceFlow(session, true) };
const creditNote = { run: (session: InteractiveSession) => runNoteFlow(session, 'credito') };
const debitNote = { run: (session: InteractiveSession) => runNoteFlow(session, 'debito') };
const repeat = { run: runRepeatFlow };

let restoreTerminal: () => void;

beforeAll(() => {
  restoreTerminal = withoutTerminal();
});

afterAll(() => {
  restoreTerminal();

  if (originalTimeZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimeZone;
  }
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  savedConfig.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

const facturaC = [
  [/comprobante/, 'Factura C'],
  [/A quién/, 'Consumidor final'],
  [/Qué estás facturando/, 'Servicios'],
] as const;

describe('golden de pantallas: factura C', () => {
  it('camino tipico: consumidor final, servicios, sin opcionales', () =>
    golden('factura-c/tipico', [...facturaC, [/Monto total/, '1.500'], [/Agregamos/, []], NO_EMIT]));

  it('con Volver en el medio: del monto al concepto, cambia a productos', () =>
    golden('factura-c/volver', [
      ...facturaC,
      [/Monto total/, BACK],
      [/Qué estás facturando/, 'Productos'],
      [/Monto total/, '2.000,50'],
      [/Agregamos/, BACK],
      [/Monto total/, '2.000,50'],
      [/Agregamos/, []],
      NO_EMIT,
    ]));

  it('con opcionales marcados: fecha, período del servicio y vencimiento', () =>
    golden('factura-c/opcionales-marcados', [
      ...facturaC,
      [/Monto total/, '1.500'],
      [/Agregamos/, ['Fecha del comprobante', 'Período del servicio', 'Vencimiento del pago']],
      [/Fecha del comprobante/, '15/11/2026'],
      [/Servicio desde/, '01/11/2026'],
      [/Servicio hasta/, '15/11/2026'],
      [/Vencimiento del pago/, '30/11/2026'],
      NO_EMIT,
    ]));

  it('con opcionales desmarcados: responde la fecha, vuelve a la selección y desmarca todo', () =>
    golden('factura-c/opcionales-desmarcados', [
      ...facturaC,
      [/Monto total/, '1.500'],
      [/Agregamos/, ['Fecha del comprobante', 'Período del servicio']],
      [/Fecha del comprobante/, '15/11/2026'],
      [/Servicio desde/, BACK],
      [/Fecha del comprobante/, BACK],
      [/Agregamos/, []],
      NO_EMIT,
    ]));
});

const facturaB = [
  [/comprobante/, 'Factura B'],
  [/A quién/, 'Con DNI'],
  [/DNI del receptor/, '30.123.456'],
  [/Condición frente al IVA/, 'Consumidor final'],
  [/Qué estás facturando/, 'Productos'],
] as const;

describe('golden de pantallas: factura B', () => {
  it('camino tipico: a un DNI, productos, sin opcionales', () =>
    golden('factura-b/tipico', [...facturaB, [/Monto total/, '12.100'], [/Agregamos/, []], NO_EMIT]));

  it('con Volver en el medio: de la condición IVA al documento, cambia a consumidor final', () =>
    golden('factura-b/volver', [
      [/comprobante/, 'Factura B'],
      [/A quién/, 'Con DNI'],
      [/DNI del receptor/, '30.123.456'],
      [/Condición frente al IVA/, BACK],
      [/DNI del receptor/, BACK],
      [/A quién/, 'Consumidor final'],
      [/Qué estás facturando/, 'Productos'],
      [/Monto total/, '12.100'],
      [/Agregamos/, []],
      NO_EMIT,
    ]));

  it('con opcionales marcados: alícuota, exento y no gravado', () =>
    golden('factura-b/opcionales-marcados', [
      ...facturaB,
      [/Monto total/, '12.100'],
      [/Agregamos/, ['Alícuota de IVA', 'Importe exento o no gravado']],
      [/Alícuota de IVA/, '10,5%'],
      [/Parte exenta/, '1.000'],
      [/Parte no gravada/, '500'],
      NO_EMIT,
    ]));

  it('con opcionales desmarcados: responde la alícuota y el exento, vuelve y desmarca todo', () =>
    golden('factura-b/opcionales-desmarcados', [
      ...facturaB,
      [/Monto total/, '12.100'],
      [/Agregamos/, ['Alícuota de IVA', 'Importe exento o no gravado']],
      [/Alícuota de IVA/, '10,5%'],
      [/Parte exenta/, '1.000'],
      [/Parte no gravada/, BACK],
      [/Parte exenta/, BACK],
      [/Alícuota de IVA/, BACK],
      [/Agregamos/, []],
      NO_EMIT,
    ]));
});

const facturaA = [
  [/comprobante/, 'Factura A'],
  [/A quién/, 'Con CUIT'],
  [/CUIT del receptor/, '30-70996581-2'],
  [/Condición frente al IVA/, 'Responsable inscripto'],
  [/Qué estás facturando/, 'Productos y servicios'],
] as const;

describe('golden de pantallas: factura A', () => {
  it('camino tipico: a un CUIT responsable inscripto, sin opcionales', () =>
    golden('factura-a/tipico', [...facturaA, [/Monto total/, '1.210'], [/Agregamos/, []], NO_EMIT]));

  it('con Volver en el medio: desde los opcionales hasta el CUIT, que arranca escrito', () =>
    golden('factura-a/volver', [
      ...facturaA,
      [/Monto total/, '1.210'],
      [/Agregamos/, BACK],
      [/Monto total/, BACK],
      [/Qué estás facturando/, BACK],
      [/Condición frente al IVA/, BACK],
      [/CUIT del receptor/, '20-20179706-4'],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/Qué estás facturando/, 'Productos y servicios'],
      [/Monto total/, '1.210'],
      [/Agregamos/, []],
      NO_EMIT,
    ]));

  it('con opcionales marcados: fecha y moneda extranjera cobrada en pesos con cotización', () =>
    golden('factura-a/opcionales-marcados', [
      ...facturaA,
      [/Monto total/, '1.000'],
      [/Agregamos/, ['Moneda extranjera', 'Fecha del comprobante']],
      [/Fecha del comprobante/, '17/11/2026'],
      [/Moneda del comprobante/, 'Dólar'],
      [/Cómo te pagan/, 'En pesos'],
      [/Cotización de USD/, '1.420,50'],
      // El monto se escribio en pesos: vuelve a pedirlo en dólares (REV-74, #12).
      [/Monto total en USD/, '1.000'],
      [/Agregamos/, ['Moneda extranjera', 'Fecha del comprobante']],
      [/Fecha del comprobante/, '17/11/2026'],
      [/Moneda del comprobante/, 'Dólar'],
      [/Cómo te pagan/, 'En pesos'],
      [/Cotización de USD/, '1.420,50'],
      NO_EMIT,
    ]));

  it('con opcionales desmarcados: elige dólares, vuelve y desmarca la moneda', () =>
    golden('factura-a/opcionales-desmarcados', [
      ...facturaA,
      [/Monto total/, '1.000'],
      [/Agregamos/, ['Moneda extranjera']],
      [/Moneda del comprobante/, 'Dólar'],
      [/Cómo te pagan/, BACK],
      [/Moneda del comprobante/, BACK],
      [/Agregamos/, []],
      NO_EMIT,
    ]));
});

const fceA = [
  [/comprobante/, 'Factura de crédito electrónica A'],
  [/A quién/, 'Con CUIT'],
  [/CUIT del receptor/, '30-70996581-2'],
  [/Condición frente al IVA/, 'Responsable inscripto'],
  [/Qué estás facturando/, 'Servicios'],
  [/Monto total/, '6.050.000'],
  [/CBU del emisor/, '0170099220000067797370'],
  [/Alias del CBU/, 'emisor.prueba.cbu'],
] as const;

describe('golden de pantallas: FCE', () => {
  it('camino tipico: FCE A con CBU y alias escritos, sin opcionales', () =>
    golden('fce/tipico', [...fceA, [/Agregamos/, []], NO_EMIT]));

  it('con Volver en el medio: del alias al CBU, que arranca escrito', () =>
    golden('fce/volver', [
      ...fceA.slice(0, 7),
      [/Alias del CBU/, BACK],
      [/CBU del emisor/, '0170099220000067797370'],
      [/Alias del CBU/, ''],
      [/Agregamos/, []],
      NO_EMIT,
    ]));

  it('con opcionales marcados: vencimiento y modalidad de transferencia', () =>
    golden('fce/opcionales-marcados', [
      ...fceA,
      [/Agregamos/, ['Vencimiento del pago', 'Modalidad de transferencia']],
      [/Vencimiento del pago/, '18/12/2026'],
      [/Modalidad de transferencia/, 'Agente de depósito colectivo'],
      NO_EMIT,
    ]));

  it('con opcionales desmarcados: responde el vencimiento, vuelve y lo desmarca', () =>
    golden('fce/opcionales-desmarcados', [
      ...fceA,
      [/Agregamos/, ['Vencimiento del pago', 'Modalidad de transferencia']],
      [/Vencimiento del pago/, '18/12/2026'],
      [/Modalidad de transferencia/, BACK],
      [/Vencimiento del pago/, BACK],
      [/Agregamos/, ['Modalidad de transferencia']],
      [/Modalidad de transferencia/, 'Agente de depósito colectivo'],
      NO_EMIT,
    ]));

  it('con el CBU en la config no lo pregunta ni ofrece guardarlo', () =>
    golden('fce/cbu-en-config', [...fceA.slice(0, 6), [/Agregamos/, []], NO_EMIT], {
      config: { aliasCbu: 'emisor.prueba.cbu', cbu: '0170099220000067797370' },
    }));
});

const reciboC = [
  [/Qué recibo/, 'Recibo C'],
  [/A quién le hacés el recibo/, 'Consumidor final'],
  [/Qué estás cobrando/, 'Servicios'],
] as const;

describe('golden de pantallas: recibo', () => {
  it('camino tipico: recibo C a consumidor final', () =>
    golden('recibo/tipico', [...reciboC, [/Monto total/, '2.500'], [/Agregamos/, []], NO_EMIT], receipt));

  it('con Volver en el medio: desde el monto hasta el selector, cambia a recibo B', () =>
    golden(
      'recibo/volver',
      [
        ...reciboC,
        [/Monto total/, BACK],
        [/Qué estás cobrando/, BACK],
        [/A quién le hacés el recibo/, BACK],
        [/Qué recibo/, 'Recibo B'],
        [/A quién le hacés el recibo/, 'Consumidor final'],
        [/Qué estás cobrando/, 'Servicios'],
        [/Monto total/, '2.500'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      receipt,
    ));

  it('con opcionales marcados: fecha y período del servicio', () =>
    golden(
      'recibo/opcionales-marcados',
      [
        ...reciboC,
        [/Monto total/, '2.500'],
        [/Agregamos/, ['Fecha del comprobante', 'Período del servicio']],
        [/Fecha del comprobante/, '16/11/2026'],
        [/Servicio desde/, '01/10/2026'],
        [/Servicio hasta/, '31/10/2026'],
        NO_EMIT,
      ],
      receipt,
    ));

  it('con opcionales desmarcados: responde el período, vuelve y lo desmarca', () =>
    golden(
      'recibo/opcionales-desmarcados',
      [
        ...reciboC,
        [/Monto total/, '2.500'],
        [/Agregamos/, ['Período del servicio']],
        [/Servicio desde/, '01/10/2026'],
        [/Servicio hasta/, BACK],
        [/Servicio desde/, BACK],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      receipt,
    ));
});

const consumerB = [
  [/comprobante/, 'Factura B'],
  [/A quién/, 'Consumidor final'],
  [/Qué estás facturando/, 'Servicios'],
  [/Monto total/, '50.000'],
] as const;

describe('golden de pantallas: consumidor final', () => {
  it('sin identificar: factura B a consumidor final', () =>
    golden('consumidor-final/sin-identificar', [...consumerB, [/Agregamos/, []], NO_EMIT]));

  it('con datos: el opcional "Datos del consumidor final" con su DNI', () =>
    golden('consumidor-final/con-datos', [
      ...consumerB,
      [/Agregamos/, ['Datos del consumidor final']],
      [/Documento del consumidor final/, 'DNI'],
      [/DNI del consumidor final/, '30.123.456'],
      NO_EMIT,
    ]));

  it('con datos desmarcados: responde el documento, vuelve y lo desmarca', () =>
    golden('consumidor-final/con-datos-desmarcados', [
      ...consumerB,
      [/Agregamos/, ['Datos del consumidor final']],
      [/Documento del consumidor final/, 'DNI'],
      [/DNI del consumidor final/, BACK],
      [/Documento del consumidor final/, BACK],
      [/Agregamos/, []],
      NO_EMIT,
    ]));

  it('desde el tope de RG 5700 el documento es obligatorio, y Volver vuelve al monto', () =>
    golden('consumidor-final/tope', [
      [/comprobante/, 'Factura C'],
      [/A quién/, 'Consumidor final'],
      [/Qué estás facturando/, 'Servicios'],
      [/Monto total/, '10.000.000'],
      [/Documento del consumidor final/, BACK],
      [/Monto total/, '12.000.000'],
      [/Documento del consumidor final/, 'CUIL'],
      [/CUIL del consumidor final/, '20-30123456-3'],
      [/Agregamos/, []],
      NO_EMIT,
    ]));
});

const ncSobreFacturaC = [
  [/Sobre qué comprobante/, 'Facturas'],
  [/Qué factura\?/, 'Factura C'],
  [/A qué la asociamos/, 'A una factura'],
  [/Sobre qué factura C/, '00003-00000014'],
] as const;

describe('golden de pantallas: nota de crédito', () => {
  it('camino tipico: NC C parcial sobre una factura de la lista', () =>
    golden(
      'nota-credito/tipico',
      [
        ...ncSobreFacturaC,
        [/Total o parcial/, 'Parcial'],
        [/Monto de la nota de crédito/, '50.000'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      creditNote,
    ));

  it('con Volver en el medio: del monto a la lista, anula el total', () =>
    golden(
      'nota-credito/volver',
      [
        ...ncSobreFacturaC,
        [/Total o parcial/, 'Parcial'],
        [/Monto de la nota de crédito/, BACK],
        [/Total o parcial/, BACK],
        [/Sobre qué factura C/, '00003-00000014'],
        [/Total o parcial/, 'Anular el total'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      creditNote,
    ));

  it('con opcionales marcados: fecha y período del servicio', () =>
    golden(
      'nota-credito/opcionales-marcados',
      [
        ...ncSobreFacturaC,
        [/Total o parcial/, 'Parcial'],
        [/Monto de la nota de crédito/, '50.000'],
        [/Agregamos/, ['Fecha del comprobante', 'Período del servicio']],
        [/Fecha del comprobante/, '17/11/2026'],
        [/Servicio desde/, '01/11/2026'],
        [/Servicio hasta/, '10/11/2026'],
        NO_EMIT,
      ],
      creditNote,
    ));

  it('con opcionales desmarcados: responde la fecha, vuelve y la desmarca', () =>
    golden(
      'nota-credito/opcionales-desmarcados',
      [
        ...ncSobreFacturaC,
        [/Total o parcial/, 'Parcial'],
        [/Monto de la nota de crédito/, '50.000'],
        [/Agregamos/, ['Fecha del comprobante', 'Vencimiento del pago']],
        [/Fecha del comprobante/, '17/11/2026'],
        [/Vencimiento del pago/, BACK],
        [/Fecha del comprobante/, BACK],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      creditNote,
    ));

  it('NC FCE A sobre la FCE: pregunta si el comprador la rechazó', () =>
    golden(
      'nota-credito/fce',
      [
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura de crédito electrónica A'],
        [/Sobre qué factura de crédito electrónica A/, '00003-00000002'],
        [/Total o parcial/, 'Parcial'],
        [/Monto de la nota de crédito/, '1.210.000'],
        [/Condición frente al IVA/, 'Responsable inscripto'],
        [/comprador rechazó/, 'No'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      creditNote,
    ));
});

const ndSobreFacturaB = [
  [/Sobre qué comprobante/, 'Facturas'],
  [/Qué factura\?/, 'Factura B'],
  [/A qué la asociamos/, 'A una factura'],
  [/Sobre qué factura B/, '00003-00000021'],
] as const;

describe('golden de pantallas: nota de débito', () => {
  it('camino tipico: ND B sobre una factura de la lista, con la alícuota deducida', () =>
    golden(
      'nota-debito/tipico',
      [...ndSobreFacturaB, [/Monto de la nota de débito/, '60,50'], [/Agregamos/, []], NO_EMIT],
      debitNote,
    ));

  it('con Volver en el medio: de los opcionales a la lista, elige otra vez la misma', () =>
    golden(
      'nota-debito/volver',
      [
        ...ndSobreFacturaB,
        [/Monto de la nota de débito/, '60,50'],
        [/Agregamos/, BACK],
        [/Monto de la nota de débito/, BACK],
        [/Sobre qué factura B/, '00003-00000021'],
        [/Monto de la nota de débito/, '60,50'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      debitNote,
    ));

  it('con opcionales marcados: exento y no gravado', () =>
    golden(
      'nota-debito/opcionales-marcados',
      [
        ...ndSobreFacturaB,
        [/Monto de la nota de débito/, '60,50'],
        [/Agregamos/, ['Importe exento o no gravado']],
        [/Parte exenta/, '10'],
        [/Parte no gravada/, ''],
        NO_EMIT,
      ],
      debitNote,
    ));

  it('con opcionales desmarcados: responde el exento, vuelve y lo desmarca', () =>
    golden(
      'nota-debito/opcionales-desmarcados',
      [
        ...ndSobreFacturaB,
        [/Monto de la nota de débito/, '60,50'],
        [/Agregamos/, ['Importe exento o no gravado']],
        [/Parte exenta/, '10'],
        [/Parte no gravada/, BACK],
        [/Parte exenta/, BACK],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      debitNote,
    ));
});

const ncPorPeriodo = [
  [/Sobre qué comprobante/, 'Facturas'],
  [/Qué factura\?/, 'Factura C'],
  [/A qué la asociamos/, 'A un período'],
  [/Período desde/, '01/10/2026'],
  [/Período hasta/, '31/10/2026'],
  [/A quién va la nota/, 'Consumidor final'],
  [/Qué concepto ajusta la nota/, 'Servicios'],
  [/Monto de la nota de crédito/, '1.000'],
] as const;

describe('golden de pantallas: nota por período', () => {
  it('camino tipico: NC C por el mes pasado a consumidor final', () =>
    golden('nota-periodo/tipico', [...ncPorPeriodo, [/Agregamos/, []], NO_EMIT], creditNote));

  it('con Volver en el medio: del receptor al período, que arranca escrito', () =>
    golden(
      'nota-periodo/volver',
      [
        ...ncPorPeriodo.slice(0, 5),
        [/A quién va la nota/, BACK],
        [/Período hasta/, '15/10/2026'],
        ...ncPorPeriodo.slice(5),
        [/Agregamos/, []],
        NO_EMIT,
      ],
      creditNote,
    ));

  it('con opcionales marcados: moneda extranjera cobrada en dólares', () =>
    golden(
      'nota-periodo/opcionales-marcados',
      [
        ...ncPorPeriodo,
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, 'Dólar'],
        [/Cómo te pagan/, 'En dólares'],
        // El monto se escribio en pesos: vuelve a pedirlo en dólares (REV-74, #12).
        [/Monto de la nota de crédito en USD/, '1.000'],
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, 'Dólar'],
        [/Cómo te pagan/, 'En dólares'],
        NO_EMIT,
      ],
      creditNote,
    ));

  it('con opcionales desmarcados: elige la moneda, vuelve y la desmarca', () =>
    golden(
      'nota-periodo/opcionales-desmarcados',
      [
        ...ncPorPeriodo,
        [/Agregamos/, ['Moneda extranjera']],
        [/Moneda del comprobante/, 'Dólar'],
        [/Cómo te pagan/, BACK],
        [/Moneda del comprobante/, BACK],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      creditNote,
    ));
});

const repetirC = [
  [/Qué comprobante querés repetir/, 'Factura C'],
  [/Cuál repetimos/, '00003-00000014'],
] as const;

describe('golden de pantallas: Repetir en pesos', () => {
  it('camino tipico: la factura C con el mismo monto y este mes', () =>
    golden(
      'repetir-pesos/tipico',
      [...repetirC, [/Mismo monto/, 'Sí'], [/Período del servicio/, 'Este mes'], [/Agregamos/, []], NO_EMIT],
      repeat,
    ));

  it('con Volver en el medio: otro monto, vuelve al mismo y escribe otro período', () =>
    golden(
      'repetir-pesos/volver',
      [
        ...repetirC,
        [/Mismo monto/, 'No'],
        [/Monto total/, BACK],
        [/Mismo monto/, 'Sí'],
        [/Período del servicio/, 'Otro período'],
        [/Servicio desde/, '01/11/2026'],
        [/Servicio hasta/, BACK],
        [/Servicio desde/, BACK],
        [/Período del servicio/, 'El mes pasado'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      repeat,
    ));

  it('con opcionales marcados: fecha y vencimiento', () =>
    golden(
      'repetir-pesos/opcionales-marcados',
      [
        ...repetirC,
        [/Mismo monto/, 'Sí'],
        [/Período del servicio/, 'Un solo día'],
        [/Agregamos/, ['Fecha del comprobante', 'Vencimiento del pago']],
        [/Fecha del comprobante/, '16/11/2026'],
        [/Vencimiento del pago/, '26/11/2026'],
        NO_EMIT,
      ],
      repeat,
    ));

  it('con opcionales desmarcados: responde el vencimiento, vuelve y lo desmarca', () =>
    golden(
      'repetir-pesos/opcionales-desmarcados',
      [
        ...repetirC,
        [/Mismo monto/, 'Sí'],
        [/Período del servicio/, 'Este mes'],
        [/Agregamos/, ['Fecha del comprobante', 'Vencimiento del pago']],
        [/Fecha del comprobante/, '16/11/2026'],
        [/Vencimiento del pago/, BACK],
        [/Fecha del comprobante/, BACK],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      repeat,
    ));

  it('una factura A a un CUIT: pregunta la condición IVA', () =>
    golden(
      'repetir-pesos/factura-a',
      [
        [/Qué comprobante querés repetir/, 'Factura A'],
        [/Cuál repetimos/, '00003-00000008'],
        [/Condición frente al IVA/, 'Responsable inscripto'],
        [/Mismo monto/, 'Sí'],
        [/Período del servicio/, 'Este mes'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      repeat,
    ));
});

const repetirDolares = [
  [/Qué comprobante querés repetir/, 'Factura C'],
  [/Cuál repetimos/, '00003-00000015'],
] as const;

describe('golden de pantallas: Repetir en moneda extranjera', () => {
  it('camino tipico: la factura en dólares, mismo monto, cobrada en dólares', () =>
    golden(
      'repetir-moneda-extranjera/tipico',
      [
        ...repetirDolares,
        [/Mismo monto/, 'Sí'],
        [/Cómo te pagan/, 'En dólares'],
        [/Período del servicio/, 'Este mes'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      repeat,
    ));

  it('con Volver en el medio: de la cotización al pago, cambia a dólares', () =>
    golden(
      'repetir-moneda-extranjera/volver',
      [
        ...repetirDolares,
        [/Mismo monto/, 'No'],
        [/Monto total en USD/, '600'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de USD/, BACK],
        [/Cómo te pagan/, 'En dólares'],
        [/Período del servicio/, 'Este mes'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      repeat,
    ));

  it('con opcionales marcados: cobrada en pesos con cotización y fecha', () =>
    golden(
      'repetir-moneda-extranjera/opcionales-marcados',
      [
        ...repetirDolares,
        [/Mismo monto/, 'Sí'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de USD/, '1.410'],
        [/Período del servicio/, 'El mes pasado'],
        [/Agregamos/, ['Fecha del comprobante']],
        [/Fecha del comprobante/, '17/11/2026'],
        NO_EMIT,
      ],
      repeat,
    ));

  it('con opcionales desmarcados: responde la fecha, vuelve y la desmarca', () =>
    golden(
      'repetir-moneda-extranjera/opcionales-desmarcados',
      [
        ...repetirDolares,
        [/Mismo monto/, 'Sí'],
        [/Cómo te pagan/, 'En dólares'],
        [/Período del servicio/, 'Este mes'],
        [/Agregamos/, ['Fecha del comprobante', 'Período del servicio']],
        [/Fecha del comprobante/, '17/11/2026'],
        [/Servicio desde/, BACK],
        [/Fecha del comprobante/, BACK],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      repeat,
    ));
});

const facturaE = [
  [/comprobante/, 'Factura de exportación E'],
  [/cliente del exterior/, 'ACME LLC'],
  [/Domicilio/, '123 Main St'],
  [/País de destino/, 'estados unidos'],
  [/ID impositivo/, '12-3456789'],
  [/Qué exportás/, 'Servicios'],
  [/moneda/, 'Dólares'],
  [/Te pagan en dólares/, 'Sí'],
  // Sin "Monto total": el primer ítem con la cantidad y la unidad por defecto, y el total es su suma (NAV-10).
  [/Descripción del ítem 1/, 'Consultoría de software'],
  [/Cantidad/, ''],
  [/Unidad/, 'unidades'],
  [/^(?:Importe|Precio unitario) en USD/, '1.500'],
  [/Descripción del ítem 2/, ''],
  [/Importe total/, 'Confirmar'],
  [/Forma de pago/, ''],
  [/Actividad de WSFEX/, '620100'],
] as const;

describe('golden de pantallas: factura E', () => {
  it('camino tipico: servicios en dólares cobrados en dólares, sin opcionales', () =>
    golden('factura-e/tipico', [...facturaE, [/Fecha de pago/, ''], [/Agregamos/, []], NO_EMIT]));

  it('con Volver en el medio: de la vista previa a los opcionales y a la fecha de pago, que siguen respondidos, y desmarca el idioma (REV-68, TUI-15)', () =>
    golden('factura-e/volver', [
      ...facturaE,
      [/Fecha de pago/, '30/11/2026'],
      [/Agregamos/, ['Idioma']],
      [/Idioma del comprobante/, 'Inglés'],
      [/Emitimos/, BACK],
      [/Agregamos/, BACK],
      [/Fecha de pago/, '30/11/2026'],
      // Arranca con el idioma marcado; desmarcado, no va.
      [/Agregamos/, []],
      NO_EMIT,
    ]));

  it('con opcionales marcados: fecha, idioma y observaciones', () =>
    golden('factura-e/opcionales-marcados', [
      ...facturaE,
      [/Fecha de pago/, ''],
      [/Agregamos/, ['Fecha del comprobante', 'Idioma', 'Observaciones']],
      [/Fecha del comprobante/, '17/11/2026'],
      [/Idioma del comprobante/, 'Inglés'],
      [/Observaciones \(Enter/, 'Pago a 30 días'],
      [/Observaciones comerciales/, ''],
      NO_EMIT,
    ]));

  it('con opcionales desmarcados: responde la fecha, vuelve y desmarca todo: la fecha no va (REV-67)', () =>
    golden('factura-e/opcionales-desmarcados', [
      ...facturaE,
      [/Fecha de pago/, ''],
      [/Agregamos/, ['Fecha del comprobante', 'Observaciones']],
      [/Fecha del comprobante/, '17/11/2026'],
      [/Observaciones \(Enter/, BACK],
      [/Fecha del comprobante/, BACK],
      [/Agregamos/, []],
      NO_EMIT,
    ]));

  it('bienes a un destino sin CUIT publicado, cobrados en pesos, con incoterm y cotización', () =>
    golden('factura-e/bienes', [
      [/comprobante/, 'Factura de exportación E'],
      [/cliente del exterior/, 'Importadora Exemplo Ltda'],
      [/Domicilio/, 'Rua Exemplo 100, Sao Paulo'],
      [/País de destino/, 'BRASIL'],
      [/ARCA no tiene un CUIT publicado/, ''],
      [/ID impositivo/, '12.345.678/0001-90'],
      [/Qué exportás/, 'Bienes'],
      [/moneda/, 'Dólares'],
      [/Te pagan en dólares/, 'No, en pesos'],
      // Despues de la moneda, arrancando con la de aduana de ARCA (NAV-9).
      [/Cotización de USD/, '1.180'],
      // El primer ítem con los valores por defecto: la misma solicitud que sin ítems (NAV-10).
      [/Descripción del ítem 1/, ''],
      [/Cantidad/, ''],
      [/Unidad/, 'unidades'],
      [/^(?:Importe|Precio unitario) en USD/, '2.000'],
      [/Descripción del ítem 2/, ''],
      [/Importe total/, 'Confirmar'],
      [/Incoterm/, 'FOB'],
      [/Permisos de embarque/, ''],
      [/Forma de pago/, ''],
      [/Actividad de WSFEX/, ''],
      [/Agregamos/, []],
      NO_EMIT,
    ]));
});

describe('golden de pantallas: ítems de la factura E (NAV-10)', () => {
  const bienes = [
    [/comprobante/, 'Factura de exportación E'],
    [/cliente del exterior/, 'Importadora Exemplo Ltda'],
    [/Domicilio/, 'Rua Exemplo 100, Sao Paulo'],
    [/País de destino/, 'BRASIL'],
    [/ARCA no tiene un CUIT publicado/, ''],
    [/ID impositivo/, '12.345.678/0001-90'],
    [/Qué exportás/, 'Bienes'],
    [/moneda/, 'Dólares'],
    [/Te pagan en dólares/, 'Sí'],
  ] as const;

  it('carga dos ítems y en el editor modifica uno, borra otro y agrega uno', () =>
    golden('factura-e/items', [
      ...bienes,
      [/Descripción del ítem 1/, 'Jugo de naranja'],
      [/Cantidad/, '1.000'],
      [/Unidad/, 'kilogramos'],
      [/^(?:Importe|Precio unitario) en USD/, '1,50'],
      [/Descripción del ítem 2/, 'Flete'],
      [/Cantidad/, '1'],
      [/Unidad/, 'unidades'],
      [/^(?:Importe|Precio unitario) en USD/, '500'],
      [/Descripción del ítem 3/, ''],
      [/Importe total/, 'Modificar los ítems'],
      [/^Ítems de .*: modificá o eliminá ítems/, editing({ add: true, edit: ['Jugo'], remove: ['Flete'] })],
      // El marcado para modificar arranca con lo que tenía.
      [/Descripción del ítem 1/, 'Jugo de naranja concentrado'],
      [/Cantidad/, '800'],
      [/Unidad/, 'kilogramos'],
      [/^(?:Importe|Precio unitario) en USD/, '2'],
      [/Descripción del ítem 2 \(Enter para terminar\)/, 'Seguro'],
      [/Cantidad/, '1'],
      [/Unidad/, 'unidades'],
      [/^(?:Importe|Precio unitario) en USD/, '100'],
      [/Descripción del ítem 3/, ''],
      [/Importe total/, 'Confirmar'],
      [/Incoterm/, 'FOB'],
      [/Permisos de embarque/, ''],
      [/Forma de pago/, ''],
      [/Actividad de WSFEX/, ''],
      [/Agregamos/, []],
      NO_EMIT,
    ]));

  it('con Volver: del total al último ítem y de su primer dato al paso anterior; al regresar, arranca en el editor con lo cargado', () =>
    golden('factura-e/items-volver', [
      ...bienes,
      [/Descripción del ítem 1/, 'Jugo de naranja'],
      [/Cantidad/, '1.000'],
      [/Unidad/, 'kilogramos'],
      [/^(?:Importe|Precio unitario) en USD/, BACK],
      [/Unidad/, BACK],
      [/Cantidad/, '1.200'],
      [/Unidad/, 'kilogramos'],
      [/^(?:Importe|Precio unitario) en USD/, '1,50'],
      [/Descripción del ítem 2/, ''],
      // En la primera carga, Volver desde el total va al último dato del último ítem, y desde el primero, al paso
      // anterior. Nada se pierde: al regresar arranca en el editor.
      [/Importe total/, BACK],
      [/^Precio unitario en USD/, BACK],
      [/Unidad/, BACK],
      [/Cantidad/, BACK],
      [/Descripción del ítem 1/, BACK],
      [/Te pagan en dólares/, 'Sí'],
      [/^Ítems de .*: modificá o eliminá ítems/, editing({})],
      [/Importe total/, 'Modificar los ítems'],
      // Esc en el editor, si se llegó desde el total, vuelve al total.
      [/^Ítems de .*: modificá o eliminá ítems/, BACK],
      [/Importe total/, 'Confirmar'],
      [/Incoterm/, 'FOB'],
      [/Permisos de embarque/, ''],
      [/Forma de pago/, ''],
      [/Actividad de WSFEX/, ''],
      [/Agregamos/, []],
      NO_EMIT,
    ]));
});

const notaCreditoE = [
  [/Sobre qué comprobante/, 'Facturas'],
  [/Qué factura\?/, 'Factura de exportación E'],
  [/Punto de venta de la factura E/, '3'],
  [/Número de la factura E/, '7'],
] as const;

/** La NC arranca con el renglón de la factura (1.500 USD): se modifica el precio a 500. */
const creditNoteFor500 = [
  [/^Ítems de .*: modificá o eliminá ítems/, editing({ edit: ['Según detalle'] })],
  [/Descripción del ítem 1/, ''],
  [/Cantidad/, ''],
  [/Unidad/, 'unidades'],
  [/^(?:Importe|Precio unitario) en USD/, '500'],
  [/Importe total/, 'Confirmar'],
] as const;

describe('golden de pantallas: notas E', () => {
  it('camino tipico: NC E sobre la factura E, sin opcionales', () =>
    golden('nota-e/tipico', [...notaCreditoE, ...creditNoteFor500, [/Agregamos/, []], NO_EMIT], creditNote));

  it('con Volver en el medio: del editor al número, que arranca escrito, y del precio al editor', () =>
    golden(
      'nota-e/volver',
      [
        ...notaCreditoE,
        [/^Ítems de .*: modificá o eliminá ítems/, BACK],
        [/Número de la factura E/, '7'],
        [/^Ítems de .*: modificá o eliminá ítems/, editing({ edit: ['Según detalle'] })],
        [/Descripción del ítem 1/, 'Descuento por volumen'],
        [/Cantidad/, ''],
        [/Unidad/, 'unidades'],
        // Más que la factura: la NC no se puede confirmar.
        [/^(?:Importe|Precio unitario) en USD/, '1.600'],
        [/Importe total/, 'Modificar los ítems'],
        [/^Ítems de .*: modificá o eliminá ítems/, editing({ edit: ['Descuento'] })],
        [/Descripción del ítem 1/, ''],
        [/Cantidad/, ''],
        [/Unidad/, 'unidades'],
        [/^(?:Importe|Precio unitario) en USD/, BACK],
        [/Unidad/, BACK],
        [/Cantidad/, BACK],
        [/Descripción del ítem 1/, BACK],
        // Esc en las preguntas de un ítem que se modifica deja todo como estaba y vuelve al editor.
        [/^Ítems de .*: modificá o eliminá ítems/, editing({ edit: ['Descuento'] })],
        [/Descripción del ítem 1/, ''],
        [/Cantidad/, ''],
        [/Unidad/, 'unidades'],
        [/^(?:Importe|Precio unitario) en USD/, '400'],
        [/Importe total/, 'Confirmar'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      creditNote,
    ));

  it('con opcionales marcados: fecha y observaciones', () =>
    golden(
      'nota-e/opcionales-marcados',
      [
        ...notaCreditoE,
        ...creditNoteFor500,
        [/Agregamos/, ['Fecha del comprobante', 'Observaciones']],
        [/Fecha del comprobante/, '17/11/2026'],
        [/Observaciones \(Enter/, 'Ajuste de precio'],
        [/Observaciones comerciales/, ''],
        NO_EMIT,
      ],
      creditNote,
    ));

  it('con opcionales desmarcados: responde el idioma, vuelve y lo desmarca: no va (REV-67)', () =>
    golden(
      'nota-e/opcionales-desmarcados',
      [
        ...notaCreditoE,
        ...creditNoteFor500,
        [/Agregamos/, ['Idioma', 'Observaciones']],
        [/Idioma del comprobante/, 'Inglés'],
        [/Observaciones \(Enter/, BACK],
        [/Idioma del comprobante/, BACK],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      creditNote,
    ));

  it('ND E sobre la factura E', () =>
    golden(
      'nota-e/debito',
      [
        ...notaCreditoE,
        // La ND arranca con el renglón de la factura: se modifica la descripción y el precio.
        [/^Ítems de .*: modificá o eliminá ítems/, editing({ edit: ['Según detalle'] })],
        [/Descripción del ítem 1/, 'Intereses'],
        [/Cantidad/, ''],
        [/Unidad/, 'unidades'],
        [/^(?:Importe|Precio unitario) en USD/, '150'],
        [/Importe total/, 'Confirmar'],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      debitNote,
    ));
});

const repetirE = [
  [/Qué comprobante querés repetir/, 'Factura de exportación E'],
  [/Cuál repetimos/, '00003-00000007'],
] as const;

/** El editor arranca con el renglón de la factura y Enter sin marcas va al total (NAV-10). */
const sameItems = [
  [/^Ítems de .*: modificá o eliminá ítems/, editing({})],
  [/Importe total/, 'Confirmar'],
] as const;

describe('golden de pantallas: Repetir E', () => {
  it('camino tipico: la factura E con los mismos ítems, sin opcionales', () =>
    golden('repetir-e/tipico', [...repetirE, ...sameItems, [/Fecha de pago/, ''], [/Agregamos/, []], NO_EMIT], repeat));

  it('con Volver en el medio: del editor a la factura, otro precio, y de la vista previa a la fecha de pago, con los opcionales marcados (REV-68)', () =>
    golden(
      'repetir-e/volver',
      [
        ...repetirE,
        [/^Ítems de .*: modificá o eliminá ítems/, BACK],
        [/Cuál repetimos/, '00003-00000007'],
        [/^Ítems de .*: modificá o eliminá ítems/, editing({ edit: ['Según detalle'] })],
        [/Descripción del ítem 1/, ''],
        [/Cantidad/, ''],
        [/Unidad/, 'unidades'],
        [/^(?:Importe|Precio unitario) en USD/, '1.800'],
        [/Importe total/, 'Confirmar'],
        [/Fecha de pago/, ''],
        [/Agregamos/, ['Observaciones']],
        [/Observaciones \(Enter/, 'Segunda cuota'],
        [/Observaciones comerciales/, ''],
        [/Emitimos/, BACK],
        [/Agregamos/, BACK],
        [/Fecha de pago/, ''],
        // Arranca con las observaciones marcadas; desmarcadas, no van.
        [/Agregamos/, []],
        NO_EMIT,
      ],
      repeat,
    ));

  it('con opcionales marcados: fecha e idioma', () =>
    golden(
      'repetir-e/opcionales-marcados',
      [
        ...repetirE,
        ...sameItems,
        [/Fecha de pago/, '30/11/2026'],
        [/Agregamos/, ['Fecha del comprobante', 'Idioma']],
        [/Fecha del comprobante/, '17/11/2026'],
        [/Idioma del comprobante/, 'Inglés'],
        NO_EMIT,
      ],
      repeat,
    ));

  it('con opcionales desmarcados: responde la fecha, vuelve y la desmarca: no va (REV-67)', () =>
    golden(
      'repetir-e/opcionales-desmarcados',
      [
        ...repetirE,
        ...sameItems,
        [/Fecha de pago/, ''],
        [/Agregamos/, ['Fecha del comprobante', 'Idioma']],
        [/Fecha del comprobante/, '17/11/2026'],
        [/Idioma del comprobante/, BACK],
        [/Fecha del comprobante/, BACK],
        [/Agregamos/, []],
        NO_EMIT,
      ],
      repeat,
    ));
});
