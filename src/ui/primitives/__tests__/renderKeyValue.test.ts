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

  it('sangra las filas y muestra N/D si falta el valor', () => {
    expect(renderKeyValueRows([['Alias', '']], { indent: 2 }).map(stripAnsi)).toEqual(['  Alias  N/D']);
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
