import { existsSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EXPORT_CREDIT_NOTE_KIND, EXPORT_DEBIT_NOTE_KIND } from '../../../modules/export/export.kinds';
import { REPEATED_SIGNAL_MS } from '../../interruption';

import {
  batch,
  CLIENT_CUIT,
  E_NOTE,
  EMIT_WITH_PDF,
  FC,
  FE,
  INSTALL,
  INSTALL_QUESTION,
  MAKE_PDF,
  PDF_QUESTION,
  type Run,
  runBilling,
  runExport,
  type RunOptions,
  useEmissionSequence,
} from './emission-sequence.fixture';

/**
 * ARQ-11: Ctrl+C (o SIGTERM) mientras se genera o instala el PDF de algo ya emitido, por el comando real, con un ARCA y
 * un plugin falsos. Nada se queda esperando: si el comando no corta, el paso termina solo a los `STEP_MS`.
 */
vi.mock('../../spinner', () => ({ startSpinner: () => null }));
vi.mock('../../interactive/list-select', () => ({ listSelect: vi.fn() }));

const STEP_MS = 1500;
const CAE = '75123456789012';
const CUT = {
  error: { codigo: 'PDF_GENERATION_ERROR', mensaje: 'Se cortó antes de generar el PDF.', sugerencia: null },
};

type Signal = 'SIGINT' | 'SIGTERM';

interface Item {
  readonly cae: string;
  readonly pdf?: { readonly error?: unknown; readonly ruta?: string };
}

interface CutRun extends Run {
  readonly exit: string;
}

interface Cut {
  /** Cuánto pasa entre una señal y la otra. Por defecto, lo justo para que cuenten por separado. */
  readonly gap?: number;
  readonly signals: readonly Signal[];
  readonly step?: string;
}

const listeners = () => ({ SIGINT: process.listenerCount('SIGINT'), SIGTERM: process.listenerCount('SIGTERM') });

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

let signals = listeners();

/** Todas antes de que se escriba el resultado: sin turnos en el medio. */
function send(sent: readonly Signal[], gap: number): void {
  const now = Math.floor(performance.now());
  const clock = vi.spyOn(performance, 'now');

  sent.forEach((signal, index) => {
    clock.mockReturnValue(now + index * gap);
    process.emit(signal, signal);
  });
  clock.mockRestore();
}

/** Corre `run` y, en ese paso del PDF, manda las señales; el paso termina cuando el comando ya terminó, o solo. */
async function cut(
  { gap = REPEATED_SIGNAL_MS, signals: sent, step = 'generar 42' }: Cut,
  run: (hook: Pick<RunOptions, 'onPdfStep'>) => Promise<Run>,
): Promise<CutRun> {
  let finish: () => void = () => undefined;
  let reached = false;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const result = await run({
    onPdfStep: async (name) => {
      if (name === step) {
        reached = true;
        send(sent, gap);
        await Promise.race([pause(STEP_MS), finished]);
      }
    },
  });

  expect(reached, 'nunca llegó al paso del PDF').toBe(true);
  finish();
  // Lo que el plugin termine tarde no escribe nada.
  await pause(10);

  return { ...result, exit: result.events.at(-1) ?? '' };
}

const items = (run: Run): Item[] => [JSON.parse(run.stdout) as Item | Item[]].flat();
const generated = (run: Run): string[] => run.events.filter((text) => text.startsWith('PDF '));
const plain = (text: string): string => text.replace(/[│┃║╏╎┊▎\s]+/g, ' ');

useEmissionSequence();

beforeEach(() => {
  signals = listeners();
  vi.spyOn(process, 'kill').mockImplementation(() => true);
});

afterEach(async () => {
  // Apenas pasa el eco de npx no queda ningún listener.
  await vi.waitFor(() => expect(listeners()).toEqual(signals), { timeout: 2000 });
  vi.restoreAllMocks();
});

