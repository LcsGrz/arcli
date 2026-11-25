import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VoucherShortcut } from '../../../modules/billing/billing.types';
import { EXPORT_CREDIT_NOTE_KIND, EXPORT_DEBIT_NOTE_KIND } from '../../../modules/export/export.kinds';
import { REPEATED_SIGNAL_MS } from '../../interruption';

import {
  batch,
  CLIENT_CUIT,
  E_NOTE,
  emissionCalls,
  EMIT_WITH_PDF,
  FC,
  FE,
  type Run,
  runBilling,
  runExport,
  type RunOptions,
  useEmissionSequence,
} from './emission-sequence.fixture';

/**
 * ARQ-11: Ctrl+C (o SIGTERM) mientras se emite, por el comando real y con un ARCA falso. La señal se simula con
 * `process.emit`, así también vale para Windows; con el binario y señales de verdad, `interrupted-emission.e2e.ts`.
 *
 * Nada se queda esperando: si el comando no corta con la segunda señal, ARCA contesta igual a los `ANSWER_MS`.
 */
vi.mock('../../spinner', () => ({ startSpinner: () => null }));
vi.mock('../../interactive/list-select', () => ({ listSelect: vi.fn() }));

const ANSWER_MS = 3000;
const CAE = /75123456789012/g;
/** Nunca de un comprobante que se pudo haber enviado. */
const DENIED = /no se (emitió|envió)/i;
const signals = { SIGINT: 0, SIGTERM: 0 };

type Signal = keyof typeof signals;

interface Interruption {
  /** En cuál llamada a `method` llega la señal. */
  readonly call?: number;
  /** Cuánto pasa entre una señal y la otra. Por defecto, lo justo para que cuenten por separado. */
  readonly gap?: number;
  readonly method?: string;
  /** Con varias, una por vez en ese orden. */
  readonly signal?: Signal | readonly Signal[];
  readonly times: number;
}

interface InterruptedRun extends Run {
  /** ARCA ya había contestado cuando terminó el comando. */
  readonly answered: boolean;
  readonly exit: string;
  /** Lo que se escribió después de la señal y antes de que ARCA contestara. */
  readonly whileWaiting: string;
}

const listeners = () => ({ SIGINT: process.listenerCount('SIGINT'), SIGTERM: process.listenerCount('SIGTERM') });

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

const written = () =>
  [process.stdout, process.stderr]
    .flatMap(({ write }) => vi.mocked(write).mock.calls.map(([chunk]) => String(chunk)))
    .join('');

/** Corre `run` y, en esa llamada a ARCA, manda las señales y después deja que ARCA conteste. */
async function interrupt(
  { call = 1, gap = REPEATED_SIGNAL_MS, method = 'createVoucher', signal = 'SIGINT', times }: Interruption,
  run: (hook: Pick<RunOptions, 'onArcaCall'>) => Promise<Run>,
): Promise<InterruptedRun> {
  let answered = false;
  let seen = 0;
  let whileWaiting = '';
  let waiting: Promise<void> | undefined;
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });

  async function sendSignals(): Promise<void> {
    const before = written();
    const now = Math.floor(performance.now());
    const clock = vi.spyOn(performance, 'now');

    for (let sent = 0; sent < times; sent += 1) {
      clock.mockReturnValue(now + sent * gap);

      const next = typeof signal === 'string' ? signal : signal[sent];

      process.emit(next, next);
      await pause(5);
    }

    clock.mockRestore();
    whileWaiting = written().replace(before, '');
    // Si se tiene que esperar la respuesta, no hace falta demorarla.
    await (gap * (times - 1) >= REPEATED_SIGNAL_MS ? Promise.race([pause(ANSWER_MS), finished]) : pause(0));
    answered = true;
  }

  const result = await run({
    onArcaCall: async (name) => {
      seen += name === method ? 1 : 0;

      if (name === method && seen === call) {
        waiting = sendSignals();
        await waiting;
      }
    },
  });
  const answeredAtEnd = answered;

  finish();

  const atEnd = written();

  // Lo que ARCA conteste tarde no escribe nada ni queda como un rechazo sin atender.
  await waiting;
  await pause(5);
  expect(waiting, 'la señal nunca se mandó').toBeDefined();
  expect(written()).toBe(atEnd);

  return { ...result, answered: answeredAtEnd, exit: result.events.at(-1) ?? '', whileWaiting };
}

