import { describe, expect, it, vi } from 'vitest';

import type { ExportIssuedVoucher } from '../../export/export.types';
import type { IssuedVoucher } from '../voucher-history';
import {
  getVoucher,
  listVouchers,
  parseQueriedNumber,
  resolveQueryableVoucher,
  resolveQueryPointOfSale,
  validateVoucherQuantity,
  type VoucherSource,
} from '../voucher-query';

/** Las reglas sin el CLI. Los mensajes, el orden y todas las familias están en `voucher-queries.characterization`. */

const SCOPE = { environment: 'testing', pointOfSale: 3 } as const;

function wsfe(found: boolean) {
  const gateway = {
    getLastNumber: vi.fn(async () => 2),
    getVoucher: vi.fn(async (number: number) => (found ? ({ number } as IssuedVoucher) : undefined)),
  };

  return { gateway, source: { ...resolveQueryableVoucher('fc'), gateway } as VoucherSource };
}

function wsfex(found: boolean) {
  const gateway = {
    getLastVoucherNumber: vi.fn(async () => 2),
    getVoucher: vi.fn(async ({ number }: { number: number }) => (found ? ({ number } as ExportIssuedVoucher) : null)),
  };

  return { gateway, source: { ...resolveQueryableVoucher('nce'), gateway } as VoucherSource };
}

describe('resolveQueryableVoucher', () => {
  it.each([
    ['fcea', 'wsfe', 201],
    [' RB ', 'wsfe', 9],
    ['fe', 'wsfex', 19],
    [' NDE ', 'wsfex', 20],
  ])('"%s" va por %s', (shortcut, service, arcaType) => {
    expect(resolveQueryableVoucher(shortcut)).toMatchObject({ service, voucherKind: { arcaType } });
  });

  it('rechaza un tipo que no existe, como se escribió', () => {
    expect(() => resolveQueryableVoucher(' XX')).toThrow('El tipo " XX" no es válido. Usá un atajo: fa, fb,');
  });
});

describe('la entrada', () => {
  it.each([undefined, 1, 50])('cantidad %s es válida', (quantity) => {
    expect(() => validateVoucherQuantity(quantity)).not.toThrow();
  });

  it.each([0, 51, 1.5, Number.NaN])('cantidad %s no es válida', (quantity) => {
    expect(() => validateVoucherQuantity(quantity)).toThrow('tiene que ser un número entre 1 y 50');
  });

  it('lee un número con ceros y rechaza 0 o un decimal', () => {
    expect(parseQueriedNumber(' 0042 ')).toBe(42);
    expect(() => parseQueriedNumber('0')).toThrow('entero positivo');
    expect(() => parseQueriedNumber('1.5')).toThrow('entero positivo');
  });

  it('el punto de venta pedido gana al de la config', () => {
    expect(resolveQueryPointOfSale(5, 3)).toBe(5);
    expect(resolveQueryPointOfSale(undefined, 3)).toBe(3);
    expect(() => resolveQueryPointOfSale(0, 3)).toThrow('El punto de venta tiene que ser');
    expect(() => resolveQueryPointOfSale(undefined, undefined)).toThrow('Falta el punto de venta');
  });
});

describe('listVouchers', () => {
  it('por wsfe', async () => {
    const { gateway, source } = wsfe(true);

    await expect(listVouchers(source, { ...SCOPE, limit: 1 })).resolves.toEqual({
      ...SCOPE,
      ...resolveQueryableVoucher('fc'),
      vouchers: [{ number: 2 }],
    });
    expect(gateway.getLastNumber).toHaveBeenCalledWith(3, 11);
    expect(gateway.getVoucher.mock.calls).toEqual([[2, 3, 11]]);
  });

  it('por wsfex', async () => {
    const { gateway, source } = wsfex(true);

    await expect(listVouchers(source, { ...SCOPE, limit: 1 })).resolves.toEqual({
      ...SCOPE,
      ...resolveQueryableVoucher('nce'),
      vouchers: [{ number: 2 }],
    });
    expect(gateway.getLastVoucherNumber).toHaveBeenCalledWith(21, 3);
    expect(gateway.getVoucher.mock.calls).toEqual([[{ arcaType: 21, number: 2, pointOfSale: 3 }]]);
  });
});

describe('getVoucher', () => {
  it.each([
    ['fc', wsfe],
    ['nce', wsfex],
  ])('%s: el comprobante con su tipo', async (shortcut, source) => {
    await expect(getVoucher(source(true).source, { ...SCOPE, number: 7 })).resolves.toEqual({
      ...SCOPE,
      ...resolveQueryableVoucher(shortcut),
      voucher: { number: 7 },
    });
  });

  it.each([
    ['la factura C', wsfe],
    ['la nota de crédito de exportación E', wsfex],
  ])('si ARCA no tiene %s, VOUCHER_NOT_FOUND', async (name, source) => {
    const error: unknown = await getVoucher(source(false).source, {
      environment: 'produccion',
      number: 7,
      pointOfSale: 3,
    }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: 'VOUCHER_NOT_FOUND',
      message: `No existe ${name} N° 00003-00000007 en ARCA (producción).`,
    });
  });
});
