import { describe, expect, it } from 'vitest';

import { InputValidationError } from '../../errors/app-error';
import { formatDateAsArcaDate, parseArgentineDateInputAsArcaDate } from '../arca-date';

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
