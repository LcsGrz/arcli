import { describe, expect, it } from 'vitest';

import { resolveExportPayload } from '../../../modules/export/__tests__/export-note.fixture';
import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
  type ExportVoucherKind,
} from '../../../modules/export/export.types';

import { exportInput, exportPlan, type Json, pick, type Written } from './input-precedence.fixtures';

/**
 * REV-52: los cruces entre niveles en la factura E y sus notas, como en A, B y C (`billing.input-crosses.test.ts`).
 */

const KINDS = [
  ['factura E', EXPORT_VOUCHER_KIND],
  ['nota de crédito E', EXPORT_CREDIT_NOTE_KIND],
  ['nota de débito E', EXPORT_DEBIT_NOTE_KIND],
] as const;

interface CrossCase {
  readonly approved: Json;
  readonly name: string;
  readonly written: Written;
}

const rate = { cotizacionMoneda: 1400 };

describe.each(KINDS)('cruce 1 en %s: la cotización del archivo con otra moneda en el flag', (_name, kind) => {
  const cases: readonly CrossCase[] = [
    {
      approved: { currencyCode: 'EUR', exchangeRate: undefined },
      name: '--moneda EUR sobre USD del archivo',
      written: { args: ['--moneda', 'EUR'], json: { ...rate, codigoMoneda: 'USD' } },
    },
    {
      approved: { currencyCode: '060', exchangeRate: undefined },
      name: 'sin `codigoMoneda`, la del archivo es DOL: --mda 060',
      written: { args: ['--mda', '060'], json: rate },
    },
    {
      // La moneda de la config es de A, B y C.
      approved: { currencyCode: 'EUR', exchangeRate: undefined },
      name: 'la moneda de la config no es la del archivo',
      written: { args: ['--moneda', 'EUR'], config: { monedaPorDefecto: 'EUR' }, json: rate },
    },
    {
      approved: { currencyCode: 'ARS', exchangeRate: undefined },
      name: '--moneda ARS sobre USD del archivo',
      written: { args: ['--moneda', 'ARS'], json: { ...rate, codigoMoneda: 'USD' } },
    },
  ];

  it.each(cases)('cruce 1: $name', ({ approved, written }) => {
    expect(pick(exportInput(written, kind), approved)).toEqual(approved);
  });

  it.each<[string, Written, Json]>([
    [
      'USD y DOL son la misma moneda',
      { args: ['--moneda', 'USD'], json: { ...rate, codigoMoneda: 'DOL' } },
      { exchangeRate: 1400 },
    ],
    [
      'con --cm va la del flag',
      { args: ['--moneda', 'EUR', '--cm', '1500'], json: { ...rate, codigoMoneda: 'USD' } },
      { exchangeRate: 1500 },
    ],
    [
      '`mismaMoneda` del archivo se conserva con otra moneda',
      { args: ['--moneda', 'EUR'], json: { codigoMoneda: 'USD', mismaMoneda: true } },
      { currencyCode: 'EUR', exchangeRate: undefined, sameCurrency: true },
    ],
  ])('cruce 1, no cambia: %s', (_case, written, expected) => {
    expect(pick(exportInput(written, kind), expected)).toEqual(expected);
  });
});

describe('cruce 1 en la E con un archivo sin `codigoMoneda`', () => {
  const written = { args: ['--moneda', 'usd'], config: { monedaPorDefecto: 'EUR' }, json: rate };

  it('en la factura, USD es la del archivo: no cambia', () => {
    expect(exportInput(written).exchangeRate).toBe(1400);
  });

  // La moneda de la nota sale de su asociado: la del archivo no se sabe.
  it.each(KINDS.slice(1))('en %s cualquier --moneda descarta la cotización', (_name, kind) => {
    expect(exportInput(written, kind).exchangeRate).toBeUndefined();
  });
});

