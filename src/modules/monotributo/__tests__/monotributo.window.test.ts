import { afterEach, describe, expect, it, vi } from 'vitest';

import { inverseColumns, plainText } from '../../../testing/terminal-layout';
import { BUNDLED_MONOTRIBUTO_TABLE } from '../monotributo.bundled';
import {
  enterMonotributoColumnWindow,
  formatMonotributoBlockAsText,
  type MonotributoReport,
  moveMonotributoColumnWindow,
} from '../monotributo.presenter';

/** La ventana de columnas de "Ver todas las columnas" (TUI-27), con el ancho fijo. Datos: la tabla incluida. */

const REPORT: MonotributoReport = {
  consultedOn: '20261118',
  notices: [],
  ownCategory: 'E',
  source: 'arca',
  table: BUNDLED_MONOTRIBUTO_TABLE,
  version: '2.6.0',
};

// El contenido de un panel en una terminal de 72 columnas.
const WIDTH = 66;

describe('ventana de columnas', () => {
  it('si el bloque entra entero (con 2 entre columnas) no hay ventana', () => {
    expect(enterMonotributoColumnWindow(REPORT, 'limites', 'left', { width: 86 })).toBeUndefined();
    // La cuota entra justo con 2: tampoco.
    expect(enterMonotributoColumnWindow(REPORT, 'cuota', 'left', { width: 86 })).toBeUndefined();
  });

  it('si no entra ni una columna, sin ventana: el bloque va apilado', () => {
    expect(enterMonotributoColumnWindow(REPORT, 'limites', 'left', { width: 18 })).toBeUndefined();
  });

  it('entrando desde la derecha, termina en la última columna, con todas las que entran', () => {
    expect(enterMonotributoColumnWindow(REPORT, 'limites', 'right', { width: WIDTH })).toEqual({
      first: 2,
      last: 5,
      total: 5,
    });
  });

  it('en los bordes no hay a dónde moverse', () => {
    const start = enterMonotributoColumnWindow(REPORT, 'limites', 'left', { width: WIDTH });
    const end = enterMonotributoColumnWindow(REPORT, 'limites', 'right', { width: WIDTH });

    expect(start && moveMonotributoColumnWindow(REPORT, 'limites', start, 'left', { width: WIDTH })).toBeUndefined();
    expect(end && moveMonotributoColumnWindow(REPORT, 'limites', end, 'right', { width: WIDTH })).toBeUndefined();
  });

  it('si la columna nueva es más ancha, sale más de una del otro lado', () => {
    // De SUPERFICIE y ENERGÍA (angostas) a INGRESOS (ancha): con 40 de contenido no entran las tres.
    const moved = moveMonotributoColumnWindow(REPORT, 'limites', { first: 2, last: 3, total: 5 }, 'left', {
      width: 40,
    });

    expect(moved).toEqual({ first: 1, last: 2, total: 5 });
  });

  it('siempre con todas las que entran: → desde 2 a 4 crece a 2 a 5 si entra', () => {
    expect(
      moveMonotributoColumnWindow(REPORT, 'limites', { first: 2, last: 4, total: 5 }, 'right', { width: WIDTH }),
    ).toEqual({ first: 2, last: 5, total: 5 });
    // ← igual al revés: la nueva a la izquierda y todas las que entran hacia la derecha.
    expect(
      moveMonotributoColumnWindow(REPORT, 'limites', { first: 3, last: 4, total: 5 }, 'left', { width: WIDTH }),
    ).toEqual({ first: 2, last: 5, total: 5 });
  });

  it('si una columna sola no entra, el bloque va apilado entrando por cualquier lado', () => {
    // 23 de contenido: INGRESOS ($ 126.610.838,75) no entra ni sola con CAT.; las demás sí.
    expect(enterMonotributoColumnWindow(REPORT, 'limites', 'left', { width: 23 })).toBeUndefined();
    expect(enterMonotributoColumnWindow(REPORT, 'limites', 'right', { width: 23 })).toBeUndefined();
  });

  it('si la ventana ya no entra (la terminal se achicó), va apilado y sin el indicador', () => {
    const text = plainText(
      formatMonotributoBlockAsText(REPORT, 'limites', {
        navigation: 'flechas',
        width: 34,
        window: { first: 1, last: 3, total: 5 },
      }),
    );

    expect(text).toMatch(/❯ E\s*\n +ingresos +\$ 36\.028\.231,33/);
    expect(text).not.toMatch(/columnas \d+ a \d+ de \d+/);
  });

  it('el bloque con ventana dice qué columnas se ven y no se apila', () => {
    const text = plainText(
      formatMonotributoBlockAsText(REPORT, 'limites', {
        navigation: 'flechas',
        width: WIDTH,
        window: { first: 2, last: 4, total: 5 },
      }),
    );

    expect(text).toMatch(/CAT\. +SUPERFICIE +ENERGÍA +ALQUILERES\s/);
    expect(text).not.toContain('INGRESOS');
    expect(text).toContain('←  columnas 2 a 4 de 5  →');
  });
});

describe('--completa apilado', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('con color, la categoría propia lleva el fondo en la letra y en cada dato', () => {
    vi.stubEnv('FORCE_COLOR', '1');

    const lines = formatMonotributoBlockAsText(REPORT, 'limites', { navigation: 'apilados', width: 34 }).split('\n');
    const start = lines.findIndex((line) => /❯ E/.test(plainText(line)));
    const marked = lines.flatMap((line, index) => (inverseColumns(line).length > 0 ? [index] : []));

    // La letra y sus cinco datos, seguidos; nada más.
    expect(marked).toEqual([start, start + 1, start + 2, start + 3, start + 4, start + 5]);
    expect(plainText(lines[start + 1] ?? '')).toMatch(/ingresos +\$ 36\.028\.231,33/);
  });
});
