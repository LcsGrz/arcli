import { afterEach, describe, expect, it } from 'vitest';

import { stripAnsi } from '../../primitives/text';
import { sectionHeading } from '../sectionHeading';
import { statusBar } from '../statusBar';

describe('lineas de encabezado', () => {
  const original = process.stdout.columns;

  afterEach(() => {
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: original, writable: true });
    delete process.env.ARCLI_ASCII;
  });

  it('la barra de estado lleva titulo y estado y ocupa el ancho disponible', () => {
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 60, writable: true });

    const bar = stripAnsi(statusBar('Modo interactivo', 'testing · PV 3'));

    expect(bar).toMatch(/^━━ MODO INTERACTIVO ━+ testing · PV 3 ━━$/);
    expect(bar).toHaveLength(60);
  });

  it('el titulo de seccion es una sola linea con el nombre', () => {
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 40, writable: true });

    const heading = stripAnsi(sectionHeading('Factura C'));

    expect(heading).toMatch(/^── FACTURA C ─+$/);
    expect(heading).toHaveLength(40);
  });

  it('con ARCLI_ASCII=1 usa caracteres ASCII', () => {
    process.env.ARCLI_ASCII = '1';

    expect(stripAnsi(statusBar('Modo interactivo', 'testing'))).toMatch(/^== MODO INTERACTIVO =+ testing ==$/);
    expect(stripAnsi(sectionHeading('Factura C'))).toMatch(/^-- FACTURA C -+$/);
  });
});
