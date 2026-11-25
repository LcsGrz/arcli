import { describe, expect, it, vi } from 'vitest';

import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
} from '../../../modules/export/export.kinds';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
import { createProgram } from '../../program';

import {
  DO_NOT_EMIT,
  E_NOTE,
  emissionRuntime,
  EMIT,
  EMIT_WITH_PDF,
  exportGateway,
  FE,
  FE_READS,
  INSTALL,
  INSTALL_QUESTION,
  MAKE_PDF,
  PDF_QUESTION,
  type Run,
  runExport,
  type RunOptions,
  runSequence,
  useEmissionSequence,
} from './emission-sequence.fixture';

/** El orden de `executeExportCommand`: llamadas a WSFEX, lo que se anota, salidas, preguntas y PDF (REV-50). */
vi.mock('../../spinner', () => ({ startSpinner: () => null }));
vi.mock('../../interactive/list-select', () => ({ listSelect: vi.fn() }));
// Para entrar por `arcli factura e` y las demás: el perfil y el WSFEX del test en curso.
vi.mock('../../arca-runtime', async (original) => ({
  ...(await original<typeof import('../../arca-runtime')>()),
  resolveArcaRuntime: () => program.runtime,
}));
vi.mock('../../../services/arca/arca-client.factory', () => ({
  ArcaClientFactory: class {
    public readonly createExportGateway = () => exportGateway();
  },
}));

const program: { runtime?: CliArcaRuntime } = {};

useEmissionSequence();

const ASK = { pdf: 'preguntar' };
const ALWAYS = { pdf: 'siempre' };
const QUESTION = 'pregunta: ¿Emitimos la factura de exportación E en testing?';
const AUTHORIZED = ['ARCA authorize 42 por 1500', 'anotado: fe del punto de venta 3, 42'];
const EMITTED = [...FE_READS, ...AUTHORIZED];
const MAKE = ['PDF cargar', 'PDF generar 42'];

