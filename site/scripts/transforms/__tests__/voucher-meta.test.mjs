import { describe, expect, it } from 'vitest';

import { voucherMeta } from '../voucher-meta.mjs';

describe('voucherMeta (<!-- arcli: familia=… -->)', () => {
  it('saca la marca y devuelve la familia', () => {
    const input = '<!-- arcli: familia="Monotributo · C" icono="factura" orden="1" -->\n\nUna factura.\n';

    expect(voucherMeta(input)).toEqual({ body: 'Una factura.\n', familia: 'Monotributo · C' });
  });

  it('sin la marca deja el texto igual', () => {
    expect(voucherMeta('Texto.')).toEqual({ body: 'Texto.', familia: null });
  });
});
