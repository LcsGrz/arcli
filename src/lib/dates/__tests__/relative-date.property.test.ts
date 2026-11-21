import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { InputValidationError } from '../../errors/app-error';
import {
  addDaysToArcaDate,
  diffArcaDatesInDays,
  formatArcaDateAsArgentineDate,
  formatDateAsArcaDate,
  parseArgentineDateInputAsArcaDate,
} from '../arca-date';
import { type DateInputRole, MAX_RELATIVE_DAYS } from '../date-input-text';
import { parseRelativeDateAsArcaDate, resolveRelativeDateInput } from '../relative-date';

/** Cualquier instante de 2000 a 2099: cruza fines de mes, de año y los 29 de febrero. */
const instant = fc.date({
  max: new Date('2099-12-31T23:59:59Z'),
  min: new Date('2000-01-01T00:00:00Z'),
  noInvalidDate: true,
});
const role = fc.constantFrom<DateInputRole>('day', 'from', 'to');
const rangeRole = fc.constantFrom<DateInputRole>('from', 'to');
const offset = fc.integer({ max: MAX_RELATIVE_DAYS, min: 0 });
const relativeWord = fc.oneof(
  fc.constantFrom('hoy', 'ayer', 'mes-actual', 'mes-pasado', 'HOY', ' Mes-Pasado '),
  offset.map((days) => `+${days}`),
  offset.map((days) => `-${days}`),
);

function isValidArcaDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function lastDayOfMonth(arcaDate: string): string {
  const year = Number(arcaDate.slice(0, 4));
  const month = Number(arcaDate.slice(4, 6));

  return String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0');
}

function expectInputErrorOr<T>(run: () => T, check: (value: T) => void): void {
  let value: T;

  try {
    value = run();
  } catch (error) {
    expect(error).toBeInstanceOf(InputValidationError);

    return;
  }

  check(value);
}

describe('parseRelativeDateAsArcaDate (propiedades)', () => {
  it('cualquier texto da undefined, una fecha ARCA válida o un error de entrada', () => {
    const text = fc.oneof(fc.string(), relativeWord, fc.stringMatching(/^[+-]?[a-zñ0-9-]{0,12}$/));

    fc.assert(
      fc.property(text, role, instant, (value, dateRole, now) => {
        expectInputErrorOr(
          () => parseRelativeDateAsArcaDate(value, dateRole, now),
          (result) => {
            if (result !== undefined) {
              expect(isValidArcaDate(result)).toBe(true);
            }
          },
        );
      }),
      { numRuns: 300 },
    );
  });

  it('+N y -N están a N días de hoy, también al cruzar meses, años y bisiestos', () => {
    fc.assert(
      fc.property(offset, instant, (days, now) => {
        const today = formatDateAsArcaDate(now);
        const after = parseRelativeDateAsArcaDate(`+${days}`, 'day', now) as string;
        const before = parseRelativeDateAsArcaDate(`-${days}`, 'day', now) as string;

        expect(isValidArcaDate(after) && isValidArcaDate(before)).toBe(true);
        expect(diffArcaDatesInDays(today, after)).toBe(days);
        expect(diffArcaDatesInDays(today, before) + days).toBe(0);
      }),
    );
  });

  it('hoy es +0 y ayer es -1', () => {
    fc.assert(
      fc.property(instant, (now) => {
        expect(parseRelativeDateAsArcaDate('hoy', 'day', now)).toBe(formatDateAsArcaDate(now));
        expect(parseRelativeDateAsArcaDate('+0', 'day', now)).toBe(formatDateAsArcaDate(now));
        expect(parseRelativeDateAsArcaDate('ayer', 'day', now)).toBe(parseRelativeDateAsArcaDate('-1', 'day', now));
      }),
    );
  });

  it('mes-actual y mes-pasado van del día 1 al último del mes, y uno termina el día antes de que empiece el otro', () => {
    fc.assert(
      fc.property(instant, (now) => {
        const today = formatDateAsArcaDate(now);
        const currentFrom = parseRelativeDateAsArcaDate('mes-actual', 'from', now) as string;
        const currentTo = parseRelativeDateAsArcaDate('mes-actual', 'to', now) as string;
        const previousFrom = parseRelativeDateAsArcaDate('mes-pasado', 'from', now) as string;
        const previousTo = parseRelativeDateAsArcaDate('mes-pasado', 'to', now) as string;

        for (const [from, to] of [
          [currentFrom, currentTo],
          [previousFrom, previousTo],
        ]) {
          expect(isValidArcaDate(from) && isValidArcaDate(to)).toBe(true);
          expect(from.slice(6)).toBe('01');
          expect(to.slice(6)).toBe(lastDayOfMonth(from));
          expect(from.slice(0, 6)).toBe(to.slice(0, 6));
          expect(from <= to).toBe(true);
        }

        expect(currentFrom <= today && today <= currentTo).toBe(true);
        expect(addDaysToArcaDate(previousTo, 1)).toBe(currentFrom);
      }),
    );
  });

  it('desde ≤ hasta con la misma palabra en las dos puntas', () => {
    fc.assert(
      fc.property(relativeWord, instant, (word, now) => {
        const from = parseRelativeDateAsArcaDate(word, 'from', now) as string;
        const to = parseRelativeDateAsArcaDate(word, 'to', now) as string;

        expect(from <= to).toBe(true);
      }),
    );
  });

  it('desde y hasta respetan el orden de las palabras: si una es anterior a la otra, sus fechas también', () => {
    // Días desde hoy de cada punta: el rango "desde" de una palabra de mes empieza antes que cualquier día de ese mes.
    const dayWord = fc.oneof(
      offset.map((days) => ({ days, word: `+${days}` })),
      offset.map((days) => ({ days: -days, word: `-${days}` })),
      fc.constant({ days: 0, word: 'hoy' }),
      fc.constant({ days: -1, word: 'ayer' }),
    );

    fc.assert(
      fc.property(dayWord, dayWord, instant, (first, second, now) => {
        const from = parseRelativeDateAsArcaDate(first.word, 'from', now) as string;
        const to = parseRelativeDateAsArcaDate(second.word, 'to', now) as string;

        expect(from <= to).toBe(first.days <= second.days);
      }),
    );
  });

  it('una palabra de mes en una fecha de un día es un error de entrada', () => {
    fc.assert(
      fc.property(fc.constantFrom('mes-actual', 'mes-pasado', 'MES-ACTUAL'), instant, (word, now) => {
        expect(() => parseRelativeDateAsArcaDate(word, 'day', now)).toThrow(InputValidationError);
      }),
    );
  });

  it('más de MAX_RELATIVE_DAYS es un error de entrada, no una fecha fuera de rango', () => {
    fc.assert(
      fc.property(
        fc.integer({ max: Number.MAX_SAFE_INTEGER, min: MAX_RELATIVE_DAYS + 1 }),
        fc.constantFrom('+', '-'),
        rangeRole,
        instant,
        (days, sign, dateRole, now) => {
          expect(() => parseRelativeDateAsArcaDate(`${sign}${days}`, dateRole, now)).toThrow(InputValidationError);
        },
      ),
    );
  });
});