/** Un lote de facturas C por `--cargar ... --emitir`. */
const runBatch = (interruption: Interruption, options: RunOptions = {}, count = 3) =>
  interrupt(interruption, (hook) => runBilling(['--cargar', batch(count), '--emitir'], { ...options, ...hook }));

const details = (run: Run) => (JSON.parse(run.stderr) as { detalles: Record<string, unknown> }).detalles;

const plainText = (text: string) => text.replace(/[│┃║╏\s]+/g, ' ');

const sent = (run: Run) => run.events.filter((text) => /^ARCA (createVoucher|authorize)/.test(text));

useEmissionSequence();

beforeEach(() => {
  Object.assign(signals, listeners());
  // Tras la segunda señal el comando puede volver a mandársela a sí mismo: acá no tiene que matar al worker.
  vi.spyOn(process, 'kill').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('un lote, una señal', () => {
  it.each(['SIGINT', 'SIGTERM'] as const)('%s en el 2.º, --json: 2 CAE y el 3.º sin procesar', async (signal) => {
    const run = await runBatch({ call: 2, signal, times: 1 }, { json: true });

    expect(emissionCalls(run)).toEqual([
      'ARCA getNextVoucherNumber',
      'ARCA createVoucher 42 por 1000',
      'ARCA getNextVoucherNumber',
      'ARCA createVoucher 43 por 2000',
    ]);
    expect((JSON.parse(run.stdout) as Array<{ cae: string }>).map(({ cae }) => cae)).toEqual([
      '75123456789012',
      '75123456789012',
    ]);
    expect(JSON.parse(run.stderr)).toMatchObject({
      codigo: 'BATCH_EMISSION_ERROR',
      detalles: { codigoCausa: 'CANCELLED', procesados: 2, sinProcesar: [3], total: 3 },
    });
    expect(details(run)).not.toHaveProperty('sinConfirmar');
    expect(run.exit).toBe('fin: exit 1');
  });

  it('en el 2.º, en texto: los 2 CAE, qué falta y que no se vuelvan a cargar', async () => {
    const run = await runBatch({ call: 2, times: 1 });

    expect(sent(run)).toHaveLength(2);
    expect(run.stdout.match(CAE)).toHaveLength(2);
    expect(run.stderr).toContain('Procesados: 2 de 3.');
    expect(run.stderr).toContain('Sin procesar: #3.');
    expect(plainText(run.stderr)).toContain('Los procesados con CAE ya se emitieron');
    expect(run.exit).toBe('fin: exit 1');
  });

  it('en el 2.º, que ARCA rechaza: se entrega el rechazo y no sigue', async () => {
    const run = await runBatch({ call: 2, times: 1 }, { arca: ['A', 'R'], json: true });

    expect(sent(run)).toHaveLength(2);
    expect((JSON.parse(run.stdout) as Array<{ estado: string }>).map(({ estado }) => estado)).toEqual([
      'aprobado',
      'rechazado',
    ]);
    expect(details(run)).toMatchObject({ codigoCausa: 'CANCELLED', procesados: 2, sinProcesar: [3] });
  });

  it('en el 2.º, que no se puede confirmar: queda sin confirmar, como siempre', async () => {
    const run = await runBatch({ call: 2, times: 1 }, { arca: ['A', 'incierta'], json: true });

    expect(sent(run)).toHaveLength(2);
    expect(details(run)).toMatchObject({ procesados: 1, sinConfirmar: 2, sinProcesar: [3] });
    expect(run.exit).toBe('fin: exit 1');
  });

  it('al pedir el número del 2.º, que todavía no se envió: no se envía', async () => {
    const run = await runBatch({ call: 2, method: 'getNextVoucherNumber', times: 1 }, { json: true });

    expect(sent(run)).toEqual(['ARCA createVoucher 42 por 1000']);
    expect(JSON.parse(run.stdout)).toHaveLength(1);
    expect(details(run)).toMatchObject({ codigoCausa: 'CANCELLED', procesados: 1, sinProcesar: [2, 3] });
    expect(details(run)).not.toHaveProperty('sinConfirmar');
    expect(run.exit).toBe('fin: exit 1');
  });

  // No quedó nada pendiente: la salida y el exit code de siempre.
  it.each([
    ['A', 0],
    ['R', 2],
  ] as const)('en el último, que ARCA contesta %s: se entregan todos y sale con %i, sin error', async (step, exit) => {
    const run = await runBatch({ call: 3, times: 1 }, { arca: ['A', 'A', step], json: true });

    expect(sent(run)).toHaveLength(3);
    expect(JSON.parse(run.stdout)).toHaveLength(3);
    expect(run.stderr).toBe('');
    expect(run.exit).toBe(`fin: exit ${exit}`);
  });

  it('en un lote mixto: el que falta emitir no se envía', async () => {
    const path = batch(3, (position) => ({ emitir: position !== 1 }));
    const run = await interrupt({ times: 1 }, (hook) => runBilling(['--cargar', path], { ...hook, json: true }));

    expect(sent(run)).toEqual(['ARCA createVoucher 42 por 1000']);
  });
});

describe('un lote, dos señales', () => {
  it('en el 2.º, --json: 1 CAE, el 2.º sin confirmar y el 3.º sin procesar, sin esperar a ARCA', async () => {
    const run = await runBatch({ call: 2, times: 2 }, { json: true });

    expect(sent(run)).toHaveLength(2);
    expect(JSON.parse(run.stdout)).toHaveLength(1);
    expect(JSON.parse(run.stdout)).toMatchObject([{ cae: '75123456789012', numero: 42 }]);
    expect(JSON.parse(run.stderr)).toMatchObject({
      codigo: 'BATCH_EMISSION_ERROR',
      detalles: { procesados: 1, sinConfirmar: 2, sinProcesar: [3], total: 3 },
    });
    expect(run.answered).toBe(false);
  });

  it('en el 2.º, en texto: el 1.º con su CAE y con qué verificar el 2.º, que nunca se da por no emitido', async () => {
    const run = await runBatch({ call: 2, times: 2 });
    const error = plainText(run.stderr);

    expect(run.stdout.match(CAE)).toHaveLength(1);
    expect(error).toContain('El #2 puede haberse emitido');
    expect(error).toContain('arcli ultimos fc --pv 3 --testing');
    expect(error).toContain('Sin procesar: #3.');
    expect(plainText(run.stdout) + error).not.toMatch(DENIED);
  });

  it('cinco señales seguidas en el 2.º: lo mismo, una sola vez', async () => {
    const run = await runBatch({ call: 2, times: 5 }, { json: true });

    expect(sent(run)).toHaveLength(2);
    expect(JSON.parse(run.stdout)).toHaveLength(1);
    expect(details(run)).toMatchObject({ procesados: 1, sinConfirmar: 2, sinProcesar: [3] });
    expect(run.answered).toBe(false);
  });

  it('al pedir el número del 2.º: no se envió, así que no queda sin confirmar', async () => {
    const run = await runBatch({ call: 2, method: 'getNextVoucherNumber', times: 2 }, { json: true });

    expect(sent(run)).toHaveLength(1);
    expect(JSON.parse(run.stdout)).toHaveLength(1);
    expect(details(run)).toMatchObject({ codigoCausa: 'CANCELLED', procesados: 1, sinProcesar: [2, 3] });
    expect(details(run)).not.toHaveProperty('sinConfirmar');
  });

  it('en un lote de uno: nada procesado, el único sin confirmar', async () => {
    const run = await runBatch({ times: 2 }, { json: true }, 1);

    expect(sent(run)).toHaveLength(1);
    expect(run.stdout).toBe('');
    expect(details(run)).toMatchObject({ procesados: 0, sinConfirmar: 1, sinProcesar: [], total: 1 });
  });
});

const CLIENT = ['--cs', '--cuit', String(CLIENT_CUIT), '--ir-ri'];
const billing =
  (shortcut: VoucherShortcut, args: readonly string[], issued?: Parameters<typeof runBilling>[1]) =>
  (options: RunOptions): Promise<Run> =>
    runBilling([...args, '--emitir'], { ...options, ...issued, shortcut });
const exporting =
  (args: readonly string[], kind?: typeof EXPORT_CREDIT_NOTE_KIND | typeof EXPORT_DEBIT_NOTE_KIND) =>
  (options: RunOptions): Promise<Run> =>
    runExport([...args, '--emitir'], { ...options, kind });

/** Una de cada familia, con la llamada que emite y con qué se verifica. */
const FAMILIES = [
  ['fa', 'createVoucher', billing('fa', ['-m', '1000', ...CLIENT]), 'arcli ultimos fa --pv 3 --testing'],
  ['fb', 'createVoucher', billing('fb', FC), 'arcli ultimos fb --pv 3 --testing'],
  ['fc', 'createVoucher', billing('fc', FC), 'arcli ultimos fc --pv 3 --testing'],
  ['rc', 'createVoucher', billing('rc', FC), 'arcli ultimos rc --pv 3 --testing'],
  [
    'ncc',
    'createVoucher',
    billing('ncc', [...FC, '--ac', 'fc', '--apv', '3', '--ar', '12']),
    'arcli ultimos ncc --pv 3 --testing',
  ],
  [
    'ncea',
    'createVoucher',
    billing('ncea', ['-m', '1000', ...CLIENT, '--ac', 'fcea', '--apv', '3', '--ar', '12', '--anulacion'], {
      issued: { documentNumber: CLIENT_CUIT, documentTypeCode: 80 },
    }),
    'arcli ultimos ncea --pv 3 --testing',
  ],
  ['fe', 'authorize', exporting(FE), 'arcli consultar fe 42 --pv 3 --testing'],
  ['nde', 'authorize', exporting(E_NOTE, EXPORT_DEBIT_NOTE_KIND), 'arcli consultar nde 42 --pv 3 --testing'],
  ['nce', 'authorize', exporting(E_NOTE, EXPORT_CREDIT_NOTE_KIND), 'arcli consultar nce 42 --pv 3 --testing'],
] as const;

describe.each(FAMILIES)('un comprobante (%s)', (_shortcut, method, run, verifyCommand) => {
  // No quedó nada pendiente: la salida y el exit code de siempre (0 aprobado, 2 rechazado).
  it.each(['A', 'R'] as const)('una señal y ARCA contesta %s: su resultado de siempre', async (step) => {
    const normal = await run({ arca: [step], json: true });
    const interrupted = await interrupt({ method, times: 1 }, (hook) => run({ ...hook, arca: [step], json: true }));

    expect(sent(normal)).toHaveLength(1);
    expect(sent(interrupted)).toEqual(sent(normal));
    expect(interrupted.stdout).toBe(normal.stdout);
    expect(interrupted.stderr).toBe(normal.stderr);
    expect(interrupted.exit).toBe(step === 'A' ? 'fin: exit 0' : 'fin: exit 2');
  });

  it('una señal y la respuesta se pierde: sin confirmar, como siempre', async () => {
    const interrupted = await interrupt({ method, times: 1 }, (hook) =>
      run({ ...hook, arca: ['incierta'], json: true }),
    );

    expect(sent(interrupted)).toHaveLength(1);
    expect(JSON.parse(interrupted.stderr)).toMatchObject({
      codigo: 'EMISSION_UNCERTAIN',
      sugerencia: expect.stringContaining(verifyCommand),
    });
    expect(interrupted.exit).toBe('fin: exit 1');
  });

  it('una señal, en texto: avisa enseguida que espera la respuesta, sin dar nada por no emitido', async () => {
    const interrupted = await interrupt({ method, times: 1 }, run);

    expect(sent(interrupted)).toHaveLength(1);
    expect(interrupted.whileWaiting).toMatch(/esper/i);
    expect(plainText(interrupted.stdout + interrupted.stderr)).not.toMatch(DENIED);
    expect(interrupted.stdout.match(CAE)).toHaveLength(1);
    expect(interrupted.exit).toBe('fin: exit 0');
  });

  it('una señal, con --json: no escribe ningún aviso intermedio', async () => {
    const interrupted = await interrupt({ method, times: 1 }, (hook) => run({ ...hook, json: true }));

    expect(interrupted.whileWaiting).toBe('');
  });

  it.each(['A', 'incierta'] as const)('dos señales: no se sabe, aunque después ARCA conteste %s', async (step) => {
    const interrupted = await interrupt({ method, times: 2 }, (hook) => run({ ...hook, arca: [step], json: true }));

    expect(sent(interrupted)).toHaveLength(1);
    expect(interrupted.answered).toBe(false);
    expect(interrupted.stdout).toBe('');
    expect(JSON.parse(interrupted.stderr)).toMatchObject({
      codigo: 'EMISSION_UNCERTAIN',
      sugerencia: expect.stringContaining(verifyCommand),
    });
    expect(interrupted.stderr).not.toMatch(DENIED);
  });
});

describe('quién escucha las señales', () => {
  it.each([
    ['aprobado', 'A', 0],
    ['rechazado', 'R', 0],
    ['sin confirmar', 'incierta', 0],
    ['aprobado tras una señal', 'A', 1],
    ['sin confirmar tras una señal', 'incierta', 1],
    ['tras dos señales', 'A', 2],
  ] as const)('%s: al terminar, los mismos que antes', async (_name, step, times) => {
    for (const [method, run] of [
      ['createVoucher', billing('fc', FC)],
      ['authorize', exporting(FE)],
    ] as const) {
      await interrupt({ method, times }, (hook) => run({ ...hook, arca: [step] }));
      expect(listeners()).toEqual(signals);
    }
  });

  it('si falla el número, los mismos que antes', async () => {
    await runBilling([...FC, '--emitir'], { arca: ['sin numero'] });

    expect(listeners()).toEqual(signals);
  });

  it.each([
    ['fc', (options: RunOptions) => runBilling(FC, options)],
    ['fe', (options: RunOptions) => runExport(FE, options)],
  ] as const)('%s: ni consultando, ni en las preguntas, ni con el PDF, los mismos que antes', async (_name, run) => {
    const seen: Array<readonly [string, ReturnType<typeof listeners>]> = [];

    await run({
      answers: [EMIT_WITH_PDF],
      onEvent: (text) => {
        seen.push([text, listeners()]);
      },
      tty: true,
    });

    // En A, B y C el número se pide dentro de la emisión; en la E, antes.
    const outside = seen.filter(([text]) => !/createVoucher|authorize|getNextVoucherNumber/.test(text));

    expect(outside.map(([text]) => text)).toEqual(
      expect.arrayContaining([expect.stringContaining('¿Emitimos'), 'PDF generar 42']),
    );
    expect(outside).toEqual(outside.map(([text]) => [text, signals]));
  });

  it.each([
    ['fc', /createVoucher/, billing('fc', FC)],
    ['fe', /authorize/, exporting(FE)],
  ] as const)('%s: mientras se emite, se escuchan las dos y los de otros se apartan', async (_name, call, run) => {
    let whileEmitting = { ...signals };

    await run({
      onEvent: (text) => {
        whileEmitting = call.test(text) ? listeners() : whileEmitting;
      },
    });

    expect(whileEmitting).toEqual({ SIGINT: 1, SIGTERM: 1 });
  });
});

it.each([1, 2])(
  'con %i señales la llamada que emite recibe solo el comprobante: nada con que cancelarla',
  async (times) => {
    const received: Array<readonly unknown[]> = [];

    for (const [emits, run] of [
      ['createVoucher', billing('fc', FC)],
      ['authorize', exporting(FE)],
    ] as const) {
      await interrupt({ method: emits, times }, ({ onArcaCall }) =>
        run({
          onArcaCall: async (method, args) => {
            if (method === emits) {
              received.push(args);
            }

            await onArcaCall?.(method, args);
          },
        }),
      );
    }

    expect(received.map((args) => args.length)).toEqual([1, 1]);
    expect(received.flatMap(([payload]) => Object.values(payload as object))).not.toContainEqual(
      expect.any(AbortSignal),
    );
  },
);

const errorText = (run: Run) => (JSON.parse(run.stderr) as { error: string }).error;

describe('lo que se dice de un lote cortado', () => {
  it('una señal: primero lo emitido, después lo que falta', async () => {
    const run = await runBatch({ call: 2, times: 1 }, { json: true }, 5);

    expect(errorText(run)).toBe(
      'Cortaste el lote con Ctrl+C.\nYa se emitieron: #1 y #2.\nProcesados: 2 de 5.\nSin procesar: #3 a #5 (3).',
    );
    expect(details(run)).toEqual({
      codigoCausa: 'CANCELLED',
      fallo: 3,
      procesados: 2,
      sinProcesar: [3, 4, 5],
      total: 5,
    });
  });

  it('dos señales: el que no se esperó, con su número y la causa', async () => {
    const run = await runBatch({ call: 2, times: 2 }, { json: true });

    expect(errorText(run)).toBe(
      'Cortaste el lote con Ctrl+C.\nYa se emitió: #1.\nProcesados: 1 de 3.\nSin procesar: #3.\nEl #2 puede haberse emitido: verificalo con `arcli ultimos fc --pv 3 --testing` antes de reintentarlo.',
    );
    expect(details(run)).toEqual({
      codigoCausa: 'EMISSION_UNCERTAIN',
      fallo: 2,
      numero: 43,
      procesados: 1,
      sinConfirmar: 2,
      sinProcesar: [3],
      total: 3,
    });
  });

  it('SIGTERM: no habla de Ctrl+C, tampoco en el aviso', async () => {
    const run = await runBatch({ call: 2, signal: 'SIGTERM', times: 1 });

    expect(run.whileWaiting).toMatch(/esper/i);
    expect(plainText(run.stderr)).toContain('Se cortó el lote. Ya se emitieron: #1 y #2.');
    expect(run.stderr).not.toContain('Ctrl+C');
  });

  it('con solo un rechazado, no dice que se emitió', async () => {
    const run = await runBatch({ call: 1, times: 1 }, { arca: ['R'], json: true });

    expect(details(run)).toMatchObject({ procesados: 1, sinProcesar: [2, 3] });
    expect(run.stderr).not.toMatch(/ya se emiti/i);
    expect(JSON.parse(run.stderr)).toMatchObject({
      sugerencia: 'No se emitió ninguno: podés reintentar los que quedaron sin procesar.',
    });
  });

  it('en un lote mixto, la vista previa ya procesada no cuenta como emitida y la pendiente queda sin procesar', async () => {
    const path = batch(4, (position) => ({ emitir: position === 1 }));
    const run = await interrupt({ times: 1 }, (hook) => runBilling(['--cargar', path], { ...hook, json: true }));

    expect(errorText(run)).toContain('Ya se emitió: #2.\nProcesados: 2 de 4.\nSin procesar: #3, #4.');
    expect(details(run)).toMatchObject({ codigoCausa: 'CANCELLED', fallo: 3, sinProcesar: [3, 4] });
    expect(run.exit).toBe('fin: exit 1');
  });
});

describe('por qué señal se corta', () => {
  it('con una y la respuesta, por ninguna', async () => {
    await runBatch({ call: 2, times: 1 });

    expect(process.kill).not.toHaveBeenCalled();
  });

  it('SIGTERM y después SIGINT: por la última, una vez, con los listeners de siempre', async () => {
    let atKill = { SIGINT: -1, SIGTERM: -1 };

    vi.mocked(process.kill).mockImplementation(() => {
      atKill = listeners();

      return true;
    });

    const run = await runBatch({ call: 2, signal: ['SIGTERM', 'SIGINT'], times: 2 }, { json: true });

    expect(details(run)).toMatchObject({ sinConfirmar: 2 });
    expect(errorText(run)).toContain('Se cortó el lote.');
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(process.pid, 'SIGINT');
    expect(atKill).toEqual(signals);
  });

  it.each(['SIGINT', 'SIGTERM'] as const)(
    'sin nada enviado, la primera (%s) corta como siempre: sin salida, aunque ARCA dé el número',
    async (signal) => {
      for (const json of [false, true]) {
        vi.mocked(process.kill).mockClear();

        const run = await runBatch({ method: 'getNextVoucherNumber', signal, times: 1 }, { json });

        expect(process.kill).toHaveBeenCalledExactlyOnceWith(process.pid, signal);
        expect(sent(run)).toEqual([]);
        expect([run.stdout, run.stderr]).toEqual(['', '']);
        expect(run.exit).toBe(`fin: exit ${signal === 'SIGINT' ? 130 : 143}`);
      }
    },
  );
});

it('un listener de otro que reenvía la señal, como el de when-exit, no cuenta como la segunda', async () => {
  const resend = vi.fn(() => process.emit('SIGINT', 'SIGINT'));

  process.once('SIGINT', resend);

  try {
    const run = await runBatch({ call: 2, times: 1 }, { json: true });

    expect(details(run)).toMatchObject({ codigoCausa: 'CANCELLED', procesados: 2 });
    expect(resend).not.toHaveBeenCalled();
    expect(process.listeners('SIGINT')).toContain(resend);
  } finally {
    process.off('SIGINT', resend);
  }
});

it('tras dos señales no se genera ningún PDF: sale como no generado, con su CAE', async () => {
  const run = await runBatch({ call: 2, times: 2 }, { config: { pdf: 'siempre' }, json: true });

  expect(run.events.filter((text) => text.startsWith('PDF'))).toEqual([]);
  expect(JSON.parse(run.stdout)).toMatchObject([
    {
      cae: '75123456789012',
      pdf: { error: { codigo: 'PDF_GENERATION_ERROR', mensaje: 'Se cortó antes de generar el PDF.' } },
    },
  ]);
});

describe('la misma señal dos veces, como llega con npx', () => {
  it.each([
    ['dos SIGINT', 5, 'SIGINT', 2],
    ['dos SIGINT, justo antes del límite', REPEATED_SIGNAL_MS - 1, 'SIGINT', 2],
    ['una de cada una', 5, ['SIGTERM', 'SIGINT'], 2],
    ['cinco seguidas', 5, 'SIGINT', 5],
  ] as const)('%s: sigue esperando y entrega el CAE', async (_name, gap, signal, times) => {
    const run = await runBatch({ call: 2, gap, signal, times }, { json: true });

    expect(JSON.parse(run.stdout)).toHaveLength(2);
    expect(details(run)).toMatchObject({ codigoCausa: 'CANCELLED', procesados: 2, sinProcesar: [3] });
    expect(run.answered).toBe(true);
    expect(process.kill).not.toHaveBeenCalled();
  });

  it('en texto, un solo aviso', async () => {
    const run = await interrupt({ gap: 5, times: 2 }, (hook) => runBilling([...FC, '--emitir'], hook));

    expect(run.whileWaiting.match(/esperamos/gi)).toHaveLength(1);
    expect(run.exit).toBe('fin: exit 0');
  });

  it('después, otra de verdad corta: se cuenta desde la primera', async () => {
    const run = await runBatch({ call: 2, gap: REPEATED_SIGNAL_MS / 2, times: 3 }, { json: true });

    expect(details(run)).toMatchObject({ sinConfirmar: 2 });
    expect(run.answered).toBe(false);
  });
});
