import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ArcliEnvironment } from '../../../modules/config/config.schemas';
import type { SaveOutcome, StoredVoucherRecord, VoucherNumber } from '../../../modules/vouchers/voucher-record-store';

import {
  inspect,
  movableClock,
  NOW,
  openStore,
  scalar,
  temporaryDataDirectory,
  voucherRecord,
  vouchersFile,
} from './local-data.fixtures';

const FIRST_CAE = '76123456789012';
const SECOND_CAE = '76999999999999';

/** Las filas de eventos de un tipo, mirando el archivo. */
function events(dataDirectory: string, type: string): number {
  return Number(
    inspect(vouchersFile(dataDirectory), (database) =>
      scalar(database, `SELECT count(*) FROM eventos WHERE tipo = '${type}'`),
    ),
  );
}

describe('SqliteVoucherRecordStore: sin base (ARQ-12)', () => {
  // Leer no crea nada: ni la base ni las carpetas.
  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('findByCae y findByNumber sin base dan undefined y no crean datos/', async () => {
    const dataDirectory = temporaryDataDirectory();
    const store = openStore(dataDirectory);

    await expect(store.findByCae(FIRST_CAE)).resolves.toBeUndefined();
    await expect(store.findByNumber({ numero: 1, puntoVenta: 2, tipo: 11 })).resolves.toBeUndefined();
    expect(existsSync(join(dataDirectory, 'datos'))).toBe(false);
    expect(readdirSync(dataDirectory)).toEqual([]);
  });

  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('armar el store no abre ni crea nada', () => {
    const dataDirectory = temporaryDataDirectory();

    openStore(dataDirectory);

    expect(readdirSync(dataDirectory)).toEqual([]);
  });
});

describe('SqliteVoucherRecordStore: CUIT y entorno inválidos (ARQ-12)', () => {
  // `../x` llevaría la base afuera de datos/: tiene que lanzar antes de crear nada, también en la carpeta de arriba.
  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails.each(['../x', '2011111111', '20111111113'])('con el CUIT %j, save lanza y no crea nada', async (cuit) => {
    const parent = temporaryDataDirectory();
    const dataDirectory = join(parent, 'config');
    const store = openStore(dataDirectory, { cuit });

    await expect(store.save(voucherRecord())).rejects.toThrow(/CUIT/);
    await expect(store.findByCae(FIRST_CAE)).rejects.toThrow(/CUIT/);
    expect(readdirSync(parent)).toEqual([]);
  });

  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails.each(['homologacion', '../testing'])('con el entorno %j, save lanza y no crea nada', async (environment) => {
    const dataDirectory = temporaryDataDirectory();
    const store = openStore(dataDirectory, { environment: environment as ArcliEnvironment });

    await expect(store.save(voucherRecord())).rejects.toThrow(/entorno/);
    expect(readdirSync(dataDirectory)).toEqual([]);
  });
});

