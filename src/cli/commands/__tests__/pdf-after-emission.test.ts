import { describe, expect, it, vi } from 'vitest';

import {
  batch,
  FC,
  FE,
  INSTALL,
  MAKE_PDF,
  type Run,
  runBilling,
  runExport,
  type RunOptions,
  useEmissionSequence,
} from './emission-sequence.fixture';

/**
 * El comprobante ya está emitido: un PDF que falla, o su pregunta cancelada, no cambia el resultado ni el exit code
 * (REV-50 y REV-51). Por los dos comandos, en texto y con `--json`.
 */
vi.mock('../../spinner', () => ({ startSpinner: () => null }));
vi.mock('../../interactive/list-select', () => ({ listSelect: vi.fn() }));

useEmissionSequence();

const ASK = { pdf: 'preguntar' };
const ALWAYS = { pdf: 'siempre' };
/** Un archivo donde va la carpeta: no se puede crear. */
const blockedFolder = () => ({ ...ALWAYS, pdfCarpeta: batch(1) });

type Case = readonly [name: string, options: () => RunOptions];

/** Sin nadie que responda: pasa en texto y con `--json`. */
const FAILURES: readonly Case[] = [
  ['falta el componente', () => ({ config: ALWAYS, pluginInstalled: false, pdfFailure: 'cargar' })],
  ['el componente no carga', () => ({ config: ALWAYS, pdfFailure: 'cargar' })],
  ['falla al generarlo', () => ({ config: ALWAYS, pdfFailure: 'generar' })],
  ['faltan los datos del emisor', () => ({ config: { ...ALWAYS, emisor: {} } })],
  ['no se puede escribir en la carpeta', () => ({ config: blockedFolder() })],
];

const QUESTIONS: readonly Case[] = [
  ...(['No', 'Esc', 'Ctrl+C'].flatMap((answer) => [
    [`${answer} en la pregunta del PDF`, () => ({ answers: [answer], config: ASK, tty: true })],
    [
      `${answer} al instalar el componente`,
      () => ({ answers: [answer], config: ALWAYS, pluginInstalled: false, tty: true }),
    ],
    [
      `Sí al PDF y ${answer} al instalar`,
      () => ({ answers: [MAKE_PDF, answer], config: ASK, pluginInstalled: false, tty: true }),
    ],
  ]) as Case[]),
  [
    'falla la instalación',
    () => ({ answers: [INSTALL], config: ALWAYS, pdfFailure: 'instalar', pluginInstalled: false, tty: true }),
  ],
];

const COMMANDS: ReadonlyArray<
  readonly [name: string, run: (options: RunOptions) => Promise<Run>, emission: readonly unknown[], document: string]
> = [
  [
    'A, B y C',
    (options) => runBilling([...FC, '--emitir'], options),
    ['ARCA createVoucher 42 por 1000', expect.stringContaining('anotado: fc del punto de venta 3, 42')],
    'JSON aprobado 42 PDF no generado',
  ],
  [
    'E',
    (options) => runExport([...FE, '--emitir'], options),
    ['ARCA authorize 42 por 1500', expect.stringContaining('anotado: fe del punto de venta 3, 42')],
    'JSON aprobado 42 PDF no generado',
  ],
];

const outputs = ({ events }: Run) => events.filter((text) => /^(salida|stderr): /.test(text)).join(', ');

/** Sin lo que queda anotado para el aviso de la salida cortada: eso es de `missing-pdf.test.ts`. */
const withoutNotes = ({ events }: Run) => events.filter((text) => !text.startsWith('anotado: '));

describe.each(COMMANDS)('%s', (_command, run, emission, document) => {
  it.each(FAILURES)('en texto, %s: el CAE, el aviso del PDF y exit 0', async (_name, options) => {
    const result = await run(options());

    expect(result.events).toEqual(expect.arrayContaining([...emission, 'fin: exit 0']));
    expect(outputs(result)).toMatch(/^salida: CAE, (salida: )?PDF no generado$/);
  });

  it.each(FAILURES)('con --json, %s: el mismo resultado, con `pdf.error`, y exit 0', async (_name, options) => {
    const withoutPdf = JSON.parse((await run({ json: true })).stdout) as Record<string, unknown>;
    const result = await run({ ...options(), json: true });

    expect(result.events).toEqual(expect.arrayContaining([...emission, `salida: ${document}`, 'fin: exit 0']));
    expect(JSON.parse(result.stdout)).toEqual({
      ...withoutPdf,
      pdf: { error: expect.objectContaining({ codigo: expect.stringMatching(/^(CONFIG|INPUT|PDF)_/) }) },
    });
  });

  it.each(QUESTIONS)('%s: el CAE y exit 0', async (_name, options) => {
    const result = await run(options());

    expect(result.events).toEqual(expect.arrayContaining([...emission, 'fin: exit 0']));
    expect(outputs(result)).toMatch(/^salida: CAE(, (salida: )?PDF no generado)?$/);
    expect(result.events.filter((text) => text.startsWith('PDF generar'))).toEqual([]);
  });

  it('con --json no pregunta ni instala, aunque haya una terminal', async () => {
    const result = await run({ config: ASK, json: true, pluginInstalled: false, tty: true });

    expect(outputs(result)).toBe('salida: JSON aprobado 42');
    expect(result.events.filter((text) => /^(pregunta|PDF)/.test(text))).toEqual([]);
  });
});

describe('un lote', () => {
  it('el PDF de uno falla: los demás salen igual', async () => {
    const result = await runBilling(['--cargar', batch(2), '--emitir'], { config: ALWAYS, pdfFailure: 'generar 42' });

    expect(withoutNotes(result).slice(-6)).toEqual([
      'salida: CAE, CAE',
      'PDF cargar',
      'PDF generar 42',
      'PDF generar 43',
      'salida: PDF no generado, PDF guardado',
      'fin: exit 0',
    ]);
  });

  it('con un rechazado sigue en exit 2', async () => {
    const { events } = await runBilling(['--cargar', batch(2), '--emitir'], {
      arca: ['A', 'R'],
      config: ALWAYS,
      pdfFailure: 'generar',
    });

    expect(events).toContain('salida: CAE, rechazado');
    expect(events.at(-1)).toBe('fin: exit 2');
  });

  it('cortado: el error es el del lote', async () => {
    const { events } = await runBilling(['--cargar', batch(2), '--emitir'], {
      arca: ['A', 'incierta'],
      config: ALWAYS,
      pdfFailure: 'generar',
    });

    expect(events.slice(-2)).toEqual(['error: BATCH_EMISSION_ERROR', 'fin: exit 1']);
  });
});
