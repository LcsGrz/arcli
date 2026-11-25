import { describe, expect, it, vi } from 'vitest';

import type { VoucherShortcut } from '../../../modules/billing/billing.types';
import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
} from '../../../modules/export/export.types';
import { stripAnsi } from '../../../ui';
import { reportOutputFailure } from '../../error-output';

import {
  batch,
  CLIENT_CUIT,
  DO_NOT_EMIT,
  E_NOTE,
  EMIT_WITH_PDF,
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
 * El PDF elegido que falla queda anotado, y si la salida se corta el aviso lo dice, como en el asistente (REV-54, item
 * 11). Lo que se ve sin salida cortada no cambia: eso está en `pdf-after-emission.test.ts`.
 */
vi.mock('../../spinner', () => ({ startSpinner: () => null }));
vi.mock('../../interactive/list-select', () => ({ listSelect: vi.fn() }));

useEmissionSequence();

const ASK = { pdf: 'preguntar' };
const ALWAYS = { pdf: 'siempre' };
const BROKEN: RunOptions = { config: ALWAYS, pdfFailure: 'generar' };

const CLIENT = ['--cs', '--cuit', String(CLIENT_CUIT), '--ir-ri'];

/** El aviso si no se pudo escribir stdout (disco lleno), con lo anotado en la última corrida. */
function lostOutputNotice(json = false): string {
  const write = vi.mocked(process.stderr.write);
  const original = write.getMockImplementation();
  let written = '';

  write.mockImplementation((chunk) => {
    written += String(chunk);

    return true;
  });

  try {
    reportOutputFailure(new Map([['stdout', Object.assign(new Error('write'), { code: 'ENOSPC' })]]), {
      commandError: undefined,
      json,
    });
  } finally {
    write.mockImplementation(original ?? (() => true));
  }

  return json
    ? String((JSON.parse(written) as { sugerencia: unknown }).sugerencia)
    : stripAnsi(written).replace(/[│┃║╏╎┊▎\s]+/g, ' ');
}

const notes = ({ events }: Run) => events.filter((text) => text.startsWith('anotado: '));

interface Family {
  /** Los flags del comprobante, sin los de la emisión. */
  readonly args: readonly string[];
  readonly run: (args: readonly string[], options: RunOptions) => Promise<Run>;
  readonly shortcut: string;
}

const billing = (shortcut: VoucherShortcut, args: readonly string[]): Family => ({
  args,
  run: (flags, options) => runBilling(flags, { ...options, shortcut }),
  shortcut,
});

const FAMILIES: readonly Family[] = [
  billing('fa', ['-m', '1000', ...CLIENT]),
  billing('fb', FC),
  billing('fc', FC),
  billing('fcea', ['-m', '5000000', ...CLIENT, '--cbu', '0110599520000012345678']),
  billing('rc', FC),
  billing('ncc', [...FC, '--ac', 'fc', '--apv', '3', '--ar', '12']),
  ...[
    { args: FE, kind: EXPORT_VOUCHER_KIND },
    { args: E_NOTE, kind: EXPORT_CREDIT_NOTE_KIND },
    { args: E_NOTE, kind: EXPORT_DEBIT_NOTE_KIND },
  ].map(({ args, kind }): Family => ({
    args,
    run: (flags, options) => runExport(flags, { ...options, kind }),
    shortcut: kind.shortcut,
  })),
];
/** Uno por comando: los dos caminos de emisión. */
const COMMANDS = FAMILIES.filter(({ shortcut }) => ['fc', 'fe'].includes(shortcut));

const emitted = (shortcut: string, numbers = '42') => `${shortcut} del punto de venta 3, ${numbers}`;
const missing = (shortcut: string, numbers = '42') => `No se generó el PDF: ${emitted(shortcut, numbers)}.`;

describe.each(FAMILIES)('$shortcut', ({ args, run, shortcut }) => {
  const emit = (options: RunOptions) => run([...args, '--emitir'], options);

  // Tests primero (REV-54): pasa a it() al implementarlo.
  it.fails('en texto: el PDF que falla queda anotado antes de mostrarlo', async () => {
    const { events } = await emit(BROKEN);

    expect(events.slice(-7)).toEqual([
      `anotado: ${emitted(shortcut)}`,
      'salida: CAE',
      'PDF cargar',
      'PDF generar 42',
      `anotado: ${emitted(shortcut)}; ${missing(shortcut)}`,
      'salida: PDF no generado',
      'fin: exit 0',
    ]);
  });

  // Tests primero (REV-54): pasa a it() al implementarlo.
  it.fails('con --json: queda anotado antes de escribir el resultado', async () => {
    const { events } = await emit({ ...BROKEN, json: true });

    expect(events.slice(-6)).toEqual([
      `anotado: ${emitted(shortcut)}`,
      'PDF cargar',
      'PDF generar 42',
      `anotado: ${emitted(shortcut)}; ${missing(shortcut)}`,
      'salida: JSON aprobado 42 PDF no generado',
      'fin: exit 0',
    ]);
  });

  // Tests primero (REV-54): pasa a it() al implementarlo.
  it.fails.each([false, true])('con --json %s, si se corta la salida el aviso lo dice una vez', async (json) => {
    await emit({ ...BROKEN, json });

    const notice = lostOutputNotice(json);

    expect(notice).toContain(`Se emitió: ${emitted(shortcut)}.`);
    expect(notice).toContain(missing(shortcut));
    expect(notice.match(/No se generó el PDF/g)).toHaveLength(1);
  });

  it('si el PDF se generó, el aviso solo dice lo emitido', async () => {
    const { events } = await emit({ config: ALWAYS });
    const notice = lostOutputNotice();

    expect(events).toContain('salida: PDF guardado');
    expect(notice).toContain(`Se emitió: ${emitted(shortcut)}.`);
    expect(notice).not.toContain('No se generó el PDF');
  });
});

describe.each(COMMANDS)('$shortcut: cualquier PDF elegido que falla', ({ args, run, shortcut }) => {
  const emit = (options: RunOptions) => run([...args, '--emitir'], options);

  // Tests primero (REV-54): pasa a it() al implementarlo.
  it.fails.each<[string, () => RunOptions]>([
    ['falta el componente', () => ({ config: ALWAYS, pdfFailure: 'cargar', pluginInstalled: false })],
    ['el componente no carga', () => ({ config: ALWAYS, pdfFailure: 'cargar' })],
    ['faltan los datos del emisor', () => ({ config: { ...ALWAYS, emisor: {} } })],
    // Un archivo donde va la carpeta: no se puede crear.
    ['no se puede escribir en la carpeta', () => ({ config: { ...ALWAYS, pdfCarpeta: batch(1) } })],
    ['elegido en la pregunta', () => ({ answers: [MAKE_PDF], config: ASK, pdfFailure: 'generar', tty: true })],
    ['No al instalar', () => ({ answers: ['No'], config: ALWAYS, pluginInstalled: false, tty: true })],
    ['Ctrl+C al instalar', () => ({ answers: ['Ctrl+C'], config: ALWAYS, pluginInstalled: false, tty: true })],
    [
      'falla la instalación',
      () => ({ answers: [INSTALL], config: ALWAYS, pdfFailure: 'instalar', pluginInstalled: false, tty: true }),
    ],
  ])('%s', async (_name, options) => {
    const result = await emit(options());

    expect(notes(result)).toEqual([
      `anotado: ${emitted(shortcut)}`,
      `anotado: ${emitted(shortcut)}; ${missing(shortcut)}`,
    ]);
    expect(result.events.at(-1)).toBe('fin: exit 0');
  });

  // Tests primero (REV-54): pasa a it() al implementarlo.
  it.fails.each<[string, string[], RunOptions]>([
    ['--exportar-pdf, aunque la config diga `nunca`', ['--emitir', '--exportar-pdf'], { pdfFailure: 'generar' }],
    ['"Sí, emitir y generar el PDF"', [], { answers: [EMIT_WITH_PDF], pdfFailure: 'generar', tty: true }],
  ])('con %s', async (_name, flags, options) => {
    const result = await run([...args, ...flags], options);

    expect(notes(result).at(-1)).toBe(`anotado: ${emitted(shortcut)}; ${missing(shortcut)}`);
  });
});

describe.each(COMMANDS)('$shortcut: no se anota', ({ args, run, shortcut }) => {
  it.each<[string, RunOptions]>([
    ['un PDF que no se eligió', { pdfFailure: 'generar' }],
    ['No en la pregunta del PDF', { answers: ['No'], config: ASK, pdfFailure: 'generar', tty: true }],
    ['Ctrl+C en la pregunta del PDF', { answers: ['Ctrl+C'], config: ASK, pdfFailure: 'generar', tty: true }],
    ['preguntar, sin nadie que responda', { config: ASK, pdfFailure: 'generar' }],
  ])('%s', async (_name, options) => {
    expect(notes(await run([...args, '--emitir'], options))).toEqual([`anotado: ${emitted(shortcut)}`]);
  });

  it.each<[string, string[], RunOptions, string]>([
    ['una vista previa', ['--previsualizar'], {}, 'fin: exit 0'],
    ['una vista previa con --json', ['--previsualizar'], { json: true }, 'fin: exit 0'],
    ['"No" en "¿Emitimos?"', [], { answers: [DO_NOT_EMIT], tty: true }, 'fin: exit 0'],
    ['un rechazo', ['--emitir'], { arca: ['R'] }, 'fin: exit 2'],
    ['un rechazo con --json', ['--emitir'], { arca: ['R'], json: true }, 'fin: exit 2'],
    ['una emisión incierta', ['--emitir'], { arca: ['incierta'] }, 'fin: exit 1'],
  ])('%s', async (_name, flags, options, end) => {
    const result = await run([...args, ...flags], { ...BROKEN, ...options });

    expect(notes(result)).toEqual([]);
    expect(result.events.at(-1)).toBe(end);
  });
});

describe('un lote', () => {
  const runBatch = (options: RunOptions) =>
    runBilling(['--cargar', batch(3), '--emitir'], { config: ALWAYS, ...options });

  // Tests primero (REV-54): pasa a it() al implementarlo.
  it.fails.each([false, true])('con --json %s: solo el que falló, antes de mostrarlo', async (json) => {
    const result = await runBatch({ json, pdfFailure: 'generar 42' });

    expect(notes(result).at(-1)).toBe(`anotado: ${emitted('fc', 'del 42 al 44')}; ${missing('fc')}`);
    expect(result.events.at(-3)).toBe(notes(result).at(-1));
    expect(result.events.at(-1)).toBe('fin: exit 0');
    expect(lostOutputNotice(json)).toContain(missing('fc'));
  });

  // Tests primero (REV-54): pasa a it() al implementarlo.
  it.fails('si fallan todos, en una línea', async () => {
    await runBatch({ pdfFailure: 'cargar' });

    expect(lostOutputNotice()).toContain(missing('fc', 'del 42 al 44'));
  });

  // Tests primero (REV-54): pasa a it() al implementarlo.
  it.fails('el que no lleva PDF y el rechazado no se anotan', async () => {
    const path = batch(3, (position) => ({ pdf: position !== 0 }));
    const result = await runBilling(['--cargar', path, '--emitir'], { arca: ['A', 'A', 'R'], pdfFailure: 'generar' });

    expect(notes(result).at(-1)).toBe(`anotado: ${emitted('fc', '42 y 43')}; ${missing('fc', '43')}`);
    expect(result.events.at(-1)).toBe('fin: exit 2');
  });

  // Tests primero (REV-54): pasa a it() al implementarlo.
  it.fails.each([false, true])('cortado, con --json %s: los ya emitidos, y el error del lote', async (json) => {
    const result = await runBatch({ arca: ['A', 'A', 'incierta'], json, pdfFailure: 'generar' });

    expect(notes(result).at(-1)).toBe(`anotado: ${emitted('fc', '42 y 43')}; ${missing('fc', '42 y 43')}`);
    expect(result.events.slice(-2)).toEqual(['error: BATCH_EMISSION_ERROR', 'fin: exit 1']);
  });
});