describe('SqliteVoucherRecordStore: reglas de save (ARQ-12)', () => {
  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('uno nuevo: saved, y se encuentra por CAE y por número con la fecha del reloj', async () => {
    const store = openStore(temporaryDataDirectory());
    const record = voucherRecord();
    const saved: SaveOutcome = { kind: 'saved' };
    const stored: StoredVoucherRecord = { ...record, savedAt: NOW };
    const number: VoucherNumber = { numero: 1, puntoVenta: 2, tipo: 11 };

    await expect(store.save(record)).resolves.toEqual(saved);
    await expect(store.findByCae(record.cae)).resolves.toEqual(stored);
    await expect(store.findByNumber(number)).resolves.toEqual(stored);
  });

  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('el mismo CAE con el mismo número: already-saved, sin otra fila ni otra fecha', async () => {
    const dataDirectory = temporaryDataDirectory();
    const clock = movableClock();
    const store = openStore(dataDirectory, { clock });

    await store.save(voucherRecord());
    clock.set('2026-11-27T10:00:00.000Z');

    await expect(store.save(voucherRecord())).resolves.toEqual({ kind: 'already-saved' });
    await expect(store.findByCae(FIRST_CAE)).resolves.toMatchObject({ savedAt: NOW });
    expect(
      inspect(vouchersFile(dataDirectory), (database) => scalar(database, 'SELECT count(*) FROM comprobantes')),
    ).toBe(1);
  });

  // Un CAE es de un solo comprobante: si llega con otro número no se pisa lo guardado, y queda el rastro.
  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('el CAE con otro número: cae-on-other-number, sin cambios y con un evento conflicto-numero', async () => {
    const dataDirectory = temporaryDataDirectory();
    const store = openStore(dataDirectory);

    await store.save(voucherRecord());

    await expect(store.save(voucherRecord({ numero: 7 }))).resolves.toEqual({
      kind: 'cae-on-other-number',
      saved: { numero: 1, puntoVenta: 2, tipo: 11 },
    });
    await expect(store.findByCae(FIRST_CAE)).resolves.toMatchObject({ numero: 1 });
    await expect(store.findByNumber({ numero: 7, puntoVenta: 2, tipo: 11 })).resolves.toBeUndefined();
    expect(events(dataDirectory, 'conflicto-numero')).toBe(1);
  });

  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('otro tipo o punto de venta con el mismo CAE también es otro número', async () => {
    const store = openStore(temporaryDataDirectory());

    await store.save(voucherRecord());

    await expect(store.save(voucherRecord({ tipo: 6 }))).resolves.toMatchObject({ kind: 'cae-on-other-number' });
    await expect(store.save(voucherRecord({ puntoVenta: 3 }))).resolves.toMatchObject({ kind: 'cae-on-other-number' });
  });

  // ARCA reinicia homologación: el mismo número vuelve con otro CAE. Vale el nuevo; el viejo no se borra.
  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('otro CAE para el mismo número: replaced, el anterior queda marcado y con un evento reemplazo', async () => {
    const dataDirectory = temporaryDataDirectory();
    const clock = movableClock();
    const store = openStore(dataDirectory, { clock });

    await store.save(voucherRecord());
    clock.set('2026-11-27T10:00:00.000Z');

    await expect(store.save(voucherRecord({ cae: SECOND_CAE, totalCentavos: 5000 }))).resolves.toEqual({
      kind: 'replaced',
      previousCae: FIRST_CAE,
    });
    await expect(store.findByNumber({ numero: 1, puntoVenta: 2, tipo: 11 })).resolves.toMatchObject({
      cae: SECOND_CAE,
      totalCentavos: 5000,
    });

    const rows = inspect(vouchersFile(dataDirectory), (database) =>
      database
        .prepare('SELECT cae, reemplazado_por, reemplazado_el FROM comprobantes ORDER BY cae')
        .all()
        .map((row) => ({ ...row })),
    );

    expect(rows).toEqual([
      { cae: FIRST_CAE, reemplazado_el: '2026-11-27T10:00:00.000Z', reemplazado_por: SECOND_CAE },
      { cae: SECOND_CAE, reemplazado_el: null, reemplazado_por: null },
    ]);
    expect(events(dataDirectory, 'reemplazo')).toBe(1);
  });

  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('un tercer CAE reemplaza al segundo, no al primero', async () => {
    const store = openStore(temporaryDataDirectory());

    await store.save(voucherRecord());
    await store.save(voucherRecord({ cae: SECOND_CAE }));

    await expect(store.save(voucherRecord({ cae: '76555555555555' }))).resolves.toEqual({
      kind: 'replaced',
      previousCae: SECOND_CAE,
    });
  });

  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('números distintos conviven, y findByNumber distingue tipo y punto de venta', async () => {
    const store = openStore(temporaryDataDirectory());

    await store.save(voucherRecord());
    await expect(store.save(voucherRecord({ cae: SECOND_CAE, tipo: 6 }))).resolves.toEqual({ kind: 'saved' });

    await expect(store.findByNumber({ numero: 1, puntoVenta: 2, tipo: 11 })).resolves.toMatchObject({
      cae: FIRST_CAE,
    });
    await expect(store.findByNumber({ numero: 1, puntoVenta: 2, tipo: 6 })).resolves.toMatchObject({
      cae: SECOND_CAE,
    });
    await expect(store.findByNumber({ numero: 1, puntoVenta: 3, tipo: 11 })).resolves.toBeUndefined();
  });

  // El CAE va como texto: 14 dígitos no entran exactos en un REAL y no se pierden ceros a la izquierda.
  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('el CAE se guarda y vuelve como texto, igual', async () => {
    const dataDirectory = temporaryDataDirectory();
    const store = openStore(dataDirectory);

    await store.save(voucherRecord({ cae: '06123456789012' }));

    await expect(store.findByCae('06123456789012')).resolves.toMatchObject({ cae: '06123456789012' });
    expect(
      inspect(vouchersFile(dataDirectory), (database) => scalar(database, 'SELECT typeof(cae) FROM comprobantes')),
    ).toBe('text');
  });

  // node:sqlite en Node 26 guarda NULL sin avisar: tiene que lanzar en todas las versiones y no dejar nada.
  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('un campo obligatorio undefined lanza y no guarda', async () => {
    const dataDirectory = temporaryDataDirectory();
    const store = openStore(dataDirectory);

    await store.save(voucherRecord({ cae: SECOND_CAE, numero: 2 }));

    await expect(
      store.save({ ...voucherRecord(), fecha: undefined } as unknown as ReturnType<typeof voucherRecord>),
    ).rejects.toThrow(/fecha/);
    await expect(store.findByCae(FIRST_CAE)).resolves.toBeUndefined();
  });
});
