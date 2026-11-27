import { describe, expect, it } from 'vitest';

import { plainText } from '../../../testing/terminal-layout';
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
