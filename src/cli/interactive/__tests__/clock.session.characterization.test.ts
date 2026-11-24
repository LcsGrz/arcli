import { X509Certificate } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CertificateExpiredError } from '../../../modules/config/certificate-expiry';
import { BACK } from '../../../modules/interactive/wizard';
import { stripAnsi } from '../../../ui';
import {
  AFTER_MIDNIGHT,
  answerAssociated,
  BEFORE_MIDNIGHT,
  CLIENT_CUIT,
  CLOCK_CONFIG,
  setClock,
  useClockFixture,
  wsfeRequests,
  wsfexRequests,
} from '../../__tests__/clock.fixture';
import { runCertificateMenu } from '../certificate.flow';
import { runInvoiceFlow } from '../invoice.flow';
import { runNoteFlow } from '../note.flow';
import { runRepeatFlow } from '../repeat.flow';
import { createInteractiveSession } from '../session';

import { createScript, KEEP_EXPORT_ITEMS, rejecting, type ScriptedAnswer, singleExportItem } from './script';

/**
 * Caracterizacion del reloj en el asistente (REV-48, tanda 2): una sesion real, abierta antes de la medianoche de
 * Argentina, en la que el reloj avanza mientras espera una respuesta. Solo se reemplazan las preguntas y el SDK.
 */

vi.mock('@arcasdk/core', async (original) =>
  (await import('../../__tests__/clock.fixture')).fakeArcaSdk(await original<Record<string, unknown>>()),
);

vi.mock('../../spinner', () => ({
  startSpinner: () => null,
  withSpinner: (_text: unknown, run: () => unknown) => run(),
}));

let script = createScript([]);
/** El reloj salta a `to` al llegar a la pregunta, antes de validar la respuesta: la persona la dejo esperando. */
let jump: { readonly at: RegExp; readonly to: Date } | undefined;

function waitAt(message: string): void {
  if (jump?.at.test(message)) {
    setClock(jump.to);
    jump = undefined;
  }
}

vi.mock('../prompts', () => {
  const waiting =
    <Args extends [string, ...unknown[]], R>(ask: (...args: Args) => R) =>
    (...args: Args): R => {
      waitAt(args[0]);

      return ask(...args);
    };

  return {
    askTextStep: waiting((...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args)),
    chooseFromFilterList: waiting((...args: Parameters<typeof script.chooseFromFilterList>) =>
      script.chooseFromFilterList(...args),
    ),
    chooseManyStep: waiting((...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args)),
    chooseOne: waiting((...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args)),
    chooseOrTypeStep: waiting((...args: Parameters<typeof script.chooseOrTypeStep>) =>
      script.chooseOrTypeStep(...args),
    ),
    chooseStep: waiting((...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args)),
    chooseStepWhileLoading: (...args: Parameters<typeof script.chooseStepWhileLoading>) =>
      script.chooseStepWhileLoading(...args),
    confirm: (message: string, yesLabel: string, noLabel = 'No') =>
      script.chooseStep(message, [
        { name: yesLabel, value: true },
        { name: noLabel, value: false },
      ]),
    editRowsStep: waiting((...args: Parameters<typeof script.editRowsStep>) => script.editRowsStep(...args)),
    eraseLastAnswer: () => undefined,
    fitPageSize: () => 12,
    isPromptCancellation: () => false,
  };
});

type Steps = ReadonlyArray<readonly [RegExp, ScriptedAnswer]>;