describe('resolveRelativeDateInput (propiedades)', () => {
  it('lo que devuelve para una palabra relativa se lee de vuelta como la misma fecha', () => {
    fc.assert(
      fc.property(relativeWord, rangeRole, instant, (word, dateRole, now) => {
        const resolved = resolveRelativeDateInput(word, dateRole, now);
        const expected = parseRelativeDateAsArcaDate(word, dateRole, now) as string;

        expect(resolved).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
        expect(parseArgentineDateInputAsArcaDate(resolved, now)).toBe(expected);
      }),
    );
  });
});

describe('parseArgentineDateInputAsArcaDate (propiedades)', () => {
  const arcaDay = fc
    .date({ max: new Date('2099-12-31T00:00:00Z'), min: new Date('2000-01-01T00:00:00Z'), noInvalidDate: true })
    .map((date) => date.toISOString().slice(0, 10).replace(/-/g, ''));

  it('cualquier texto da una fecha ARCA válida o un error de entrada', () => {
    const dateLike = fc.stringMatching(/^\s?\d{0,3}([-/]\d{0,3}([-/]\d{0,5})?)?\s?$/);

    fc.assert(
      fc.property(fc.oneof(fc.string(), dateLike), instant, (value, now) => {
        expectInputErrorOr(
          () => parseArgentineDateInputAsArcaDate(value, now),
          (result) => expect(isValidArcaDate(result)).toBe(true),
        );
      }),
      { numRuns: 300 },
    );
  });

  it('DD/MM/YYYY y D-M-YY vuelven a la misma fecha', () => {
    fc.assert(
      fc.property(arcaDay, instant, (arcaDate, now) => {
        const day = String(Number(arcaDate.slice(6, 8)));
        const month = String(Number(arcaDate.slice(4, 6)));

        expect(parseArgentineDateInputAsArcaDate(formatArcaDateAsArgentineDate(arcaDate), now)).toBe(arcaDate);
        expect(parseArgentineDateInputAsArcaDate(`${day}-${month}-${arcaDate.slice(2, 4)}`, now)).toBe(arcaDate);
      }),
    );
  });

  it('sin año elige la fecha más cercana a hoy: a medio año o menos (salvo el 29/02)', () => {
    fc.assert(
      fc.property(arcaDay, instant, (arcaDate, now) => {
        fc.pre(!arcaDate.endsWith('0229'));

        const result = parseArgentineDateInputAsArcaDate(`${arcaDate.slice(6, 8)}/${arcaDate.slice(4, 6)}`, now);

        expect(result.slice(4)).toBe(arcaDate.slice(4));
        expect(Math.abs(diffArcaDatesInDays(formatDateAsArcaDate(now), result))).toBeLessThanOrEqual(183);
      }),
    );
  });

  it('sumar N días y medir la diferencia da N', () => {
    fc.assert(
      fc.property(arcaDay, fc.integer({ max: 5000, min: -5000 }), (arcaDate, days) => {
        const moved = addDaysToArcaDate(arcaDate, days);

        expect(isValidArcaDate(moved)).toBe(true);
        expect(diffArcaDatesInDays(arcaDate, moved)).toBe(days);
      }),
    );
  });
});
