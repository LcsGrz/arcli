import { describe, expect, it } from 'vitest';

import { InputValidationError } from '../../errors/app-error';
import { currentMonthPeriod, monthArcaPeriod, previousMonthPeriod } from '../periods';
import {
  MAX_RELATIVE_DAYS,
  parseDateInputAsArcaDate,
  parseRelativeDateAsArcaDate,
  resolveRelativeDateInput,
} from '../relative-date';

// Mediodia en Argentina (UTC-3): el dia es el mismo en cualquier zona razonable.
const at = (date: string) => new Date(`${date}T15:00:00Z`);

describe('parseRelativeDateAsArcaDate', () => {
  it.each([
    ['hoy', '2026-08-20', '20260820'],
    ['ayer', '2026-08-20', '20260819'],
    ['ayer', '2026-01-01', '20251231'],
    ['ayer', '2028-03-01', '20280229'],
    ['+1', '2026-08-31', '20260901'],
    ['+10', '2026-12-25', '20270104'],
    ['-1', '2026-03-01', '20260228'],
    ['-0', '2026-08-20', '20260820'],
    ['+0', '2026-08-20', '20260820'],
    [`+${MAX_RELATIVE_DAYS}`, '2026-08-20', '20290515'],
  ])('%s el %s es %s', (value, today, expected) => {
    expect(parseRelativeDateAsArcaDate(value, 'day', at(today))).toBe(expected);
  });

  it.each([
    ['mes-actual', 'from', '2026-08-20', '20260801'],
    ['mes-actual', 'to', '2026-08-20', '20260831'],
    ['mes-actual', 'to', '2028-02-10', '20280229'],
    ['mes-pasado', 'from', '2026-01-01', '20251201'],
    ['mes-pasado', 'to', '2026-01-01', '20251231'],
    ['mes-pasado', 'from', '2028-03-31', '20280201'],
    ['mes-pasado', 'to', '2028-03-31', '20280229'],
    ['mes-pasado', 'to', '2027-03-31', '20270228'],
    ['mes-pasado', 'to', '2026-05-31', '20260430'],
  ] as const)('%s en %s el %s es %s', (value, role, today, expected) => {
    expect(parseRelativeDateAsArcaDate(value, role, at(today))).toBe(expected);
  });

  it('usa la fecha argentina aunque en UTC ya sea el dia siguiente', () => {
    // 22 hs del 31/12 en Argentina: en UTC ya es 1/1.
    const now = new Date('2027-01-01T01:00:00Z');

    expect(parseRelativeDateAsArcaDate('hoy', 'day', now)).toBe('20261231');
    expect(parseRelativeDateAsArcaDate('mes-actual', 'to', now)).toBe('20261231');
  });

  it('no distingue mayusculas ni espacios alrededor', () => {
    expect(parseRelativeDateAsArcaDate(' HOY ', 'day', at('2026-08-20'))).toBe('20260820');
    expect(parseRelativeDateAsArcaDate('Mes-Pasado', 'from', at('2026-08-20'))).toBe('20260701');
  });

  it.each(['18/03/2026', '5', '05-9', '', '  '])('deja pasar %j: no es relativa', (value) => {
    expect(parseRelativeDateAsArcaDate(value, 'day', at('2026-08-20'))).toBeUndefined();
  });

  it.each(['+', '-', '+abc', '+1.5', '+-1', 'mañana', 'semana-pasada', 'año-pasado'])('rechaza %j', (value) => {
    expect(() => parseRelativeDateAsArcaDate(value, 'from', at('2026-08-20'))).toThrow(InputValidationError);
  });

  it('rechaza un N mayor al tope', () => {
    expect(() => parseRelativeDateAsArcaDate(`+${MAX_RELATIVE_DAYS + 1}`, 'day', at('2026-08-20'))).toThrow(
      /hasta 999 días/,
    );
  });

  it('rechaza una palabra de mes en una fecha de un dia', () => {
    expect(() => parseRelativeDateAsArcaDate('mes-pasado', 'day', at('2026-08-20'))).toThrow(
      /valen solo en desde y hasta/,
    );
  });
});

// TUI-18, tests primero: el punto de entrada comun de "texto del usuario -> fecha ARCA", para flags y asistente.
describe('parseDateInputAsArcaDate', () => {
  it.each([
    ['hoy', 'day', '2026-11-18', '20261118'],
    ['ayer', 'day', '2026-11-18', '20261117'],
    ['-3', 'day', '2026-11-18', '20261115'],
    ['+15', 'day', '2026-11-18', '20261203'],
    ['mes-pasado', 'from', '2026-11-18', '20261001'],
    ['mes-pasado', 'to', '2026-11-18', '20261031'],
    ['16/11/2026', 'day', '2026-11-18', '20261116'],
    // Sin año, la fecha mas cercana al `now` inyectado, no a la fecha real.
    ['10/1', 'day', '2026-12-28', '20270110'],
    ['5', 'day', '2026-11-18', '20261105'],
  ] as const)('%s (%s) el %s es %s', (value, role, today, expected) => {
    expect(parseDateInputAsArcaDate(value, role, at(today))).toBe(expected);
  });

  it('una fecha mal escrita dice que tambien valen las relativas', () => {
    expect(() => parseDateInputAsArcaDate('32/10', 'day', at('2026-11-18'))).toThrow(InputValidationError);
    expect(() => parseDateInputAsArcaDate('32/10', 'day', at('2026-11-18'))).toThrow(/`hoy`, `ayer`, `\+N` o `-N`/);
  });

  it('una relativa invalida da el error de la relativa', () => {
    expect(() => parseDateInputAsArcaDate('+1000', 'day', at('2026-11-18'))).toThrow(/hasta 999 días/);
    expect(() => parseDateInputAsArcaDate('mes-pasado', 'day', at('2026-11-18'))).toThrow(
      /valen solo en desde y hasta/,
    );
  });
});

describe('resolveRelativeDateInput', () => {
  it('pasa la palabra a DD/MM/YYYY y deja igual la fecha a mano', () => {
    const now = at('2026-01-01');

    expect(resolveRelativeDateInput('mes-pasado', 'to', now)).toBe('31/12/2025');
    expect(resolveRelativeDateInput('5/1', 'day', now)).toBe('5/1');
    expect(resolveRelativeDateInput(undefined, 'day', now)).toBeUndefined();
  });
});

describe('periods', () => {
  it('builds the current and previous month, also across years', () => {
    expect(currentMonthPeriod(new Date('2026-02-10T15:00:00Z'))).toEqual({ from: '01/02/2026', to: '28/02/2026' });
    expect(previousMonthPeriod(new Date('2026-01-10T15:00:00Z'))).toEqual({ from: '01/12/2025', to: '31/12/2025' });
    expect(monthArcaPeriod(new Date('2028-03-31T15:00:00Z'), 1)).toEqual({ from: '20280201', to: '20280229' });
  });
});