const profile = useClockFixture();
const EMIT = [/Emitimos/, 'Sí, emitir ahora'] as const;
const INVOICE_C: Steps = [
  [/comprobante/, 'Factura C'],
  [/A quién/, 'Consumidor final'],
  [/Qué estás facturando/, 'Servicios'],
  [/Monto total/, '1000'],
];
const INVOICE_E: Steps = [
  [/comprobante/, 'Factura de exportación E'],
  [/cliente del exterior/, 'ACME LLC'],
  [/Domicilio/, '123 Main St'],
  [/País de destino/, '212'],
  [/ID impositivo/, ''],
  [/Qué exportás/, 'Servicios'],
  [/moneda/, 'Pesos'],
  ...singleExportItem('100', 'Consultoría'),
  [/Forma de pago/, 'Transferencia Internacional'],
];
/** La ventana de A, B y C de servicios del 11/11: el 10/11, la última válida era el 20/11 y la primera, el 31/10. */
const NEW_WINDOW = rejecting('21/11/2026', ['31/10/2026', /fuera de rango/], ['22/11/2026', /fuera de rango/]);
/** La de la E del 11/11: el 10/11, iba del 05/11 al 15/11. */
const NEW_EXPORT_WINDOW = rejecting('16/11/2026', ['05/11/2026', /error 1500/], ['17/11/2026', /error 1500/]);
const FCE: Steps = [
  [/comprobante/, 'Factura de crédito electrónica A'],
  [/A quién le facturás/, 'Con CUIT'],
  [/CUIT del receptor/, String(CLIENT_CUIT)],
  [/Condición frente al IVA/, 'Responsable inscripto'],
  [/Qué estás facturando/, 'Servicios'],
  [/Monto total/, '5000000'],
  [/^CBU/, '0110599520000012345678'],
  [/Alias del CBU/, ''],
];
const PERIOD_NOTE: Steps = [
  [/Sobre qué comprobante/, 'Facturas'],
  [/Qué factura\?/, 'Factura C'],
  [/A qué la asociamos/, 'A un período'],
  [/Período desde/, '01/11/2026'],
];

/** Corre un flujo hasta el final del guion. Con `midnightAt`, la medianoche pasa al llegar a esa pregunta. */
async function run(flow: () => Promise<unknown>, steps: Steps, midnightAt?: RegExp): Promise<void> {
  script = createScript(steps);
  jump = midnightAt && { at: midnightAt, to: AFTER_MIDNIGHT };
  await flow();

  expect(script.remaining(), 'quedaron respuestas del guion sin preguntar').toBe(0);
  expect(jump, 'no se llego a la pregunta donde pasa la medianoche').toBeUndefined();
}

beforeEach(() => {
  jump = undefined;
  profile.writeConfig(profile.configWith(profile.healthy, CLOCK_CONFIG));
  setClock(BEFORE_MIDNIGHT);
});

