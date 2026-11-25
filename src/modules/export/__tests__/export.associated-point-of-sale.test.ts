import { describe, expect, it } from 'vitest';

import { resolveExportInput } from '../export.input';
import type { ExportJsonInput } from '../export.json-input';
import { EXPORT_VOUCHER_KINDS } from '../export.kinds';

/** ARQ-22: como en A, B, C y FCE, el punto de venta de un asociado ajeno no vale para otro comprobante. */
const EMITTER = 20123456786;
const AJENO = { atajo: 'fe', cuit: '30709965812', numero: 5, puntoVenta: 2 };

function associatedOf(
  shortcut: string,
  comprobanteAsociado: ExportJsonInput['comprobanteAsociado'],
  file: ExportJsonInput['comprobanteAsociado'] = AJENO,
) {
  return resolveExportInput({
    emitterCuit: EMITTER,
    file: { comprobanteAsociado: file, puntoVenta: 3 },
    flags: { comprobanteAsociado },
    now: new Date('2026-11-10T15:00:00Z'),
    voucherKind: EXPORT_VOUCHER_KINDS.find((kind) => kind.shortcut === shortcut),
  }).input.associatedVoucher;
}

describe.each(['nce', 'nde'])('%s: un CUIT ajeno del archivo descartado por los flags', (shortcut) => {
  it.each([{ numero: 9 }, { atajo: 'nde' }])('%j: falta el punto de venta', (elsewhere) => {
    expect(() => associatedOf(shortcut, elsewhere)).toThrow(
      /^Falta el punto de venta del comprobante asociado de la nota de .* E\. Usá `--apv <número>`\.$/,
    );
    expect(associatedOf(shortcut, { ...elsewhere, puntoVenta: 4 })).toMatchObject({ cuit: undefined, pointOfSale: 4 });
    // Propio: sin punto de venta, el de la nota.
    expect(associatedOf(shortcut, { ...elsewhere, cuit: String(EMITTER) })).toMatchObject({
      cuit: String(EMITTER),
      pointOfSale: undefined,
    });
  });

  it('con el CUIT propio o sin CUIT en el archivo no cambia nada', () => {
    for (const cuit of [String(EMITTER), undefined]) {
      expect(associatedOf(shortcut, { numero: 9 }, { ...AJENO, cuit })).toMatchObject({ number: 9, pointOfSale: 2 });
    }
  });
});
