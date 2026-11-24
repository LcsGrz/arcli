import { describe, expect, it } from 'vitest';

import { InputValidationError } from '../../../lib/errors/app-error';
import { exportJsonInputWarnings, mapExportJsonItems, readExportJsonInput } from '../export.json-input';

const ITEM = { cantidad: 2, descripcion: 'Consultoría', precioUnitario: 500 };

function expectError(source: unknown, message: string | RegExp): void {
  expect(() => readExportJsonInput(source)).toThrow(InputValidationError);
  expect(() => readExportJsonInput(source)).toThrow(message);
}

/** El texto entero, con el mismo `codigo` y sin `detalles`: completarlo es de la 3.0.0. */
function expectExactError(source: unknown, message: string): void {
  let error: unknown;

  try {
    readExportJsonInput(source);
  } catch (caught) {
    error = caught;
  }

  expect(error).toBeInstanceOf(InputValidationError);
  expect((error as InputValidationError).message).toBe(message);
  expect((error as InputValidationError).code).toBe('INPUT_VALIDATION_ERROR');
  expect((error as InputValidationError).details).toBeUndefined();
}

describe('readExportJsonInput', () => {
  // Tests primero (ERR-10).
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
    it.fails.each([
      [{ montototal: 1000 }, 'La clave "montototal" no existe: ¿quisiste decir "montoTotal"?'],
      [{ ar: 1 }, 'La clave "ar" no existe: ¿quisiste decir "comprobanteAsociado.numero"?'],
      [{ 'obs-comerciales': 'x' }, 'La clave "obs-comerciales" no existe: ¿quisiste decir "observacionesComerciales"?'],
      [{ constructor: 1 }, 'La clave "constructor" no existe.'],
      [{ ivaReceptor: 'x' }, 'La clave "ivaReceptor" no existe.'],
      [{ items: [ITEM, { ...ITEM, unidd: 7 }] }, 'La clave "items[1].unidd" no existe: ¿quisiste decir "unidad"?'],
      [
        { comprobanteAsociado: { punto_venta: 1 } },
        'La clave "comprobanteAsociado.punto_venta" no existe: ¿quisiste decir "puntoVenta"?',
      ],
      [
        { moneda: 'DOL', xyz: 1 },
        'La clave "moneda" no existe: ¿quisiste decir "codigoMoneda"? La clave "xyz" no existe.',
      ],
    ])('%j', (source, message) => {
      expectExactError(source, `En el JSON de \`--cargar\`: ${message}`);
    });
  });

  describe('tipos incorrectos', () => {
    it.fails.each([
      [{ montoTotal: 'abc' }, '"montoTotal" tiene que ser un número y llegó el texto "abc". Escribilo sin comillas.'],
      [{ montoTotal: '' }, '"montoTotal" tiene que ser un número y llegó el texto "".'],
      [{ montoTotal: null }, '"montoTotal" tiene que ser un número y llegó null.'],
      [{ emitir: 'true' }, '"emitir" tiene que ser true o false y llegó el texto "true".'],
      [{ cliente: 12 }, '"cliente" tiene que ser un texto y llegó 12.'],
      [{ items: {} }, '"items" tiene que ser un array y llegó un objeto.'],
      [{ items: [5] }, '"items[0]" tiene que ser un objeto y llegó 5.'],
      [{ comprobanteAsociado: 'fe 4-1' }, '"comprobanteAsociado" tiene que ser un objeto y llegó el texto "fe 4-1".'],
      [{ permisos: [1] }, '"permisos[0]" tiene que ser un texto y llegó 1.'],
      [
        { items: [{ ...ITEM, cantidad: '2' }] },
        '"items[0].cantidad" tiene que ser un número y llegó el texto "2". Escribilo sin comillas.',
      ],
      [
        { comprobanteAsociado: { numero: '1' } },
        '"comprobanteAsociado.numero" tiene que ser un número y llegó el texto "1". Escribilo sin comillas.',
      ],
      [{ items: [{ cantidad: 1, precioUnitario: 1 }] }, 'Falta "items[0].descripcion".'],
      [{ tipoExpo: 3 }, '"tipoExpo" tiene que ser 1, 2 o 4 y llegó 3.'],
      [{ tipoExpo: '1' }, '"tipoExpo" tiene que ser 1, 2 o 4 y llegó el texto "1". Escribilo sin comillas.'],
      [{ tipoExpo: 'bienes' }, '"tipoExpo" tiene que ser 1, 2 o 4 y llegó el texto "bienes".'],
      [{ paisDestino: true }, '"paisDestino" tiene que ser un texto ("Brasil") o un número (203) y llegó true.'],
      [
        { items: [{ ...ITEM, unidad: null }] },
        '"items[0].unidad" tiene que ser un texto ("unidades") o un número (7) y llegó null.',
      ],
      [
        { cliente: 1, puntoVenta: '4', x: 1 },
        '"cliente" tiene que ser un texto y llegó 1. "puntoVenta" tiene que ser un número y llegó el texto "4". Escribilo sin comillas. La clave "x" no existe.',
      ],
    ])('%j', (source, message) => {
      expectExactError(source, `En el JSON de \`--cargar\`: ${message}`);
    });
  });

  it.fails.each([
    ['x', 'el texto "x"'],
    [5, '5'],
    [null, 'null'],
  ])('rechaza una raíz que no es objeto: %j', (source, received) => {
    expectExactError(
      source,
      `El JSON de \`--cargar\` de una E tiene que ser un objeto con un comprobante y es ${received}.`,
    );
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