describe('sesión abierta antes de la medianoche', () => {
  it('la emisión vuelve a leer la fecha: se muestra la del 10/11 y, si se confirma el 11/11, sale con la del 11/11', async () => {
    const session = createInteractiveSession({});

    await run(() => runInvoiceFlow(session), [...INVOICE_C, [/Agregamos/, []], EMIT], /Emitimos/);

    expect(stripAnsi(profile.stdout)).toMatch(/Fecha del comprobante\s+10\/11\/2026/);
    expect(wsfeRequests()).toEqual([
      expect.objectContaining({
        CbteFch: '20261111',
        FchServDesde: '20261111',
        FchServHasta: '20261111',
        FchVtoPago: '20261111',
      }),
    ]);
  });

  it('dos comprobantes en la misma sesión: cada uno con la fecha de cuando se emite', async () => {
    const session = createInteractiveSession({});

    await run(() => runInvoiceFlow(session), [...INVOICE_C, [/Agregamos/, []], EMIT]);
    setClock(AFTER_MIDNIGHT);
    await run(() => runInvoiceFlow(session), [...INVOICE_C, [/Agregamos/, []], EMIT]);

    expect(wsfeRequests().map(({ CbteFch }) => CbteFch)).toEqual(['20261110', '20261111']);
  });

  it('los opcionales validan con la ventana del día nuevo', async () => {
    const session = createInteractiveSession({});

    await run(
      () => runInvoiceFlow(session),
      [
        ...INVOICE_C,
        [/Agregamos/, ['Fecha del comprobante']],
        // El 10/11, la última válida era el 20/11 y la primera, el 31/10.
        [
          /^Fecha del comprobante/,
          rejecting('21/11/2026', ['31/10/2026', /fuera de rango/], ['22/11/2026', /fuera de rango/]),
        ],
        EMIT,
      ],
      /Monto total/,
    );

    expect(wsfeRequests()).toEqual([expect.objectContaining({ CbteFch: '20261121' })]);
  });

  // ARQ-19: las reglas leen hoy en cada validación, no al abrir los opcionales.
  it('si la medianoche pasa con los opcionales abiertos, vale el día nuevo', async () => {
    const session = createInteractiveSession({});

    await run(
      () => runInvoiceFlow(session),
      [...INVOICE_C, [/Agregamos/, ['Fecha del comprobante']], [/^Fecha del comprobante/, NEW_WINDOW], EMIT],
      /^Fecha del comprobante/,
    );

    expect(wsfeRequests()).toEqual([expect.objectContaining({ CbteFch: '20261121' })]);
  });

  it('una fecha relativa se resuelve cuando se responde', async () => {
    const session = createInteractiveSession({});

    await run(
      () => runInvoiceFlow(session),
      [...INVOICE_C, [/Agregamos/, ['Fecha del comprobante']], [/^Fecha del comprobante/, '-1'], EMIT],
      /^Fecha del comprobante/,
    );

    expect(wsfeRequests()).toEqual([expect.objectContaining({ CbteFch: '20261110' })]);
  });

  it('FCE: el vencimiento de ayer deja de valer', async () => {
    const session = createInteractiveSession({});

    await run(
      () => runInvoiceFlow(session),
      [
        ...FCE,
        [/Agregamos/, ['Vencimiento']],
        [/^Vencimiento/, rejecting('11/11/2026', ['10/11/2026', /no puede ser anterior/])],
        EMIT,
        [/Guardamos el CBU/, 'No'],
      ],
      /Monto total/,
    );

    expect(wsfeRequests()).toEqual([expect.objectContaining({ CbteFch: '20261111', FchVtoPago: '20261111' })]);
  });

  it('recibo: sale con la fecha del día nuevo', async () => {
    const session = createInteractiveSession({});

    await run(
      () => runInvoiceFlow(session, true),
      [
        [/Qué recibo/, 'Recibo C'],
        [/A quién le hacés el recibo/, 'Consumidor final'],
        [/Qué estás cobrando/, 'Servicios'],
        [/Monto total/, '1000'],
        [/Agregamos/, []],
        EMIT,
      ],
      /Monto total/,
    );

    expect(wsfeRequests()).toEqual([expect.objectContaining({ CbteFch: '20261111' })]);
  });

  it('nota por período: puede terminar el día nuevo, que antes de la medianoche era mañana', async () => {
    const session = createInteractiveSession({});

    await run(
      () => runNoteFlow(session, 'credito'),
      [
        ...PERIOD_NOTE,
        // Al preguntarlo vale hasta la fecha más tardía de la nota: hoy + 10.
        [/Período hasta/, rejecting('11/11/2026', ['22/11/2026', /21\/11\/2026/])],
        [/A quién va la nota/, 'Consumidor final'],
        [/Qué concepto ajusta la nota/, 'Servicios'],
        [/Monto de la nota de crédito/, '100'],
        [/Agregamos/, []],
        EMIT,
      ],
      /Período hasta/,
    );

    expect(wsfeRequests()).toEqual([
      expect.objectContaining({ CbteFch: '20261111', PeriodoAsoc: { FchDesde: '20261101', FchHasta: '20261111' } }),
    ]);
  });

  it('nota por período: al cerrar, un período que termina mañana vuelve a la pregunta', async () => {
    const session = createInteractiveSession({});

    await run(
      () => runNoteFlow(session, 'credito'),
      [
        ...PERIOD_NOTE,
        [/Período hasta/, '12/11/2026'],
        [/A quién va la nota/, 'Consumidor final'],
        [/Qué concepto ajusta la nota/, 'Servicios'],
        [/Monto de la nota de crédito/, '100'],
        [/Agregamos/, []],
        // `finalize` ya mira el 11/11.
        [/Período hasta/, '11/11/2026'],
        [/A quién va la nota/, 'Consumidor final'],
        [/Qué concepto ajusta la nota/, 'Servicios'],
        [/Monto de la nota de crédito/, '100'],
        [/Agregamos/, []],
        EMIT,
      ],
      /Monto de la nota/,
    );

    expect(stripAnsi(profile.stdout + profile.stderr)).toContain('(11/11/2026)');
    expect(wsfeRequests()).toEqual([
      expect.objectContaining({ PeriodoAsoc: { FchDesde: '20261101', FchHasta: '20261111' } }),
    ]);
  });
});