describe('una factura E', () => {
  it.each([
    ['--previsualizar', [...FE, '--previsualizar'], {}, 'vista previa'],
    ['sin terminal', FE, {}, 'vista previa'],
    ['--json', FE, { json: true, tty: true }, 'JSON previsualizacion 42'],
  ])('vista previa, %s: las lecturas y una salida', async (_name, args, options, output) => {
    expect((await runExport(args, options)).events).toEqual([...FE_READS, `salida: ${output}`, 'fin: exit 0']);
  });

  it.each([DO_NOT_EMIT, 'Esc'])('"¿Emitimos?" con %s: avisa y sale con 0', async (answer) => {
    expect((await runExport(FE, { answers: [answer], tty: true })).events).toEqual([
      ...FE_READS,
      'salida: vista previa',
      QUESTION,
      'salida: no se emitió nada',
      'fin: exit 0',
    ]);
  });

  it('"¿Emitimos?" con Ctrl+C: sale con 1', async () => {
    expect((await runExport(FE, { answers: ['Ctrl+C'], tty: true })).events).toEqual([
      ...FE_READS,
      'salida: vista previa',
      QUESTION,
      'error: Cancelado. No se emitió nada.',
      'fin: exit 1',
    ]);
  });

  it('confirmada, sin PDF: no vuelve a consultar nada antes de emitir', async () => {
    expect((await runExport(FE, { answers: [EMIT], config: ASK, tty: true })).events).toEqual([
      ...FE_READS,
      'salida: vista previa',
      QUESTION,
      ...AUTHORIZED,
      'salida: CAE',
      'fin: exit 0',
    ]);
  });

  it('--emitir, sin terminal: ni pregunta ni genera el PDF', async () => {
    expect((await runExport([...FE, '--emitir'], { config: ASK })).events).toEqual([
      ...EMITTED,
      'salida: CAE',
      'fin: exit 0',
    ]);
  });

  it('--json: el PDF antes del único JSON, que lo trae', async () => {
    expect((await runExport([...FE, '--emitir'], { config: ALWAYS, json: true, tty: true })).events).toEqual([
      ...EMITTED,
      ...MAKE,
      'salida: JSON aprobado 42 con PDF',
      'fin: exit 0',
    ]);
  });

  it.each([
    ['texto', false, 'rechazado'],
    ['--json', true, 'JSON rechazado 42'],
  ])('rechazada, %s: se muestra, sin PDF y con exit 2', async (_name, json, output) => {
    expect((await runExport([...FE, '--emitir'], { arca: ['R'], config: ALWAYS, json })).events).toEqual([
      ...FE_READS,
      'ARCA authorize 42 por 1500',
      `salida: ${output}`,
      'fin: exit 2',
    ]);
  });

  it.each([
    ['--previsualizar', [...FE, '--previsualizar'], {}],
    ['--emitir', [...FE, '--emitir'], {}],
    ['confirmada', FE, { answers: [EMIT], tty: true }],
  ] as const)('%s: los datos de la factura se muestran una vez', async (_name, args, options) => {
    const { stdout } = await runExport(args, options);

    expect(stripAnsi(stdout).match(/ACME LLC/g)).toHaveLength(1);
    expect(stripAnsi(stdout).match(/Estás en TESTING/g)).toHaveLength(1);
  });

  it.each([
    ['--previsualizar', [...FE, '--previsualizar']],
    ['--emitir', [...FE, '--emitir']],
  ])('%s: `bruto` de la config suma la respuesta, con --json', async (_name, args) => {
    const shown = async (raw: boolean) =>
      'respuesta' in (JSON.parse((await runExport(args, { json: true, raw })).stdout) as object);

    expect([await shown(false), await shown(true)]).toEqual([false, true]);
  });

  it('--emitir --bruto en texto: la respuesta al final', async () => {
    expect(stripAnsi((await runExport([...FE, '--emitir'], { raw: true })).stdout)).toMatch(/respuesta bruta/i);
    expect(stripAnsi((await runExport([...FE, '--emitir'], {})).stdout)).not.toMatch(/respuesta bruta/i);
  });

  it('rechazada: el exit 2 queda fijado aunque falle la salida', async () => {
    vi.mocked(process.stdout.write).mockImplementationOnce(() => {
      throw new Error('disco lleno');
    });
    await runExport([...FE, '--emitir'], { arca: ['R'] });

    expect(process.exitCode).toBe(2);
  });

  it.each(['incierta', 'ilegible'] as const)('respuesta %s: solo el error, sin reintentar', async (step) => {
    expect((await runExport([...FE, '--emitir'], { arca: [step], config: ALWAYS })).events).toEqual([
      ...FE_READS,
      'ARCA authorize 42 por 1500',
      'error: EMISSION_UNCERTAIN',
      'fin: exit 1',
    ]);
  });

  it('si falla el número corta en la resolución, antes de la vista previa', async () => {
    expect((await runExport(FE, { arca: ['sin numero'], tty: true })).events).toEqual([
      ...FE_READS.slice(0, FE_READS.indexOf('ARCA getLastVoucherNumber') + 1),
      'error: LoginFault',
      'fin: exit 1',
    ]);
  });
});

it('una nota E consulta su asociado primero y una vez', async () => {
  const { events } = await runExport(E_NOTE, { answers: [EMIT], kind: EXPORT_CREDIT_NOTE_KIND, tty: true });

  expect(events).toEqual([
    'ARCA getVoucher',
    ...FE_READS,
    'salida: vista previa',
    'pregunta: ¿Emitimos la nota de crédito de exportación E en testing?',
    'ARCA authorize 42 por 500',
    'anotado: nce del punto de venta 3, 42',
    'salida: CAE',
    'fin: exit 0',
  ]);
});

it.each([
  ['factura E', EXPORT_VOUCHER_KIND, FE],
  ['nota de crédito E', EXPORT_CREDIT_NOTE_KIND, E_NOTE],
  ['nota de débito E', EXPORT_DEBIT_NOTE_KIND, E_NOTE],
] as const)('%s confirmada: WSFEX recibe la solicitud de la vista previa', async (_name, kind, args) => {
  const preview = await runExport([...args, '--previsualizar'], { json: true, kind });
  const { sent } = await runExport(args, { answers: [EMIT], kind, tty: true });

  expect(JSON.parse(JSON.stringify(sent))).toEqual([JSON.parse(preview.stdout).solicitud]);
});

/** Cada caso: las respuestas y, después de anotar lo emitido, lo que pasa. */
interface PdfOrderCase {
  readonly expected: readonly string[];
  readonly args?: readonly string[];
  readonly name: string;
  readonly options: RunOptions;
}