describe('un flag de moneda vacío en la E, hasta la solicitud', () => {
  const invoice = {
    cliente: 'ACME',
    domicilioCliente: 'Calle 1',
    incoterm: 'FOB',
    montoTotal: 500,
    paisDestino: 203,
    tipoExpo: 1,
  };
  const note = { comprobanteAsociado: { numero: 12 }, montoTotal: 500 };
  const payloadOf = (args: string[], kind: ExportVoucherKind, json: Json) =>
    resolveExportPayload(
      exportPlan({ args, json: { ...(kind === EXPORT_VOUCHER_KIND ? invoice : note), ...json } }, kind).input,
    );

  it.each(
    KINDS.flatMap(([name, kind]) =>
      [
        ['--moneda', ''],
        ['--moneda', '  '],
        ['--mda', ''],
        ['--moneda', '', '--mda', ' '],
      ].map((args) => [name, args, kind] as const),
    ),
  )('%s: %j no pisa la moneda ni la cotización del archivo', async (_name, args, kind) => {
    expect(await payloadOf([...args], kind, { codigoMoneda: 'EUR', cotizacionMoneda: 1400 })).toMatchObject({
      Moneda_Id: '060',
      Moneda_ctz: 1400,
    });
  });

  it.each(KINDS)('%s: sin moneda en el archivo, la que iría sin el flag', async (_name, kind) => {
    expect(await payloadOf(['--moneda', ''], kind, rate)).toEqual(await payloadOf([], kind, rate));
  });

  it.each(KINDS)('%s: `--moneda "" --mda EUR` es EUR', async (_name, kind) => {
    expect(
      await payloadOf(['--moneda', '', '--mda', 'EUR'], kind, { codigoMoneda: 'USD', cotizacionMoneda: 1400 }),
    ).toMatchObject({ Moneda_Id: '060', Moneda_ctz: kind === EXPORT_VOUCHER_KIND ? 1700 : 1600.5 });
  });
});

describe('cruce 7: --cm y `mismaMoneda` en niveles distintos', () => {
  const cmOverFile = { args: ['--cm', '1500'], json: { mismaMoneda: true } };
  const sameOverFile = { args: ['--misma-moneda'], json: rate };

  it.each(KINDS)('cruce 7: --cm descarta `mismaMoneda` en %s', (_name, kind) => {
    const input = exportInput(cmOverFile, kind);

    expect(input.exchangeRate).toBe(1500);
    // Puede quedar en `false` o sin definir: es lo mismo.
    expect(input.sameCurrency).not.toBe(true);
  });

  it('cruce 7: --misma-moneda descarta `cotizacionMoneda`', () => {
    const input = exportInput(sameOverFile);

    expect(input.sameCurrency).toBe(true);
    expect(input.exchangeRate).toBeUndefined();
  });

  // En la E no son un error (no como en A, B y C): la cotización de `--misma-moneda` se puede escribir.
  it.each<[string, Written]>([
    ['los flags', { args: ['--misma-moneda', '--cm', '1400'] }],
    ['el archivo', { json: { ...rate, mismaMoneda: true } }],
  ])('no cambia: las dos en %s conviven', (_name, written) => {
    expect(exportInput(written)).toMatchObject({ exchangeRate: 1400, sameCurrency: true });
  });

  it('no cambia: `mismaMoneda` en false del archivo no pisa a --misma-moneda', () => {
    expect(exportInput({ args: ['--misma-moneda'], json: { mismaMoneda: false } }).sameCurrency).toBe(true);
  });
});

it('la cotización del archivo no va con otra moneda aunque el archivo diga `mismaMoneda`', () => {
  expect(
    exportInput({ args: ['--moneda', 'EUR'], json: { ...rate, codigoMoneda: 'USD', mismaMoneda: true } }),
  ).toMatchObject({ currencyCode: 'EUR', exchangeRate: undefined, sameCurrency: true });
});

