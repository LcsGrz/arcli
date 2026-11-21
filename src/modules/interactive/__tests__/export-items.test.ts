import { describe, expect, it } from 'vitest';

import { buildExportItems } from '../../export/export.items';
import {
  applyExportItemEdits,
  describeExportItem,
  exportItemsEntry,
  exportItemsTotal,
  FIRST_EXPORT_ITEM_DEFAULTS,
  summaryExportItem,
} from '../export-items';

const UNITS = [
  { id: 5, name: 'litros' },
  { id: 7, name: 'unidades' },
];

const JUICE = { description: 'Jugo de naranja', quantity: 100, unit: 5, unitPrice: 2.5 };
const FREIGHT = { description: 'Flete', quantity: 1, unit: 7, unitPrice: 300 };

describe('ítems de la E en el asistente (NAV-10)', () => {
  it('el primero arranca con "Según detalle", 1 y unidades (7), sin precio', () => {
    expect(FIRST_EXPORT_ITEM_DEFAULTS).toEqual({ description: 'Según detalle', quantity: 1, unit: 7 });
  });

  it('un renglón por el total es lo mismo que el CLI arma sin `--item`: la misma solicitud a ARCA', () => {
    const total = 1500.5;
    const units = [{ id: 7, name: 'unidades' }];

    expect(summaryExportItem(total)).toEqual({ description: 'Según detalle', quantity: 1, unit: 7, unitPrice: total });
    expect(buildExportItems([summaryExportItem(total)], total, units, 'Según detalle')).toEqual(
      buildExportItems(undefined, total, units, 'Según detalle'),
    );
  });

  it('el total es la suma, con cada renglón redondeado a dos decimales como el CLI; sin ítems no hay total', () => {
    expect(exportItemsTotal([JUICE, FREIGHT])).toBe(550);
    expect(exportItemsTotal([{ ...FREIGHT, quantity: 3, unitPrice: 0.335 }])).toBe(1.01);
    expect(exportItemsTotal([])).toBeUndefined();
    expect(exportItemsTotal(undefined)).toBeUndefined();
  });

  it('describe cada ítem con su unidad de la tabla, el precio con todos sus decimales y el total en la moneda', () => {
    expect(describeExportItem(JUICE, UNITS, 'DOL')).toEqual({
      detail: '100 litros x 2,50 USD',
      title: 'Jugo de naranja',
      total: '250 USD',
    });
    expect(describeExportItem({ ...FREIGHT, quantity: 0.125, unitPrice: 1000.123456 }, UNITS, 'PES')).toEqual({
      detail: '0,125 unidades x $ 1.000,123456',
      title: 'Flete',
      total: '$ 125,02',
    });
    // Una unidad que no está en la tabla, o escrita por nombre, sale como vino.
    expect(describeExportItem({ ...FREIGHT, unit: 99 }, UNITS, 'DOL').detail).toBe('1 unidad 99 x 300 USD');
    expect(describeExportItem({ ...FREIGHT, unit: 'cajas' }, UNITS, 'DOL').detail).toBe('1 cajas x 300 USD');
    expect(describeExportItem({ ...FREIGHT, unit: undefined }, UNITS, 'DOL').detail).toBe('1 unidades x 300 USD');
    expect(describeExportItem(FREIGHT, [{ id: 7, name: ' unidades ' }], 'DOL').detail).toBe('1 unidades x 300 USD');
    expect(describeExportItem({ ...FREIGHT, description: '  Flete  ' }, UNITS, 'DOL').title).toBe('Flete');
  });

  it('aplicar las marcas del editor: borra, y vuelve a preguntar los marcados en su posición nueva', () => {
    expect(applyExportItemEdits([JUICE, FREIGHT, JUICE], { edit: [2], remove: [1] })).toEqual({
      edit: [1],
      items: [JUICE, JUICE],
    });
  });

  it('nunca deja la lista vacía: si las marcas borrarían todo, no borra nada', () => {
    expect(applyExportItemEdits([JUICE], { edit: [], remove: [0] })).toEqual({ edit: [], items: [JUICE] });
    expect(applyExportItemEdits([JUICE, FREIGHT], { edit: [1], remove: [0, 1] })).toEqual({
      edit: [1],
      items: [JUICE, FREIGHT],
    });
  });

  it('un solo renglón sin código, de 1 unidad y por el total va en la forma rápida: `-m` y `--descripcion`', () => {
    expect(exportItemsEntry([{ description: 'Consultoría', quantity: 1, unit: 7, unitPrice: 1500.5 }])).toEqual({
      amount: 1500.5,
      description: 'Consultoría',
    });
    // Con la descripción por defecto, ni `--descripcion`: el CLI arma ese mismo renglón.
    expect(exportItemsEntry([summaryExportItem(1500)])).toEqual({ amount: 1500, description: undefined });
    expect(exportItemsEntry([{ description: ' Consultoría ', quantity: 1, unitPrice: 10 }])).toEqual({
      amount: 10,
      description: 'Consultoría',
    });
  });

  it('en cualquier otro caso, un `--item` por renglón', () => {
    const cases = [
      [JUICE, FREIGHT],
      [{ ...FREIGHT, quantity: 2 }],
      [{ ...FREIGHT, unit: 5 }],
      [{ ...FREIGHT, code: 'F-1' }],
      // Un precio con más de dos decimales: el CLI mandaría el total redondeado como precio.
      [{ ...FREIGHT, unitPrice: 300.005 }],
      // Suma lo mismo que el precio, pero la cantidad no es 1: el CLI mandaría 1.
      [{ ...FREIGHT, quantity: 1.001, unitPrice: 1 }],
    ];

    for (const items of cases) {
      expect(exportItemsEntry(items)).toEqual({ amount: exportItemsTotal(items), items });
    }

    expect(exportItemsEntry([{ ...FREIGHT, code: '  ' }])).toEqual({ amount: 300, description: 'Flete' });
    expect(exportItemsEntry(undefined)).toEqual({ amount: undefined, items: undefined });
    expect(exportItemsEntry([])).toEqual({ amount: undefined, items: [] });
  });
});
