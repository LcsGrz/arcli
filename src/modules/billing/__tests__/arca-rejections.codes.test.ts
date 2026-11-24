import { describe, expect, it } from 'vitest';

import { ARCA_REJECTIONS, findArcaRejections } from '../arca-rejections';

// Un texto que no matchea ningún patrón: la guía tiene que salir solo por el código (TEST-19).
const UNRELATED_MESSAGE = 'Mensaje de ARCA con otra redacción';

describe('rechazos de ARCA por código, sin depender del texto (TEST-19)', () => {
  it('10005 y 11002: el punto de venta no habilitado para web service', () => {
    for (const code of [10005, 11002]) {
      const found = findArcaRejections([code], UNRELATED_MESSAGE);

      expect(found, `código ${code}`).toHaveLength(1);
      expect(found[0]?.what).toMatch(/punto de venta no está habilitado/);
    }
  });

  it('10152: la fecha futura en otro mes', () => {
    const found = findArcaRejections([10152], UNRELATED_MESSAGE);

    expect(found).toHaveLength(1);
    expect(found[0]?.what).toMatch(/futura y cae en otro mes/);
  });

  it('cada código de la tabla encuentra su fila con un texto que no matchea', () => {
    for (const rejection of ARCA_REJECTIONS) {
      for (const code of rejection.codes) {
        expect(findArcaRejections([code], UNRELATED_MESSAGE), `código ${code}`).toEqual([rejection]);
      }
    }
  });

  it('el patrón del punto de venta sigue andando sin código', () => {
    const found = findArcaRejections([], 'El punto de venta 3 no es de tipo RECE');

    expect(found.map((rejection) => rejection.codes)).toEqual([[10005, 11002]]);
  });

  it('ni código conocido ni texto que matchee: nada', () => {
    expect(findArcaRejections([12345], UNRELATED_MESSAGE)).toEqual([]);
    expect(findArcaRejections([], '')).toEqual([]);
  });
});

it('solo las filas con `retry` proponen emitir de nuevo: con CAE no se muestran (ERR-20)', () => {
  for (const { retry, todo } of ARCA_REJECTIONS) {
    expect(/volv[eé] a (?:emitir|intentar)|reintent|emití(?!s)|^Usá /i.test(todo), todo).toBe(retry === true);
  }
});
