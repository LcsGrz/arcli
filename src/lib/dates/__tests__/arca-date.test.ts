import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InputValidationError } from '../../errors/app-error';
import {
  addDaysToArcaDate,
  diffArcaDatesInDays,
  formatArcaDateAsArgentineDate,
  formatArcaPeriodAsArgentinePeriod,
  formatDateAsArcaDate,
  maxArcaDate,
  minArcaDate,
  parseArgentineDateInputAsArcaDate,
} from '../arca-date';

const referenceDate = new Date('2026-08-20T12:00:00Z');

describe('arca-date', () => {
  it.each([
    ['18-03-2026', '20260318'],
    ['18/03/2026', '20260318'],
    ['5/8/26', '20260805'],
    ['5-8-26', '20260805'],
    ['05/9', '20260905'],
    ['09-08', '20260809'],
    ['5', '20260805'],
    ['05', '20260805'],
  ])('parses %s as %s', (input, expected) => {
    expect(parseArgentineDateInputAsArcaDate(input, referenceDate)).toBe(expected);
  });

  it('moves an ARCA date by days, across months and years', () => {
    expect(addDaysToArcaDate('20261116', -1)).toBe('20261115');
    expect(addDaysToArcaDate('20260301', -1)).toBe('20260228');
    expect(addDaysToArcaDate('20270101', -1)).toBe('20261231');
    expect(addDaysToArcaDate('20261231', 1)).toBe('20270101');
  });

  it('picks the earliest ARCA date', () => {
    expect(minArcaDate('20261118', '20261116', '20261117')).toBe('20261116');
  });

  it('formats a Date as an ARCA date', () => {
    expect(formatDateAsArcaDate(referenceDate)).toBe('20260820');
  });

  it('uses the Argentine calendar day whatever the machine time zone', () => {
    // 22:30 del 20/08 en Argentina; en UTC ya es el 21.
    expect(formatDateAsArcaDate(new Date('2026-08-21T01:30:00Z'))).toBe('20260820');
    // 00:30 del 21/08 en Argentina.
    expect(formatDateAsArcaDate(new Date('2026-08-21T03:30:00Z'))).toBe('20260821');
  });

  it('completes month and year from the Argentine day', () => {
    // 22:00 del 31/07 en Argentina: "15" es el 15 de julio, aunque en UTC ya sea agosto.
    expect(parseArgentineDateInputAsArcaDate('15', new Date('2026-08-01T01:00:00Z'))).toBe('20260715');
    // 22:00 del 31/12/2026 en Argentina: el ano todavia es 2026.
    expect(parseArgentineDateInputAsArcaDate('1/12', new Date('2027-01-01T01:00:00Z'))).toBe('20261201');
  });

  it.each([
    ['1/12', '2027-01-05T12:00:00Z', '20261201'],
    ['15/1', '2027-01-20T12:00:00Z', '20270115'],
    ['10/1', '2026-12-28T12:00:00Z', '20270110'],
    ['1/10', '2026-11-03T12:00:00Z', '20261001'],
    ['1/5', '2026-11-03T12:00:00Z', '20270501'],
  ])('without a year, %s on %s is the closest date: %s', (input, today, expected) => {
    expect(parseArgentineDateInputAsArcaDate(input, new Date(today))).toBe(expected);
  });

  it('computes day differences across months', () => {
    expect(diffArcaDatesInDays('20260330', '20260402')).toBe(3);
    expect(diffArcaDatesInDays('20260402', '20260330')).toBe(-3);
  });

  it('picks the latest ARCA date', () => {
    expect(maxArcaDate('20260318', '20260402', '20260320')).toBe('20260402');
  });

  it('formats an ARCA date in Argentine format', () => {
    expect(formatArcaDateAsArgentineDate('20260318')).toBe('18/03/2026');
  });

  it('formats an ARCA period as month and year', () => {
    expect(formatArcaPeriodAsArgentinePeriod('201309')).toBe('09/2013');
  });

  it('rejects ISO dates', () => {
    expect(() => parseArgentineDateInputAsArcaDate('2026-08-09', referenceDate)).toThrow(InputValidationError);
    expect(() => parseArgentineDateInputAsArcaDate('2026-08-09', referenceDate)).toThrow(
      /Usá D, DD, D-MM, D\/MM, D-MM-YY, D\/MM\/YY, D-MM-YYYY o D\/MM\/YYYY/,
    );
  });

  it('rejects impossible dates', () => {
    expect(() => parseArgentineDateInputAsArcaDate('31/02/2026', referenceDate)).toThrow(
      /La fecha "31\/02\/2026" no es válida/,
    );
  });

  describe('bisiestos y separadores, con el reloj fijo', () => {
    // Sin `referenceDate`: la fecha sale del reloj, que queda fijo para no depender del día en que corre el test.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2027-11-17T15:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('acepta el 29/02 de un año bisiesto y rechaza el de uno que no lo es', () => {
      expect(parseArgentineDateInputAsArcaDate('29/02/2028')).toBe('20280229');
      expect(parseArgentineDateInputAsArcaDate('29-02-28')).toBe('20280229');
      expect(() => parseArgentineDateInputAsArcaDate('29/02/2027')).toThrow(/La fecha "29\/02\/2027" no es válida/);
      expect(() => parseArgentineDateInputAsArcaDate('29/02/2100')).toThrow(InputValidationError);
      expect(parseArgentineDateInputAsArcaDate('29/02/2000')).toBe('20000229');
    });

    it.each([
      // 17/11/2027: el 29/02 más cercano es el de 2028 (el de 2027 no existe).
      ['2027-11-17T15:00:00Z', '20280229'],
      ['2028-02-20T15:00:00Z', '20280229'],
      ['2028-03-05T15:00:00Z', '20280229'],
      // 1/9/2028: el 29/02/2028 quedó atrás, pero 2029 no tiene 29/02.
      ['2028-09-01T15:00:00Z', '20280229'],
      ['2028-12-31T15:00:00Z', '20280229'],
    ])('29/2 sin año el %s es %s', (now, expected) => {
      vi.setSystemTime(new Date(now));

      expect(parseArgentineDateInputAsArcaDate('29/2')).toBe(expected);
    });

    it('29/2 sin año es error si no hay un 29/02 en el año actual, el anterior ni el siguiente', () => {
      vi.setSystemTime(new Date('2026-06-15T15:00:00Z'));

      expect(() => parseArgentineDateInputAsArcaDate('29/2')).toThrow(/La fecha "29\/2" no es válida/);
    });

    it.each(['5-3/26', '5/3-26', '5/3-2026', '5-03/2026', '5.3.26', '5 3 26', '5//3', '5-'])(
      'rechaza %s (separadores mezclados o que no son - ni /)',
      (input) => {
        expect(() => parseArgentineDateInputAsArcaDate(input)).toThrow(InputValidationError);
      },
    );

    it('rechaza día o mes en cero y años de 3 dígitos', () => {
      expect(() => parseArgentineDateInputAsArcaDate('0/3/26')).toThrow(InputValidationError);
      expect(() => parseArgentineDateInputAsArcaDate('5/0/26')).toThrow(InputValidationError);
      expect(() => parseArgentineDateInputAsArcaDate('5/13/26')).toThrow(InputValidationError);
      expect(() => parseArgentineDateInputAsArcaDate('5/3/202')).toThrow(InputValidationError);
    });
  });
});
