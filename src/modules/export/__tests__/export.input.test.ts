import { describe, expect, it } from 'vitest';

import { InputValidationError } from '../../../lib/errors/app-error';
import { type ExportInputOptions, resolveExportInput } from '../export.input';
import { EXPORT_CREDIT_NOTE_KIND, EXPORT_VOUCHER_KIND } from '../export.kinds';

/** REV-52: la entrada de la E sin commander ni disco, como la arma quien no es el CLI. */

// El 10/11 en Argentina y ya el 11/11 en UTC.
const resolve = (options: Partial<ExportInputOptions> = {}) =>
  resolveExportInput({ now: new Date('2026-11-11T01:00:00Z'), ...options });

describe('resolveExportInput', () => {
  it('con solo el archivo arma la factura, y sin nada que pida emitir no se emite', () => {
    const items = [{ cantidad: 2, descripcion: 'Horas', precioUnitario: 10 }];

    expect(
      resolve({ file: { cliente: 'ACME', fechaComprobante: 'hoy', items, montoTotal: 20, paisDestino: 203 } }),
    ).toMatchObject({
      input: {
        amount: 20,
        clientName: 'ACME',
        destinationCountry: '203',
        emit: false,
        items: [{ description: 'Horas', quantity: 2, unitPrice: 10 }],
        voucherDate: '10/11/2026',
        voucherKind: EXPORT_VOUCHER_KIND,
      },
      modeSource: 'default',
      warnings: [],
    });
  });

  it('los flags van con la forma del archivo y ganan, también con `false`', () => {
    expect(
      resolve({
        defaultEmit: true,
        file: { emitir: true, mismaMoneda: true, monto: 1, pdf: true },
        flags: { emitir: false, mismaMoneda: false, montoTotal: 2, pdf: false },
      }),
    ).toMatchObject({ input: { amount: 2, emit: false, pdf: false, sameCurrency: false }, modeSource: 'flags' });
  });

  it('el asociado de una nota se mezcla campo por campo, y en la factura el del archivo es un error', () => {
    const file = { comprobanteAsociado: { fecha: 'ayer', numero: 3, puntoVenta: 4 } };

    expect(
      resolve({
        file,
        flags: { comprobanteAsociado: { atajo: 'fe', numero: 7 } },
        voucherKind: EXPORT_CREDIT_NOTE_KIND,
      }).input.associatedVoucher,
    ).toEqual({
      arcaType: undefined,
      cuit: undefined,
      date: '09/11/2026',
      number: 7,
      pointOfSale: 4,
      shortcut: 'fe',
    });
    expect(() => resolve({ file })).toThrow('La factura E no lleva comprobante asociado');
  });

  it('los flags incompatibles salen después de la decisión de emitir y antes de lo demás', () => {
    const flags = { errors: { pdf: new InputValidationError('flags de PDF') } };

    expect(() => resolve({ file: { comprobanteAsociado: {}, fechaComprobante: 'malo' }, flags })).toThrow(
      'flags de PDF',
    );
    expect(() => resolve({ file: { emitir: true, previsualizar: true }, flags })).toThrow('"emitir" o "previsualizar"');
  });

  it.each<[string, Partial<ExportInputOptions>, number]>([
    ['una descripción en blanco no avisa', { flags: { descripcion: ' ' } }, 0],
    ['sin descripción no avisa', {}, 0],
    ['con las dos, avisa', { flags: { descripcion: 'Horas' } }, 1],
  ])('con ítems, %s', (_name, options, warnings) => {
    const items = [{ cantidad: 1, descripcion: 'x', precioUnitario: 1 }];

    expect(resolve({ file: { items }, ...options }).warnings).toHaveLength(warnings);
    expect(resolve({ ...options, flags: { ...options.flags, items } }).warnings).toHaveLength(warnings);
  });

  it('sin ítems la descripción no avisa, y el aviso nombra de dónde salió cada uno', () => {
    const items = [{ cantidad: 1, descripcion: 'x', precioUnitario: 1 }];

    expect(resolve({ flags: { descripcion: 'Horas' } }).warnings).toEqual([]);
    expect(resolve({ file: { items: [] }, flags: { descripcion: 'Horas' } }).warnings).toEqual([]);
    expect(resolve({ file: { descripcion: 'Horas' }, flags: { items } }).warnings).toEqual([
      'La clave "descripcion" del JSON de `--cargar` se usa solo cuando no hay `--item`: el detalle del comprobante sale de los ítems.',
    ]);
    expect(resolve({ file: { items }, flags: { descripcion: 'Horas' } }).warnings).toEqual([
      '`--descripcion` se usa solo cuando no hay "items": el detalle del comprobante sale de los ítems.',
    ]);
  });

  it('no comparte la lista de permisos con lo que recibe', () => {
    const permisos = ['P1'];

    expect(resolve({ file: { permisos } }).input.permits).toEqual(permisos);
    expect(resolve({ file: { permisos } }).input.permits).not.toBe(permisos);
  });
});