const PDF_ORDER: readonly PdfOrderCase[] = [
  {
    expected: ['salida: CAE', PDF_QUESTION, INSTALL_QUESTION, 'PDF instalar', ...MAKE, 'salida: PDF guardado'],
    name: 'preguntar, instalar y generar',
    options: { answers: [MAKE_PDF, INSTALL], config: ASK, pluginInstalled: false, tty: true },
  },
  {
    expected: ['salida: CAE', ...MAKE, 'salida: PDF guardado'],
    name: 'sin terminal, con `pdf siempre`',
    options: { config: ALWAYS },
  },
  {
    expected: ['salida: CAE', ...MAKE, 'salida: PDF no generado'],
    name: 'un PDF que falla',
    options: { config: ALWAYS, pdfFailure: 'generar' },
  },
  {
    expected: ['salida: CAE', PDF_QUESTION],
    name: 'Ctrl+C en la pregunta del PDF',
    options: { answers: ['Ctrl+C'], config: ASK, tty: true },
  },
  {
    expected: ['salida: CAE', INSTALL_QUESTION, 'salida: PDF no generado'],
    name: 'no instalar el componente',
    options: { answers: ['No'], config: ALWAYS, pluginInstalled: false, tty: true },
  },
];

/** Lo que pasa después de que WSFEX responde y queda anotado. El PDF que queda anotado es de `missing-pdf.test.ts`. */
function afterEmission({ events }: Run): readonly string[] {
  const isNote = (text: string) => text.startsWith('anotado: ');

  return events.slice(events.findIndex(isNote) + 1).filter((text) => !isNote(text));
}

/** `arcli <argv>` entero, con el perfil y el WSFEX falsos. */
async function runProgram(argv: readonly string[], options: RunOptions): Promise<Run> {
  program.runtime = emissionRuntime(options);

  return runSequence(() => createProgram().parseAsync(['node', 'arcli', ...argv]), options);
}

// La E, como las demás: el CAE antes de preguntar, instalar y generar el PDF.
describe('E en texto con PDF, primero el CAE', () => {
  it.each(PDF_ORDER)('$name', async ({ expected, options }) => {
    expect(afterEmission(await runExport([...FE, '--emitir'], options))).toEqual([...expected, 'fin: exit 0']);
  });

  it('confirmada con PDF', async () => {
    expect(afterEmission(await runExport(FE, { answers: [EMIT_WITH_PDF], tty: true }))).toEqual([
      'salida: CAE',
      ...MAKE,
      'salida: PDF guardado',
      'fin: exit 0',
    ]);
  });

  it('si la pregunta del PDF falla (no es una cancelación), el CAE ya se mostró, como en A, B y C', async () => {
    const run = await runExport([...FE, '--emitir'], {
      answers: [new Error('falló la pregunta')],
      config: ASK,
      tty: true,
    });

    expect(afterEmission(run)).toEqual(['salida: CAE', PDF_QUESTION, 'error: falló la pregunta', 'fin: exit 1']);
  });

  it.each([
    ['fe', ['fe', ...FE]],
    ['nce', ['nce', ...E_NOTE]],
    ['nde', ['nde', ...E_NOTE]],
    ['factura e', ['factura', 'e', ...FE]],
    ['nota-credito e', ['nota-credito', 'e', ...E_NOTE]],
    ['nota-debito e', ['nota-debito', 'e', ...E_NOTE]],
  ])('`arcli %s`: el CAE, y después preguntar, instalar y generar', async (_name, argv) => {
    const run = await runProgram([...argv, '--emitir'], {
      answers: [MAKE_PDF, INSTALL],
      config: ASK,
      pluginInstalled: false,
      tty: true,
    });

    expect(afterEmission(run)).toEqual([
      'salida: CAE',
      PDF_QUESTION,
      INSTALL_QUESTION,
      'PDF instalar',
      ...MAKE,
      'salida: PDF guardado',
      'fin: exit 0',
    ]);
  });

  it.each([
    ['fe', ['fe', ...FE]],
    ['nce', ['nce', ...E_NOTE]],
    ['nde', ['nde', ...E_NOTE]],
    ['factura e', ['factura', 'e', ...FE]],
    ['nota-credito e', ['nota-credito', 'e', ...E_NOTE]],
    ['nota-debito e', ['nota-debito', 'e', ...E_NOTE]],
  ])('`arcli %s --json`: el PDF antes del único JSON', async (_name, argv) => {
    const run = await runProgram([...argv, '--emitir', '--json'], { config: ALWAYS, json: true });

    expect(afterEmission(run)).toEqual([...MAKE, 'salida: JSON aprobado 42 con PDF', 'fin: exit 0']);
  });
});