const CLIENT = ['--cs', '--cuit', String(CLIENT_CUIT), '--ir-ri'];
const FAMILIES = [
  ['fa', (options: RunOptions) => runBilling(['-m', '1000', ...CLIENT, '--emitir'], { ...options, shortcut: 'fa' })],
  ['fb', (options: RunOptions) => runBilling([...FC, '--emitir'], { ...options, shortcut: 'fb' })],
  ['fc', (options: RunOptions) => runBilling([...FC, '--emitir'], options)],
  ['rc', (options: RunOptions) => runBilling([...FC, '--emitir'], { ...options, shortcut: 'rc' })],
  [
    'ncc',
    (options: RunOptions) =>
      runBilling([...FC, '--ac', 'fc', '--apv', '3', '--ar', '12', '--emitir'], { ...options, shortcut: 'ncc' }),
  ],
  [
    'ncea',
    (options: RunOptions) =>
      runBilling(['-m', '1000', ...CLIENT, '--ac', 'fcea', '--apv', '3', '--ar', '12', '--anulacion', '--emitir'], {
        ...options,
        issued: { documentNumber: CLIENT_CUIT, documentTypeCode: 80 },
        shortcut: 'ncea',
      }),
  ],
  ['fe', (options: RunOptions) => runExport([...FE, '--emitir'], options)],
  ['nde', (options: RunOptions) => runExport([...E_NOTE, '--emitir'], { ...options, kind: EXPORT_DEBIT_NOTE_KIND })],
  ['nce', (options: RunOptions) => runExport([...E_NOTE, '--emitir'], { ...options, kind: EXPORT_CREDIT_NOTE_KIND })],
] as const;

describe.each(FAMILIES)('un comprobante (%s)', (_name, run) => {
  // Rojo: nadie ataja la señal, y el PDF se espera y sale con su ruta (de verdad, el proceso muere sin salida).
  it.fails.each(['SIGINT', 'SIGTERM'] as const)(
    '%s, --json: el documento completo con pdf.error y exit 0',
    async (signal) => {
      const result = await cut({ signals: [signal] }, (hook) =>
        run({ ...hook, config: { pdf: 'siempre' }, json: true }),
      );

      expect(items(result)).toHaveLength(1);
      expect(items(result)[0]).toMatchObject({ cae: CAE, pdf: CUT });
      expect(result.stderr).toBe('');
      expect(result.exit).toBe('fin: exit 0');
      expect(process.kill).not.toHaveBeenCalled();
    },
  );

  // Rojo: el PDF se espera y el aviso no sale.
  it.fails('en texto: el CAE una vez y el aviso del PDF no generado', async () => {
    const result = await cut({ signals: ['SIGINT'] }, (hook) => run({ ...hook, config: { pdf: 'siempre' } }));

    expect(result.stdout.split(CAE)).toHaveLength(2);
    expect(plain(result.stdout)).toContain('Se cortó antes de generar el PDF.');
    expect(plain(result.stdout)).toContain('El comprobante ya está emitido: solo faltó el PDF.');
    expect(result.stdout).not.toContain('arcli pdf');
    expect(result.exit).toBe('fin: exit 0');
  });
});

const runBatch = (interruption: Cut, options: RunOptions = {}) =>
  cut(interruption, (hook) =>
    runBilling(['--cargar', batch(3), '--emitir'], { ...options, ...hook, config: { pdf: 'siempre' } }),
  );

describe('un lote cortado en el 2.º PDF', () => {
  // Rojo: se generan los tres.
  it.fails('--json: el 1.º con su archivo, el 2.º y el 3.º con su error, exit 0', async () => {
    const result = await runBatch({ signals: ['SIGINT'], step: 'generar 43' }, { json: true });
    const [first, second, third] = items(result);

    expect(existsSync(first.pdf?.ruta ?? '')).toBe(true);
    expect([second.pdf, third.pdf]).toEqual([CUT, CUT]);
    expect(items(result).map(({ cae }) => cae)).toEqual([CAE, CAE, CAE]);
    expect(generated(result)).toEqual(['PDF cargar', 'PDF generar 42', 'PDF generar 43']);
    // El que se abandonó no deja un archivo que se informó como no generado.
    expect(readdirSync(dirname(first.pdf?.ruta ?? ''))).toHaveLength(1);
    expect(result.exit).toBe('fin: exit 0');
  });

  // Rojo: se generan los tres.
  it.fails('en texto: los tres CAE, una ruta y dos avisos', async () => {
    const result = await runBatch({ signals: ['SIGTERM'], step: 'generar 43' });

    expect(result.stdout.split(CAE)).toHaveLength(4);
    expect(result.stdout.match(/PDF guardado/g)).toHaveLength(1);
    expect(plain(result.stdout).match(/Se cortó antes de generar el PDF/g)).toHaveLength(2);
    expect(result.exit).toBe('fin: exit 0');
  });

  // Rojo: se generan los del 1.º y el 3.º.
  it.fails('con un rechazado: sale con 2 y sin PDF para él', async () => {
    const result = await runBatch({ signals: ['SIGINT'] }, { arca: ['A', 'R', 'A'], json: true });

    expect(items(result).map(({ pdf }) => pdf)).toEqual([CUT, undefined, CUT]);
    expect(result.exit).toBe('fin: exit 2');
  });
});