describe('sesión abierta antes de la medianoche: exportación', () => {
  it('la E toma la fecha de la vista previa: si la medianoche pasa en las preguntas, la del día nuevo', async () => {
    const session = createInteractiveSession({});

    await run(
      () => runInvoiceFlow(session),
      [...INVOICE_E, [/Fecha de pago/, ''], [/Agregamos/, []], EMIT],
      /Agregamos/,
    );

    expect(wsfexRequests()).toEqual([expect.objectContaining({ Fecha_cbte: '20261111' })]);
  });

  // A diferencia de A, B y C, la E emite lo que se resolvió para la vista previa: no vuelve a leer la fecha.
  it('la E que se confirma pasada la medianoche sale con la fecha de la vista previa', async () => {
    const session = createInteractiveSession({});

    await run(
      () => runInvoiceFlow(session),
      [...INVOICE_E, [/Fecha de pago/, ''], [/Agregamos/, []], EMIT],
      /Emitimos/,
    );

    expect(wsfexRequests()).toEqual([expect.objectContaining({ Fecha_cbte: '20261110' })]);
  });

  it('la E valida sus fechas con la ventana del día nuevo', async () => {
    const session = createInteractiveSession({});

    await run(
      () => runInvoiceFlow(session),
      [
        ...INVOICE_E,
        [/Fecha de pago/, rejecting('30/11/2026', ['05/11/2026', /06\/11\/2026/])],
        [/Agregamos/, ['Fecha del comprobante']],
        [/Fecha del comprobante/, rejecting('16/11/2026', ['05/11/2026', /error 1500/], ['17/11/2026', /error 1500/])],
        EMIT,
      ],
      /Forma de pago/,
    );

    expect(wsfexRequests()).toEqual([expect.objectContaining({ Fecha_cbte: '20261116', Fecha_pago: '20261130' })]);
  });
});

