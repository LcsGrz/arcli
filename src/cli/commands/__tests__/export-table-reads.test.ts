import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExportGateway } from '../../../modules/export/export.gateway';
import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
  type ExportVoucherKind,
} from '../../../modules/export/export.kinds';

import {
  E_NOTE,
  emissionRuntime,
  EMIT,
  exportGateway,
  FE,
  type Run,
  runExport,
  useEmissionSequence,
  writeInput,
} from './emission-sequence.fixture';

/** Cuántas veces consulta un comando de la E cada cosa de WSFEX (ARQ8-6), y que emite una sola vez. */
vi.mock('../../spinner', () => ({ startSpinner: () => null }));
vi.mock('../../interactive/list-select', () => ({ listSelect: vi.fn() }));

/** Los gateways que armó el comando, uno por corrida. */
const created: ExportGateway[] = [];

vi.mock('../../export-voucher-gateway', async (importOriginal) => {
  const { createExportVoucherGateway } = await importOriginal<typeof import('../../export-voucher-gateway')>();

  return {
    createExportVoucherGateway: (...args: Parameters<typeof createExportVoucherGateway>) => {
      const gateway = createExportVoucherGateway(...args);

      created.push(gateway);

      return gateway;
    },
  };
});
// El WSFEX de abajo de todo, para pasar por la fábrica y por lo que recuerda las tablas.
vi.mock('../../../services/arca/arca-export.gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/arca/arca-export.gateway')>();

  return {
    ArcaExportGateway: class {
      // El de la fábrica trae autenticador; `exportAnswer` usa el verdadero, sin él.
      public constructor(...args: ConstructorParameters<typeof actual.ArcaExportGateway>) {
        return (args[1] ? exportGateway() : new actual.ArcaExportGateway(...args)) as never;
      }
    },
  };
});
vi.mock('../../arca-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../arca-runtime')>()),
  // Nombres ficticios: solo dicen que WSFEX usa el certificado de facturación. No se lee ningún archivo.
  resolveArcaRuntime: () => emissionRuntime({ config: { cert: { testing: 'cert.pem' }, key: { testing: 'key.pem' } } }),
}));

useEmissionSequence();

beforeEach(() => {
  created.length = 0;
});

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
    const run = await runExport(args(), { answers: [EMIT], defaultDependencies: true, kind, tty: true });
    const calls = arcaCalls(run);

    expect(run.events.at(-1)).toBe('fin: exit 0');
    expect(calls.at(-1)).toBe('authorize');
    expect(calls.filter((name) => name !== 'getVoucher').toSorted()).toEqual(
      [...tables, 'authorize', 'getLastRequestId', 'getLastVoucherNumber'].toSorted(),
    );
  });

  it('otra corrida vuelve a consultar lo mismo', async () => {
    const consulted = async () =>
      arcaCalls(await runExport([...args(), '--previsualizar'], { defaultDependencies: true, kind })).toSorted();
    const first = await consulted();

    expect(first).toEqual(expect.arrayContaining([...tables]));
    expect(await consulted()).toEqual(first);
  });

  it('el gateway de la corrida recuerda las tablas, no los números', async () => {
    const run = await runExport([...args(), '--previsualizar'], { defaultDependencies: true, kind });
    const consulted = arcaCalls(run).length;

    expect(created).toHaveLength(1);

    for (const table of tables) {
      await (created[0][table as keyof ExportGateway] as () => Promise<unknown>)();
    }

    expect(arcaCalls(run)).toHaveLength(consulted);
    await created[0].getLastRequestId();
    expect(arcaCalls(run)).toHaveLength(consulted + 1);
  });

  it('cada corrida arma el suyo', async () => {
    await runExport([...args(), '--previsualizar'], { defaultDependencies: true, kind });
    await runExport([...args(), '--previsualizar'], { defaultDependencies: true, kind });

    expect(new Set(created).size).toBe(2);
  });
});