describe('un lote que ya se cortó al emitir, con PDF', () => {
  const runCut = (hook: Pick<RunOptions, 'onPdfStep'>) => {
    let calls = 0;

    return runBilling(['--cargar', batch(3), '--emitir'], {
      ...hook,
      config: { pdf: 'siempre' },
      json: true,
      onArcaCall: async (method) => {
        calls += method === 'createVoucher' ? 1 : 0;

        if (method === 'createVoucher' && calls === 2) {
          process.emit('SIGINT', 'SIGINT');
          await pause(REPEATED_SIGNAL_MS + 20);
        }
      },
    });
  };

  // Ya está en verde: es lo de #299 y no tiene que cambiar.
  it('con esa señal: los emitidos llevan su PDF', async () => {
    const result = await runCut({});

    expect(items(result).map(({ pdf }) => Boolean(pdf?.ruta))).toEqual([true, true]);
    expect(JSON.parse(result.stderr)).toMatchObject({ detalles: { codigoCausa: 'CANCELLED', sinProcesar: [3] } });
    expect(result.events.at(-1)).toBe('fin: exit 1');
  });

  // Rojo: se generan los dos.
  it.fails('con otra en el 1.er PDF: los CAE sin PDF, el error del lote y exit 1', async () => {
    const result = await cut({ signals: ['SIGINT'] }, runCut);

    expect(items(result)).toMatchObject([
      { cae: CAE, pdf: CUT },
      { cae: CAE, pdf: CUT },
    ]);
    expect(JSON.parse(result.stderr)).toMatchObject({
      codigo: 'BATCH_EMISSION_ERROR',
      detalles: { codigoCausa: 'CANCELLED', procesados: 2, sinProcesar: [3] },
    });
    expect(result.exit).toBe('fin: exit 1');
  });

  // Rojo: se generan los dos y nadie corta.
  it.fails('con dos más en los PDF: lo mismo, y después corta por la señal', async () => {
    const result = await cut({ signals: ['SIGINT', 'SIGTERM'] }, runCut);

    expect(items(result)).toMatchObject([{ pdf: CUT }, { pdf: CUT }]);
    expect(JSON.parse(result.stderr)).toMatchObject({ detalles: { codigoCausa: 'CANCELLED' } });
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(process.pid, 'SIGTERM');
  });
});

describe('más de una señal', () => {
  // Rojo: no corta con ninguna.
  it.fails.each([
    ['dos', ['SIGINT', 'SIGINT'], 'SIGINT'],
    ['SIGINT y SIGTERM', ['SIGINT', 'SIGTERM'], 'SIGTERM'],
    ['muchas', ['SIGINT', 'SIGINT', 'SIGTERM', 'SIGTERM', 'SIGTERM'], 'SIGINT'],
  ] as const)('%s: el documento completo, y recién ahí corta', async (_name, sent, by) => {
    let atKill = '';

    vi.mocked(process.kill).mockImplementation(() => {
      atKill = vi
        .mocked(process.stdout.write)
        .mock.calls.map(([chunk]) => String(chunk))
        .join('');

      return true;
    });

    const result = await cut({ signals: sent }, (hook) =>
      runBilling([...FC, '--emitir'], { ...hook, config: { pdf: 'siempre' }, json: true }),
    );

    expect(items(result)).toMatchObject([{ cae: CAE, pdf: CUT }]);
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(process.pid, by);
    expect(atKill).toBe(result.stdout);
  });

  // Rojo: no corta con ninguna.
  it.fails.each([2, 5])('%i casi juntas, como con npx, son una: exit 0', async (times) => {
    const result = await cut({ gap: 5, signals: Array.from({ length: times }, () => 'SIGINT' as const) }, (hook) =>
      runBilling([...FC, '--emitir'], { ...hook, config: { pdf: 'siempre' }, json: true }),
    );

    expect(items(result)).toMatchObject([{ cae: CAE, pdf: CUT }]);
    expect(result.exit).toBe('fin: exit 0');
    expect(process.kill).not.toHaveBeenCalled();
  });
});

