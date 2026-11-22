import { describe, expect, it } from 'vitest';

import { InputValidationError } from '../../../lib/errors/app-error';
import { exportJsonInputWarnings, mapExportJsonItems, readExportJsonInput } from '../export.json-input';

const ITEM = { cantidad: 2, descripcion: 'Consultoría', precioUnitario: 500 };

function expectError(source: unknown, message: string | RegExp): void {
  expect(() => readExportJsonInput(source)).toThrow(InputValidationError);
  expect(() => readExportJsonInput(source)).toThrow(message);
}

describe('readExportJsonInput', () => {
  it('acepta un comprobante con todas las claves', () => {
    const source = {
      actividad: 620100,
      cliente: 'ACME LLC',
      codigoMoneda: 'DOL',
      comprobanteAsociado: { atajo: 'fe', cuit: '20123456786', fecha: '10/03', numero: 1, puntoVenta: 4, tipo: 19 },
      cotizacionMoneda: 1174.5,
      cuitPais: 55000002126,
      descripcion: 'Servicios',
      descripcionIncoterm: 'Free on board',
      domicilioCliente: '123 Main St',
      emitir: false,
      fechaComprobante: '10/03',
      fechaPago: '20/03',
      formaPago: 'Transferencia',
      idImpositivo: '12-3456789',
      idSolicitud: 10,
      idioma: 1,
      incoterm: 'FOB',
      items: [{ ...ITEM, codigo: 'A1', unidad: 7 }],
      mismaMoneda: false,
      montoTotal: 1000,
      numero: 3,
      observaciones: 'obs',
      observacionesComerciales: 'com',
      paisDestino: 'Brasil',
      pdf: true,
      permisoExistente: true,
      permisos: ['26001EC01000001A'],
      puntoVenta: 4,
      previsualizar: true,
      tipoExpo: 1,
    };

    expect(readExportJsonInput(source)).toEqual(source);
  });

  it.each([1, 2, 4])('acepta tipoExpo %s', (tipoExpo) => {
    expect(readExportJsonInput({ tipoExpo }).tipoExpo).toBe(tipoExpo);
  });

  it('acepta paisDestino como código o nombre y unidad como texto o número', () => {
    expect(readExportJsonInput({ paisDestino: 203 }).paisDestino).toBe(203);
    expect(readExportJsonInput({ items: [{ ...ITEM, unidad: 'unidades' }] }).items?.[0]?.unidad).toBe('unidades');
  });

  describe('claves desconocidas', () => {
    it('en la raíz', () => {
      expectError(
        { montototal: 1000 },
        'En el JSON de `--cargar`: La clave "montototal" no existe en el JSON de `--cargar`.',
      );
    });

    it('varias a la vez', () => {
      expectError({ moneda: 'DOL', pais: 'Brasil' }, /La clave "moneda", "pais" no existe/);
    });

    it('en un item', () => {
      expectError({ items: [{ ...ITEM, precio: 1 }] }, /La clave "precio" no existe/);
    });

    it('en el comprobante asociado', () => {
      expectError({ comprobanteAsociado: { nro: 1 } }, /La clave "nro" no existe/);
    });
  });

  describe('tipos incorrectos', () => {
    it.each([
      [{ puntoVenta: '4' }, '"puntoVenta" tiene que ser un número.'],
      [{ emitir: 'true' }, '"emitir" tiene que ser true o false.'],
      [{ cliente: 12 }, '"cliente" tiene que ser un texto.'],
      [{ items: {} }, '"items" tiene que ser un array.'],
      [{ comprobanteAsociado: 'fe 4-1' }, '"comprobanteAsociado" tiene que ser un objeto.'],
      [{ permisos: [1] }, '"permisos.0" tiene que ser un texto.'],
      [{ items: [{ ...ITEM, cantidad: '2' }] }, '"items.0.cantidad" tiene que ser un número.'],
      [{ comprobanteAsociado: { numero: '1' } }, '"comprobanteAsociado.numero" tiene que ser un número.'],
      [{ montoTotal: null }, '"montoTotal" tiene que ser un número.'],
    ])('%j', (source, message) => {
      expectError(source, message);
    });

    it('falta una clave obligatoria de un item', () => {
      expectError({ items: [{ cantidad: 1, precioUnitario: 1 }] }, 'Falta "items.0.descripcion".');
    });

    it('un tipoExpo que no existe usa el mensaje de zod con la ruta', () => {
      expectError({ tipoExpo: 3 }, /^En el JSON de `--cargar`: "tipoExpo": /);
    });

    it('un paisDestino que no es texto ni número', () => {
      expectError({ paisDestino: true }, /^En el JSON de `--cargar`: "paisDestino": /);
    });

    it('junta todos los problemas en un solo error', () => {
      expectError(
        { cliente: 1, puntoVenta: '4', x: 1 },
        /"cliente" tiene que ser un texto\..*"puntoVenta" tiene que ser un número\./,
      );
    });
  });

  it.each([[null], ['texto'], [42]])('rechaza una raíz que no es objeto: %j', (source) => {
    expect(() => readExportJsonInput(source)).toThrow(/^En el JSON de `--cargar`: /);
  });

  it('rechaza un lote: la E toma un solo comprobante', () => {
    expectError([{ montoTotal: 1 }], 'tiene que ser un objeto con un comprobante, no un array.');
  });

  it('rechaza monto y montoTotal juntos', () => {
    expectError({ monto: 1, montoTotal: 1 }, 'usá "montoTotal" o "monto", no las dos.');
  });
});

describe('exportJsonInputWarnings', () => {
  it('avisa solo por la clave deprecada monto', () => {
    expect(exportJsonInputWarnings(undefined)).toEqual([]);
    expect(exportJsonInputWarnings(readExportJsonInput({ montoTotal: 1 }))).toEqual([]);
    expect(exportJsonInputWarnings(readExportJsonInput({ monto: 1 }))).toEqual([
      expect.stringMatching(/"monto" .* se saca en la 3\.0\.0: usá "montoTotal"/),
    ]);
  });
});

describe('mapExportJsonItems', () => {
  it('pasa las claves del JSON a las del servicio', () => {
    expect(mapExportJsonItems(undefined)).toBeUndefined();
    expect(mapExportJsonItems([{ ...ITEM, codigo: 'A1', unidad: 7 }])).toEqual([
      { code: 'A1', description: 'Consultoría', quantity: 2, unit: 7, unitPrice: 500 },
    ]);
  });
});
