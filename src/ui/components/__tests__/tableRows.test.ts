import { describe, expect, it } from 'vitest';

import { colorize, stripAnsi } from '../../primitives/text';
import { formatTableRows } from '../tableRows';

describe('formatTableRows', () => {
  it('alinea cada columna con la más ancha, incluido el encabezado, y deja la última sin rellenar', () => {
    expect(
      formatTableRows(
        ['CÓDIGO', 'PAÍS'],
        [
          ['203', 'BRASIL'],
          ['212', 'ESTADOS UNIDOS'],
        ],
      ),
    ).toEqual({
      header: 'CÓDIGO  PAÍS',
      rows: ['203     BRASIL', '212     ESTADOS UNIDOS'],
    });
  });

  it('los colores no cuentan para el ancho', () => {
    const { rows } = formatTableRows(['CUIT', 'PAÍS'], [[colorize('55000002126', 'muted'), 'ESTADOS UNIDOS']]);

    expect(stripAnsi(rows[0] ?? '')).toBe('55000002126  ESTADOS UNIDOS');
  });
});