describe('cruces D, E y F: el destino, el cliente y el incoterm', () => {
  const COUNTRY = { cuitPais: 55000002126, paisDestino: 212 };
  const CLIENT = {
    cliente: 'Archivo LLC',
    domicilioCliente: 'Main St 1',
    idImpositivo: 'A-1',
    paisDestino: 212,
  };
  const INCOTERM = { descripcionIncoterm: 'Free on board', incoterm: 'FOB' };

  it.each<[string, Written, Json]>([
    [
      'D: otro --pais-destino descarta `cuitPais`',
      { args: ['--pais-destino', '203'], json: COUNTRY },
      { clientCountryCuit: undefined, destinationCountry: '203' },
    ],
    [
      'D: otro país por nombre',
      { args: ['--pais-destino', 'Chile'], json: { ...COUNTRY, paisDestino: 'Brasil' } },
      { clientCountryCuit: undefined },
    ],
    [
      'D: con --cuit-pais va el del flag',
      { args: ['--pais-destino', '203', '--cuit-pais', '50000000016'], json: COUNTRY },
      { clientCountryCuit: 50000000016 },
    ],
    [
      'D: el mismo código no',
      { args: ['--pais-destino', ' 0212 '], json: COUNTRY },
      { clientCountryCuit: 55000002126 },
    ],
    [
      'D: el mismo nombre, con otras mayúsculas y tildes, no',
      { args: ['--pais-destino', 'MEXICO'], json: { ...COUNTRY, paisDestino: 'México' } },
      { clientCountryCuit: 55000002126 },
    ],
    [
      'D: un archivo sin país no contradice nada',
      { args: ['--pais-destino', '203'], json: { cuitPais: 55000002126 } },
      { clientCountryCuit: 55000002126 },
    ],
    [
      'E: otro --cliente descarta el domicilio y el ID impositivo, y conserva el país',
      { args: ['--cliente', 'Flag LLC'], json: CLIENT },
      { clientAddress: undefined, clientName: 'Flag LLC', clientTaxId: undefined, destinationCountry: '212' },
    ],
    [
      'E: el mismo cliente no',
      { args: ['--cliente', ' ÁRCHIVO  llc '], json: CLIENT },
      { clientAddress: 'Main St 1', clientTaxId: 'A-1' },
    ],
    [
      'E: un archivo sin cliente no contradice nada',
      { args: ['--cliente', 'Flag LLC'], json: { ...CLIENT, cliente: undefined } },
      { clientAddress: 'Main St 1', clientTaxId: 'A-1' },
    ],
    [
      'F: otro --incoterm descarta su descripción',
      { args: ['--incoterm', 'CIF'], json: INCOTERM },
      { incoterm: 'CIF', incotermDescription: undefined },
    ],
    [
      'F: el mismo incoterm no',
      { args: ['--incoterm', ' fob '], json: INCOTERM },
      { incotermDescription: 'Free on board' },
    ],
    [
      'F: con --incoterms-desc va la del flag',
      { args: ['--incoterm', 'CIF', '--incoterms-desc', 'Puerto'], json: INCOTERM },
      { incotermDescription: 'Puerto' },
    ],
  ])('%s', (_name, written, expected) => {
    expect(pick(exportInput(written), expected)).toEqual(expected);
  });
});

describe.each(KINDS.slice(1))('cruces A y G en %s: el comprobante asociado', (_name, kind) => {
  it.each<[string[], Json, Json]>([
    [['--ac', 'nde'], { tipo: 19 }, { shortcut: 'nde' }],
    [['--at', '20'], { atajo: 'fe' }, { arcaType: 20 }],
    // Vacío no identifica nada.
    [['--ac', ''], { cuit: '20111111112', tipo: 19 }, { arcaType: 19, cuit: '20111111112' }],
    // Un atajo que no existe es otro comprobante: el error es de la validación.
    [['--ac', 'zz'], { atajo: 'fe', cuit: '20111111112' }, { shortcut: 'zz' }],
    // Lo del comprobante del archivo no va con otro.
    [['--ac', 'nde'], { atajo: 'fe', cuit: '20111111112', numero: 1 }, { number: 1, shortcut: 'nde' }],
    [['--ar', '9'], { atajo: 'fe', cuit: '20111111112', numero: 1 }, { number: 9, shortcut: 'fe' }],
    [
      ['--apv', '9'],
      { cuit: '20111111112', fecha: '01/09/2026', puntoVenta: 1 },
      { date: '01/09/2026', pointOfSale: 9 },
    ],
    [['--at', '19'], { atajo: 'fe', cuit: '20111111112' }, { arcaType: 19, cuit: '20111111112' }],
    [['--ar', '1'], { cuit: '20111111112', numero: 1 }, { cuit: '20111111112', number: 1 }],
  ])('%j con %j en el archivo', (args, associated, expected) => {
    expect(exportInput({ args, json: { comprobanteAsociado: associated } }, kind).associatedVoucher).toEqual(expected);
  });
});

describe('cruce que queda así (decidido)', () => {
  it('H (decidido: queda así): `--tipo-expo 2` conserva permisos e incoterm del archivo (son de bienes)', () => {
    const json = { incoterm: 'FOB', permisoExistente: true, permisos: ['P1'], tipoExpo: 1 };

    expect(exportInput({ args: ['--tipo-expo', '2'], json })).toMatchObject({
      exportType: 2,
      incoterm: 'FOB',
      permits: ['P1'],
      permitsExisting: true,
    });
  });
});
