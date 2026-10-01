import { describe, expect, it } from 'vitest';

import { InputValidationError } from '../../errors/app-error';
import {
  diffArcaDatesInDays,
  formatArcaDateAsArgentineDate,
  formatDateAsArcaDate,
  maxArcaDate,
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

  it('formats a Date as an ARCA date', () => {
    expect(formatDateAsArcaDate(referenceDate)).toBe('20260820');
  });

  it('formats using the local calendar day', () => {
    expect(formatDateAsArcaDate(new Date(2026, 7, 20, 23, 30))).toBe('20260820');
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

  it('rejects ISO dates', () => {
    expect(() => parseArgentineDateInputAsArcaDate('2026-08-09', referenceDate)).toThrow(InputValidationError);
    expect(() => parseArgentineDateInputAsArcaDate('2026-08-09', referenceDate)).toThrow(
      /Use D, DD, D-MM, D\/MM, D-MM-YY, D\/MM\/YY, D-MM-YYYY o D\/MM\/YYYY/,
    );
  });

  it('rejects impossible dates', () => {
    expect(() => parseArgentineDateInputAsArcaDate('31/02/2026', referenceDate)).toThrow(
      /La fecha "31\/02\/2026" no es valida/,
    );
  });
});
