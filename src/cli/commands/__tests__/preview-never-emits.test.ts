import { describe, expect, it, vi } from 'vitest';

import type { VoucherShortcut } from '../../../modules/billing/billing.types';
import { VOUCHER_KIND_MAP } from '../../../modules/billing/voucher-kind-map';
import { EXPORT_VOUCHER_KINDS, isExportNote } from '../../../modules/export/export.types';
import { argsForKind } from '../../__tests__/voucher-args.fixture';

import {
  batch,
  CLIENT_CUIT,
  DO_NOT_EMIT,
  E_NOTE,
  emissionCalls,
  EMIT,
  FE,
  type Run,
  runBilling,
  runExport,
  type RunOptions,
  useEmissionSequence,
} from './emission-sequence.fixture';

/**
 * En vista previa nunca se llama a emitir (REV-50): ni `createVoucher` o `authorize` ni, en A, B y C, el pedido del
 * número. En todas las familias, y por todos los caminos que no emiten.
 */
vi.mock('../../spinner', () => ({ startSpinner: () => null }));
vi.mock('../../interactive/list-select', () => ({ listSelect: vi.fn() }));

useEmissionSequence();

interface Family {
  readonly name: string;
  /** Las llamadas de una emisión: si un comprobante del test no se pudiera emitir, el invariante no probaría nada. */
  readonly emission: readonly string[];
  readonly run: (extra: readonly string[], options: RunOptions) => Promise<Run>;
}

const FAMILIES: readonly Family[] = [
  ...Object.values(VOUCHER_KIND_MAP).map((kind) => {
    const [shortcut, ...args] = argsForKind(kind, CLIENT_CUIT);
    const issued =
      kind.isElectronicCredit || kind.letter === 'a' ? { documentNumber: CLIENT_CUIT, documentTypeCode: 80 } : {};

    return {
      emission: ['ARCA getNextVoucherNumber', 'ARCA createVoucher 42 por 1000000'],
      name: kind.shortcut,
      run: (extra: readonly string[], options: RunOptions) =>
        runBilling([...args, ...extra], { ...options, issued, shortcut: shortcut as VoucherShortcut }),
    };
  }),
  ...EXPORT_VOUCHER_KINDS.map((kind) => ({
    emission: [`ARCA authorize 42 por ${isExportNote(kind) ? 500 : 1500}`],
    name: kind.shortcut,
    run: (extra: readonly string[], options: RunOptions) =>
      runExport([...(isExportNote(kind) ? E_NOTE : FE), ...extra], { ...options, kind }),
  })),
  {
    emission: ['ARCA getNextVoucherNumber', 'ARCA createVoucher 42 por 1000'].concat(
      'ARCA getNextVoucherNumber',
      'ARCA createVoucher 43 por 2000',
    ),
    name: 'lote de fc',
    run: (extra, options) => runBilling(['--cargar', batch(2), ...extra], options),
  },
];

const INVALID_DATE = ['--fecha', '01/01/2026'];
const EMIT_BY_DEFAULT = { output: { emitirPorDefecto: true } };

/** Cada camino que no emite, con el evento que muestra por dónde salió. */
const PREVIEWS: ReadonlyArray<readonly [name: string, extra: readonly string[], options: RunOptions, shown: RegExp]> = [
  ['--previsualizar', ['--previsualizar'], { tty: true }, /^salida: vista previa(, vista previa)?$/],
  [
    '--previsualizar con emitir en la config',
    ['--previsualizar'],
    { config: EMIT_BY_DEFAULT },
    /^salida: vista previa(, vista previa)?$/,
  ],
  ['sin terminal', [], {}, /^salida: vista previa(, vista previa)?$/],
  ['stdin sin terminal', [], { tty: [false, true] }, /^salida: vista previa(, vista previa)?$/],
  ['stdout sin terminal', [], { tty: [true, false] }, /^salida: vista previa(, vista previa)?$/],
  ['--json en una terminal', [], { json: true, tty: true }, /^salida: JSON previsualizacion/],
  ['"No"', [], { answers: [DO_NOT_EMIT], tty: true }, /^salida: no se emitió nada/],
  ['Esc', [], { answers: ['Esc'], tty: true }, /^salida: no se emitió nada/],
  ['Ctrl+C', [], { answers: ['Ctrl+C'], tty: true }, /^error: Cancelado/],
  ['la pregunta falla', [], { answers: [new Error('boom')], tty: true }, /^error: boom/],
];

/** Con un dato que no vale no se emite ni pidiéndolo. */
const INVALID: ReadonlyArray<readonly [name: string, extra: readonly string[], options: RunOptions]> = [
  ['en una terminal', [], { answers: [EMIT], tty: true }],
  ['con --emitir', ['--emitir'], {}],
  ['con emitir en la config', [], { config: EMIT_BY_DEFAULT, json: true }],
];

describe.each(FAMILIES)('$name', ({ emission, run }) => {
  it.each(PREVIEWS)('%s: no se llama a emitir', async (_name, extra, options, shown) => {
    const result = await run(extra, options);

    expect(emissionCalls(result)).toEqual([]);
    // Lo último que hace: nada pregunta ni falla después.
    expect(result.events.slice(-2)).toEqual([expect.stringMatching(shown), expect.stringMatching(/^fin: exit/)]);
  });

  it.each(INVALID)('un dato inválido %s: no se llama a emitir', async (_name, extra, options) => {
    const result = await run([...INVALID_DATE, ...extra], options);

    expect(emissionCalls(result)).toEqual([]);
    expect(result.events).toContainEqual(expect.stringMatching(/^error: (BATCH|INPUT)_VALIDATION_ERROR$/));
  });

  it.each([
    ['--emitir', ['--emitir'], {}],
    ['"Sí"', [], { answers: [EMIT], tty: true }],
  ] as ReadonlyArray<readonly [string, readonly string[], RunOptions]>)(
    'con %s sí se emite, una vez',
    async (_name, extra, options) => {
      const result = await run(extra, options);

      expect(emissionCalls(result)).toEqual(emission);
      expect(result.events.at(-1)).toBe('fin: exit 0');
    },
  );
});

it('en la E, el número y el ID que se piden para la vista previa son lecturas', async () => {
  const { events } = await runExport([...FE, '--previsualizar'], {});

  expect(events).toEqual(expect.arrayContaining(['ARCA getLastVoucherNumber', 'ARCA getLastRequestId']));
});