describe('la medianoche pasa con los opcionales abiertos: todo usa el día nuevo (ARQ-19)', () => {
  const NOTE_DATA: Steps = [
    [/A quién va la nota/, 'Consumidor final'],
    [/Qué concepto ajusta la nota/, 'Servicios'],
    [/Monto de la nota de crédito/, '100'],
  ];
  const NOTE_E: Steps = [
    [/Sobre qué comprobante/, 'Facturas'],
    [/Qué factura\?/, 'Factura de exportación E'],
    [/Punto de venta de la factura E/, '3'],
    [/Número de la factura E/, '1'],
    ...KEEP_EXPORT_ITEMS,
  ];
  const REPEAT_C: Steps = [
    [/Qué comprobante querés repetir/, 'Factura C'],
    [/Cuál repetimos/, '00003-00000041'],
    [/Mismo monto/, 'Sí'],
    [/Período del servicio/, 'Un solo día'],
  ];
  const REPEAT_E: Steps = [
    [/Qué comprobante querés repetir/, 'Factura de exportación E'],
    [/Cuál repetimos/, '00003-00000001'],
    ...KEEP_EXPORT_ITEMS,
    [/Fecha de pago/, ''],
  ];
  const withDate = (steps: Steps, date: ScriptedAnswer): Steps => [
    ...steps,
    [/Agregamos/, ['Fecha del comprobante']],
    [/^Fecha del comprobante/, date],
    EMIT,
  ];
  const atDate = /^Fecha del comprobante/;

  it('recibo', async () => {
    const steps: Steps = [
      [/Qué recibo/, 'Recibo C'],
      [/A quién le hacés el recibo/, 'Consumidor final'],
      [/Qué estás cobrando/, 'Servicios'],
      [/Monto total/, '1000'],
    ];

    await run(() => runInvoiceFlow(createInteractiveSession({}), true), withDate(steps, NEW_WINDOW), atDate);

    expect(wsfeRequests()).toEqual([expect.objectContaining({ CbteFch: '20261121' })]);
  });

  it('FCE: la fecha', async () => {
    await run(
      () => runInvoiceFlow(createInteractiveSession({})),
      [
        ...withDate(FCE, rejecting('12/11/2026', ['05/11/2026', /fuera de rango/], ['13/11/2026', /fuera de rango/])),
        [/Guardamos el CBU/, 'No'],
      ],
      atDate,
    );

    expect(wsfeRequests()).toEqual([expect.objectContaining({ CbteFch: '20261112' })]);
  });

  it('FCE: el vencimiento', async () => {
    await run(
      () => runInvoiceFlow(createInteractiveSession({})),
      [
        ...FCE,
        [/Agregamos/, ['Vencimiento']],
        [/^Vencimiento/, rejecting('11/11/2026', ['10/11/2026', /no puede ser anterior/])],
        EMIT,
        [/Guardamos el CBU/, 'No'],
      ],
      /^Vencimiento/,
    );

    expect(wsfeRequests()).toEqual([expect.objectContaining({ FchVtoPago: '20261111' })]);
  });

  it('nota', async () => {
    await run(
      () => runNoteFlow(createInteractiveSession({}), 'credito'),
      withDate([...PERIOD_NOTE, [/Período hasta/, '10/11/2026'], ...NOTE_DATA], NEW_WINDOW),
      atDate,
    );

    expect(wsfeRequests()).toEqual([expect.objectContaining({ CbteFch: '20261121' })]);
  });

  it('Repetir', async () => {
    await run(() => runRepeatFlow(createInteractiveSession({})), withDate(REPEAT_C, NEW_WINDOW), atDate);

    expect(wsfeRequests()).toEqual([expect.objectContaining({ CbteFch: '20261121' })]);
  });

  it('E', async () => {
    await run(
      () => runInvoiceFlow(createInteractiveSession({})),
      withDate([...INVOICE_E, [/Fecha de pago/, '']], NEW_EXPORT_WINDOW),
      atDate,
    );

    expect(wsfexRequests()).toEqual([expect.objectContaining({ Fecha_cbte: '20261116' })]);
  });

  it('E: la fecha de pago, antes de los opcionales', async () => {
    await run(
      () => runInvoiceFlow(createInteractiveSession({})),
      [
        ...INVOICE_E,
        [/Fecha de pago/, rejecting('30/11/2026', ['05/11/2026', /06\/11\/2026/])],
        [/Agregamos/, []],
        EMIT,
      ],
      /Fecha de pago/,
    );

    expect(wsfexRequests()).toEqual([expect.objectContaining({ Fecha_cbte: '20261111', Fecha_pago: '20261130' })]);
  });

  it('nota E', async () => {
    await run(() => runNoteFlow(createInteractiveSession({}), 'credito'), withDate(NOTE_E, NEW_EXPORT_WINDOW), atDate);

    expect(wsfexRequests()).toEqual([expect.objectContaining({ Fecha_cbte: '20261116' })]);
  });

  it('Repetir E', async () => {
    await run(() => runRepeatFlow(createInteractiveSession({})), withDate(REPEAT_E, NEW_EXPORT_WINDOW), atDate);

    expect(wsfexRequests()).toEqual([expect.objectContaining({ Fecha_cbte: '20261116' })]);
  });

  describe('lo respondido antes de la medianoche que deja de valer se avisa y vuelve a su pregunta', () => {
    it('A, B y C', async () => {
      await run(
        () => runInvoiceFlow(createInteractiveSession({})),
        [
          ...INVOICE_C,
          [/Agregamos/, ['Fecha del comprobante', 'Vencimiento']],
          [/^Fecha del comprobante/, '31/10/2026'],
          [/^Vencimiento/, '30/11/2026'],
          [/^Fecha del comprobante/, rejecting('01/11/2026', ['31/10/2026', /fuera de rango/])],
          [/^Vencimiento/, '30/11/2026'],
          EMIT,
        ],
        /^Vencimiento/,
      );

      expect(stripAnsi(profile.stdout + profile.stderr)).toMatch(/La fecha 31\/10\/2026 está fuera de rango/);
      expect(wsfeRequests()).toEqual([expect.objectContaining({ CbteFch: '20261101' })]);
    });

    it('E', async () => {
      await run(
        () => runInvoiceFlow(createInteractiveSession({})),
        [
          ...INVOICE_E,
          [/Fecha de pago/, ''],
          [/Agregamos/, ['Fecha del comprobante', 'Observaciones']],
          [/^Fecha del comprobante/, '05/11/2026'],
          [/^Observaciones \(/, ''],
          [/^Observaciones comerciales/, ''],
          [/^Fecha del comprobante/, rejecting('06/11/2026', ['05/11/2026', /error 1500/])],
          [/^Observaciones \(/, ''],
          [/^Observaciones comerciales/, ''],
          EMIT,
        ],
        /^Observaciones \(/,
      );

      expect(stripAnsi(profile.stdout + profile.stderr)).toMatch(/error\s+1500/);
      expect(wsfexRequests()).toEqual([expect.objectContaining({ Fecha_cbte: '20261106' })]);
    });
  });
});

describe('Repetir en una sesión que cruza el fin de mes', () => {
  const LAST_OF_NOVEMBER = new Date('2026-12-01T02:59:59.999Z');
  const FIRST_OF_DECEMBER = new Date('2026-12-01T03:00:00.000Z');
  const STEPS: Steps = [
    [/Qué comprobante querés repetir/, 'Factura C'],
    [/Cuál repetimos/, '00003-00000041'],
    [/Mismo monto/, 'Sí'],
    [/Período del servicio/, 'El mes pasado'],
    [/Agregamos/, []],
    EMIT,
  ];

  beforeEach(() => {
    setClock(LAST_OF_NOVEMBER);
    answerAssociated();
  });

  it('el flujo empezado en el mes nuevo ofrece el mes pasado nuevo, en la misma sesión', async () => {
    const session = createInteractiveSession({});

    setClock(FIRST_OF_DECEMBER);
    await run(() => runRepeatFlow(session), STEPS);

    expect(wsfeRequests()).toEqual([
      expect.objectContaining({ CbteFch: '20261201', FchServDesde: '20261101', FchServHasta: '20261130' }),
    ]);
  });

  it('el "mes pasado" es el del comienzo del flujo; la fecha del comprobante, la de la emisión', async () => {
    const session = createInteractiveSession({});

    script = createScript(STEPS);
    jump = { at: /Período del servicio/, to: FIRST_OF_DECEMBER };
    await runRepeatFlow(session);

    expect(wsfeRequests()).toEqual([
      expect.objectContaining({ CbteFch: '20261201', FchServDesde: '20261001', FchServHasta: '20261031' }),
    ]);
  });
});

describe('certificado que vence durante la sesión', () => {
  const expiresAt = () => new Date(new X509Certificate(profile.expiring.pem).validTo).getTime();
  const secondsFromExpiry = (seconds: number) => new Date(expiresAt() + seconds * 1000);

  beforeEach(() => setClock(secondsFromExpiry(-60)));

  it('la sesión ya abierta emite igual; una nueva da CERTIFICATE_EXPIRED', async () => {
    profile.writeConfig(profile.configWith(profile.expiring, CLOCK_CONFIG));

    const session = createInteractiveSession({});

    setClock(secondsFromExpiry(60));
    await run(() => runInvoiceFlow(session), [...INVOICE_C, [/Agregamos/, []], EMIT]);

    expect(wsfeRequests()).toHaveLength(1);
    expect(() => createInteractiveSession({})).toThrow(CertificateExpiredError);
  });

  it('con certificado de exportación propio, la E lo vuelve a mirar en la sesión ya abierta', async () => {
    profile.writeConfig(
      profile.configWith(profile.healthy, {
        ...CLOCK_CONFIG,
        exportacion: {
          actividad: 620100,
          cert: { testing: profile.expiring.certPath },
          key: { testing: profile.expiring.keyPath },
        },
      }),
    );

    const session = createInteractiveSession({});

    setClock(secondsFromExpiry(60));

    await expect(run(() => runInvoiceFlow(session), [[/comprobante/, 'Factura de exportación E']])).rejects.toThrow(
      CertificateExpiredError,
    );
    expect(wsfexRequests()).toEqual([]);
  });

  it('"Certificados de ARCA" recalcula el estado cada vez que se muestra', async () => {
    profile.writeConfig(profile.configWith(profile.expiring, CLOCK_CONFIG));

    const menu = async () => {
      const shown = profile.stdout.length;

      await run(runCertificateMenu, [[/Qué querés hacer/, BACK]]);

      return stripAnsi(profile.stdout.slice(shown));
    };

    setClock(secondsFromExpiry(-86_400));
    expect(await menu()).toContain('falta 1 día: renovalo');
    setClock(secondsFromExpiry(-1));
    expect(await menu()).toContain('vence hoy: renovalo');
    setClock(secondsFromExpiry(1));
    expect(await menu()).toContain('vencido: renovalo');
  });
});