describe('otra después de la que llegó mientras se esperaba a ARCA', () => {
  const runWith = async (gap: number) => {
    const clock = vi.spyOn(performance, 'now');
    const now = Math.floor(performance.now());

    clock.mockReturnValue(now);

    const result = await runBilling([...FC, '--emitir'], {
      config: { pdf: 'siempre' },
      json: true,
      onArcaCall: (method) => {
        if (method === 'createVoucher') {
          process.emit('SIGINT', 'SIGINT');
        }
      },
      onPdfStep: () => {
        clock.mockReturnValue(now + gap);
        process.emit('SIGINT', 'SIGINT');

        return pause(20);
      },
    });

    clock.mockRestore();

    return result;
  };

  // Ya está en verde: sin nadie que ataje, la simulada no hace nada. Con señales de verdad, en el e2e.
  it('a 5 ms es el eco de npx: el PDF se genera', async () => {
    expect(items(await runWith(5))[0].pdf?.ruta).toBeDefined();
    expect(process.kill).not.toHaveBeenCalled();
  });

  // Rojo: el PDF se genera.
  it.fails('a medio segundo ya es otra: no se espera', async () => {
    expect(items(await runWith(REPEATED_SIGNAL_MS))[0].pdf).toEqual(CUT);
  });
});

// Rojo: se genera.
it.fails('justo después de la respuesta de ARCA, antes del PDF: no se genera', async () => {
  const result = await runBilling([...FC, '--emitir'], {
    config: { pdf: 'siempre' },
    json: true,
    onEvent: (text) => {
      if (text === 'PDF cargar') {
        process.emit('SIGINT', 'SIGINT');
      }
    },
  });

  expect(items(result)).toMatchObject([{ cae: CAE, pdf: CUT }]);
  expect(generated(result)).toEqual(['PDF cargar']);
  expect(result.events.at(-1)).toBe('fin: exit 0');
});

describe.each([
  ['fc', (options: RunOptions) => runBilling([...FC, '--emitir'], options)],
  ['fe', (options: RunOptions) => runExport([...FE, '--emitir'], options)],
] as const)('instalando el plugin (%s)', (_name, run) => {
  // Rojo: se instala y se genera.
  it.fails('no se espera: el CAE y el aviso, sin generar', async () => {
    const result = await cut({ signals: ['SIGINT'], step: 'instalar' }, (hook) =>
      run({ ...hook, answers: [INSTALL], config: { pdf: 'siempre' }, pluginInstalled: false, tty: true }),
    );

    expect(generated(result)).toEqual(['PDF instalar']);
    expect(plain(result.stdout)).toContain('Se cortó antes de generar el PDF.');
    expect(result.exit).toBe('fin: exit 0');
  });

  // Ya está en verde: en las preguntas no cambia nada.
  it('las preguntas del PDF: nadie ataja, y Ctrl+C sigue siendo "No"', async () => {
    const seen: Array<readonly [string, ReturnType<typeof listeners>]> = [];
    const result = await run({
      answers: [MAKE_PDF, 'Ctrl+C'],
      config: { pdf: 'preguntar' },
      onEvent: (text) => {
        seen.push([text, listeners()]);
      },
      pluginInstalled: false,
      tty: true,
    });

    expect(seen.filter(([text]) => text.startsWith('pregunta'))).toEqual([
      [PDF_QUESTION, signals],
      [INSTALL_QUESTION, signals],
    ]);
    expect(plain(result.stdout)).toContain('No se instaló el plugin de PDF.');
    expect(result.events.at(-1)).toBe('fin: exit 0');
  });
});

// Rojo: con el PDF nadie escucha.
it.fails.each([
  ['fc', (options: RunOptions) => runBilling(FC, options)],
  ['fe', (options: RunOptions) => runExport(FE, options)],
] as const)('%s: mientras se genera se escuchan las dos, y al terminar los mismos que antes', async (_name, run) => {
  let generating = { ...signals };

  await run({
    answers: [EMIT_WITH_PDF],
    onEvent: (text) => {
      generating = text === 'PDF generar 42' ? listeners() : generating;
    },
    tty: true,
  });

  expect(generating).toEqual({ SIGINT: 1, SIGTERM: 1 });
  expect(listeners()).toEqual(signals);
});
