import { describe, expect, it } from 'vitest';

import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
} from '../../../modules/export/export.types';

import { exportInput, type Json, pick, type Written } from './input-precedence.fixtures';

/**
 * REV-52: los cruces entre niveles en la factura E y sus notas. Cada uno va dos veces: como está hoy (esa
 * caracterización se borra en la tanda 4) y, en `it.fails`, como quedó aprobado.
 */

const KINDS = [
  ['factura E', EXPORT_VOUCHER_KIND],
  ['nota de crédito E', EXPORT_CREDIT_NOTE_KIND],
  ['nota de débito E', EXPORT_DEBIT_NOTE_KIND],
] as const;

interface CrossCase {
  readonly approved: Json;
  readonly name: string;
  readonly today: Json;
  readonly written: Written;
}

const rate = { cotizacionMoneda: 1400 };

describe.each(KINDS)('cruce 1 en %s: la cotización del archivo con otra moneda en el flag', (_name, kind) => {
  const cases: readonly CrossCase[] = [
    {
      approved: { currencyCode: 'EUR', exchangeRate: undefined },
      name: '--moneda EUR sobre USD del archivo',
      today: { currencyCode: 'EUR', exchangeRate: 1400 },
      written: { args: ['--moneda', 'EUR'], json: { ...rate, codigoMoneda: 'USD' } },
    },
    {
      approved: { currencyCode: '060', exchangeRate: undefined },
      name: 'sin `codigoMoneda`, la del archivo es DOL: --mda 060',
      today: { currencyCode: '060', exchangeRate: 1400 },
      written: { args: ['--mda', '060'], json: rate },
    },
    {
      // La moneda de la config es de A, B y C.
      approved: { currencyCode: 'EUR', exchangeRate: undefined },
      name: 'la moneda de la config no es la del archivo',
      today: { currencyCode: 'EUR', exchangeRate: 1400 },
      written: { args: ['--moneda', 'EUR'], config: { monedaPorDefecto: 'EUR' }, json: rate },
    },
    {
      approved: { currencyCode: 'ARS', exchangeRate: undefined },
      name: '--moneda ARS sobre USD del archivo',
      today: { currencyCode: 'ARS', exchangeRate: 1400 },
      written: { args: ['--moneda', 'ARS'], json: { ...rate, codigoMoneda: 'USD' } },
    },
  ];

  it.each(cases)('cruce 1, hoy (cambia en la tanda 4): $name', ({ today, written }) => {
    expect(pick(exportInput(written, kind), today)).toEqual(today);
  });

  // Tests primero (REV-52): pasa a it() al implementarlo.
  it.fails.each(cases)('cruce 1, aprobado: $name', ({ approved, written }) => {
    expect(pick(exportInput(written, kind), approved)).toEqual(approved);
  });

  it.each<[string, Written, Json]>([
    [
      'USD y DOL son la misma moneda',
      { args: ['--moneda', 'USD'], json: { ...rate, codigoMoneda: 'DOL' } },
      { exchangeRate: 1400 },
    ],
    [
      'sin `codigoMoneda`, USD es la del archivo',
      { args: ['--moneda', 'usd'], config: { monedaPorDefecto: 'EUR' }, json: rate },
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

describe('cruce 7: --cm y `mismaMoneda` en niveles distintos', () => {
  const cmOverFile = { args: ['--cm', '1500'], json: { mismaMoneda: true } };
  const sameOverFile = { args: ['--misma-moneda'], json: rate };

  it.each(KINDS)('cruce 7, hoy (cambia en la tanda 4): --cm convive con `mismaMoneda` en %s', (_name, kind) => {
    expect(exportInput(cmOverFile, kind)).toMatchObject({ exchangeRate: 1500, sameCurrency: true });
  });

  // Tests primero (REV-52): pasa a it() al implementarlo.
  it.fails.each(KINDS)('cruce 7, aprobado: --cm descarta `mismaMoneda` en %s', (_name, kind) => {
    const input = exportInput(cmOverFile, kind);

    expect(input.exchangeRate).toBe(1500);
    // Puede quedar en `false` o sin definir: es lo mismo.
    expect(input.sameCurrency).not.toBe(true);
  });

  it('cruce 7, hoy (cambia en la tanda 4): --misma-moneda convive con `cotizacionMoneda`', () => {
    expect(exportInput(sameOverFile)).toMatchObject({ exchangeRate: 1400, sameCurrency: true });
  });

  // Tests primero (REV-52): pasa a it() al implementarlo.
  it.fails('cruce 7, aprobado: --misma-moneda descarta `cotizacionMoneda`', () => {
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

/** Cruces que no están en la tabla del diseño: cómo están hoy, sin decidir nada. */
describe('cruces sin decidir en la E (hoy)', () => {
  it('D: `--pais-destino` con `cuitPais` en el archivo informa el CUIT del otro país', () => {
    expect(
      exportInput({ args: ['--pais-destino', '203'], json: { cuitPais: 55000002126, paisDestino: 212 } }),
    ).toMatchObject({ clientCountryCuit: 55000002126, destinationCountry: '203' });
  });

  it('E: `--cliente` conserva el domicilio, el ID impositivo y el país del cliente del archivo', () => {
    const json = { cliente: 'Archivo LLC', domicilioCliente: 'Main St 1', idImpositivo: 'A-1', paisDestino: 212 };

    expect(exportInput({ args: ['--cliente', 'Flag LLC'], json })).toMatchObject({
      clientAddress: 'Main St 1',
      clientName: 'Flag LLC',
      clientTaxId: 'A-1',
      destinationCountry: '212',
    });
  });

  it('F: `--incoterm` conserva la descripción del incoterm del archivo', () => {
    expect(
      exportInput({ args: ['--incoterm', 'CIF'], json: { descripcionIncoterm: 'Free on board', incoterm: 'FOB' } }),
    ).toMatchObject({ incoterm: 'CIF', incotermDescription: 'Free on board' });
  });

  it.each<[string[], Json, Json]>([
    [['--ac', 'nde'], { tipo: 19 }, { arcaType: 19, shortcut: 'nde' }],
    [['--at', '20'], { atajo: 'fe' }, { arcaType: 20, shortcut: 'fe' }],
  ])('G: %j no descarta el tipo del archivo en la nota, como sí en A, B y C', (args, associated, expected) => {
    expect(
      exportInput({ args, json: { comprobanteAsociado: associated } }, EXPORT_CREDIT_NOTE_KIND).associatedVoucher,
    ).toEqual(expected);
  });

  it('H: `--tipo-expo 2` conserva permisos e incoterm del archivo (son de bienes)', () => {
    const json = { incoterm: 'FOB', permisoExistente: true, permisos: ['P1'], tipoExpo: 1 };

    expect(exportInput({ args: ['--tipo-expo', '2'], json })).toMatchObject({
      exportType: 2,
      incoterm: 'FOB',
      permits: ['P1'],
      permitsExisting: true,
    });
  });
});
