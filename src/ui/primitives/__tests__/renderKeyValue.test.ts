import { describe, expect, it } from 'vitest';

import { renderKeyValueRows, resolveKeyValueLabelWidth } from '../renderKeyValue';
import { stripAnsi } from '../text';

describe('renderKeyValueRows', () => {
  it('alinea los valores en una columna, con la etiqueta más larga si no se pasa ancho', () => {
    const lines = renderKeyValueRows([
      ['CUIT', '20-33333333-4'],
      ['Punto de venta', 3],
    ]).map(stripAnsi);

    expect(lines).toEqual(['CUIT            20-33333333-4', 'Punto de venta  3']);
  });

  it('alinea la columna con etiquetas con emoji, CJK o é NFD', () => {
    const lines = renderKeyValueRows([
      ['🧾 Total', '1'],
      ['東京', '2'],
      ['Razén', '3'],
    ]).map(stripAnsi);

    expect(lines).toEqual(['🧾 Total  1', '東京      2', 'Razén     3']);
  });

  it('sangra las filas y no muestra las que no tienen valor', () => {
    const lines = renderKeyValueRows(
      [
        ['Alias', ''],
        ['CUIT', '20-11111111-2'],
        ['Fecha', undefined],
        ['Nota', null],
        ['Cero', 0],
      ],
      { indent: 2 },
    ).map(stripAnsi);

    expect(lines).toEqual(['  CUIT  20-11111111-2', '  Cero  0']);
  });
});

describe('resolveKeyValueLabelWidth', () => {
  it('usa la misma proporción del panel en todas las pantallas del mismo ancho', () => {
    expect(resolveKeyValueLabelWidth('standard', [['CUIT', '']])).toBe(
      resolveKeyValueLabelWidth('standard', [['Punto de venta', '']]),
    );
  });

  it('no corta una etiqueta más larga que la columna', () => {
    const label = 'Una etiqueta bastante más larga que la columna';

    expect(resolveKeyValueLabelWidth('standard', [[label, '']])).toBe(label.length);
  });
});
