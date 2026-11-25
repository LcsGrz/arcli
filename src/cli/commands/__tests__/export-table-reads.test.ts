import { describe, expect, it, vi } from 'vitest';

import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
  type ExportVoucherKind,
} from '../../../modules/export/export.kinds';

import { E_NOTE, EMIT, FE, type Run, runExport, useEmissionSequence, writeInput } from './emission-sequence.fixture';

/** Cuántas veces consulta un comando de la E cada cosa de WSFEX (ARQ8-6), y que emite una sola vez. */
vi.mock('../../spinner', () => ({ startSpinner: () => null }));
vi.mock('../../interactive/list-select', () => ({ listSelect: vi.fn() }));

useEmissionSequence();

const GOODS = ['--tipo-expo', '1', '--incoterm', 'FOB'];
const TABLES = [
  'getActivities',
  'getCurrencies',
  'getDestinationCountries',
  'getDestinationCountryCuits',
  'getIncoterms',
  'getLanguages',
  'getUnits',
];
const FROM_FILE = {
  cliente: 'ACME LLC',
  codigoMoneda: 'PES',
  domicilioCliente: '123 Main St',
  incoterm: 'FOB',
  montoTotal: 1500,
  paisDestino: 212,
  tipoExpo: 1,
};

const arcaCalls = (run: Run) =>
  run.events.flatMap((text) => (text.startsWith('ARCA ') ? [text.slice('ARCA '.length).split(' ')[0]] : []));

const CASES: ReadonlyArray<readonly [string, ExportVoucherKind, () => readonly string[], readonly string[]]> = [
  ['fe', EXPORT_VOUCHER_KIND, () => [...FE, ...GOODS], TABLES],
  ['fe --cargar', EXPORT_VOUCHER_KIND, () => ['--cargar', writeInput(FROM_FILE)], TABLES],
  ['nce', EXPORT_CREDIT_NOTE_KIND, () => E_NOTE, TABLES.filter((name) => name !== 'getIncoterms')],
  ['nde', EXPORT_DEBIT_NOTE_KIND, () => E_NOTE, TABLES.filter((name) => name !== 'getIncoterms')],
  ['nde sin asociado', EXPORT_DEBIT_NOTE_KIND, () => [...FE, ...GOODS], TABLES],
];

describe.each(CASES)('%s', (_name, kind, args, tables) => {
  it('confirmada: cada tabla y cada número una vez, y una sola emisión, al final', async () => {
    const run = await runExport(args(), { answers: [EMIT], kind, tty: true });
    const calls = arcaCalls(run);

    expect(run.events.at(-1)).toBe('fin: exit 0');
    expect(calls.at(-1)).toBe('authorize');
    expect(calls.filter((name) => name !== 'getVoucher').toSorted()).toEqual(
      [...tables, 'authorize', 'getLastRequestId', 'getLastVoucherNumber'].toSorted(),
    );
  });

  it('otra corrida vuelve a consultar lo mismo', async () => {
    const consulted = async () => arcaCalls(await runExport([...args(), '--previsualizar'], { kind })).toSorted();
    const first = await consulted();

    expect(first).toEqual(expect.arrayContaining([...tables]));
    expect(await consulted()).toEqual(first);
  });
});
