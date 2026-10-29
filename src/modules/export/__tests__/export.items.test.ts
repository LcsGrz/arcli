import { describe, expect, it } from 'vitest';

import { buildExportItems, parseExportItemArgument, resolveUnitCode } from '../export.items';
import type { ExportUnit } from '../export.types';

const UNITS: readonly ExportUnit[] = [
  { id: 1, name: 'kilogramos' },
  { id: 7, name: 'unidades' },
];

describe('parseExportItemArgument', () => {
  it('reads codigo|descripcion|cantidad|precio|unidad', () => {
    expect(parseExportItemArgument('001|Servicio de consultoria|2|1.500,50|unidad')).toEqual({
      code: '001',
      description: 'Servicio de consultoria',
      quantity: 2,
      unit: 'unidad',
      unitPrice: 1500.5,
    });
  });

  it('omite el codigo con cuatro partes', () => {
    expect(parseExportItemArgument('Servicio|1|1000|kg')).toEqual({
      code: undefined,
      description: 'Servicio',
      quantity: 1,
      unit: 'kg',
      unitPrice: 1000,
    });
  });

  it('usa la unidad por defecto con tres partes', () => {
    expect(parseExportItemArgument('Servicio|1|1000')).toMatchObject({ description: 'Servicio', unit: 7 });
  });

  it('rechaza un item con menos partes que las necesarias', () => {
    expect(() => parseExportItemArgument('Servicio|1')).toThrow(/no es valido/);
  });

  it('rechaza importes con formato invalido', () => {
    expect(() => parseExportItemArgument('Servicio|1|1000.50')).toThrow(/el precio del item/i);
  });
});

describe('resolveUnitCode', () => {
  it('busca el nombre en la tabla de ARCA, sin importar mayusculas', () => {
    expect(resolveUnitCode('kilogramos', UNITS)).toBe(1);
    expect(resolveUnitCode(' UNIDADES ', UNITS)).toBe(7);
  });

  it('acepta el singular que usan los ejemplos del CLI', () => {
    expect(resolveUnitCode('kilogramo', UNITS)).toBe(1);
    expect(resolveUnitCode('unidad', UNITS)).toBe(7);
  });

  it('rechaza un nombre que no esta en la tabla', () => {
    expect(() => resolveUnitCode('kg', UNITS)).toThrow(/no existe en la tabla/);
  });

  it('acepta el codigo numerico y lo valida contra la tabla', () => {
    expect(resolveUnitCode(7, UNITS)).toBe(7);
    expect(() => resolveUnitCode(99, UNITS)).toThrow(/no existe en la tabla/);
  });

  it('usa unidad cuando el item no la informa', () => {
    expect(resolveUnitCode(undefined, UNITS)).toBe(7);
  });
});

describe('buildExportItems', () => {
  it('resume el comprobante en un renglon cuando no hay items', () => {
    expect(buildExportItems(undefined, 1500, UNITS, 'Segun detalle')).toEqual({
      items: [
        {
          Pro_bonificacion: 0,
          Pro_codigo: '',
          Pro_ds: 'Segun detalle',
          Pro_precio_uni: 1500,
          Pro_qty: 1,
          Pro_total_item: 1500,
          Pro_umed: 7,
        },
      ],
      total: 1500,
    });
  });

  it('suma los items con dos decimales, sin errores de coma flotante', () => {
    const result = buildExportItems(
      [
        { description: 'Uno', quantity: 1, unitPrice: 100.1, unit: 7 },
        { description: 'Dos', quantity: 1, unitPrice: 200.2, unit: 7 },
      ],
      300.3,
      UNITS,
      'Segun detalle',
    );

    expect(result.total).toBe(300.3);
    expect(result.items.map((item) => item.Pro_total_item)).toEqual([100.1, 200.2]);
  });

  it('falla si la suma de los items no da el monto total', () => {
    expect(() =>
      buildExportItems([{ description: 'Uno', quantity: 1, unitPrice: 100, unit: 7 }], 150, UNITS, 'Segun detalle'),
    ).toThrow(/no coincide con --monto/);
  });

  it('rechaza cantidades y precios que no son positivos', () => {
    expect(() =>
      buildExportItems([{ description: 'Uno', quantity: 0, unitPrice: 100 }], 0, UNITS, 'Segun detalle'),
    ).toThrow(/cantidad/);

    expect(() => {
      buildExportItems([{ description: 'Uno', quantity: 1, unitPrice: 0 }], 1, UNITS, 'Segun detalle');
    }).toThrow(/precio/);
  });
});
