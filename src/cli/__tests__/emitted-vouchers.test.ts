import { describe, expect, it } from 'vitest';

import { describeEmittedVouchers } from '../emitted-vouchers';

/** Los numeros y el comando de un grupo los prueban `interrupted-batch.test.ts` y `e2e/closed-output.e2e.ts`. */
describe('describeEmittedVouchers', () => {
  it('sin nada emitido no dice nada', () => {
    expect(describeEmittedVouchers([])).toEqual([]);
  });

  it('una línea por tipo, entorno y punto de venta: en el asistente se mezclan', () => {
    const voucher = { environment: 'testing', number: 5, pointOfSale: 3, shortcut: 'fc' } as const;

    expect(
      describeEmittedVouchers([
        voucher,
        { ...voucher, shortcut: 'fe' },
        { ...voucher, pointOfSale: 4 },
        { ...voucher, environment: 'produccion' },
        { ...voucher, number: 6 },
      ]),
    ).toEqual([
      'Se emitieron: fc del punto de venta 3, 5 y 6. Verificalos con `arcli ultimos fc --pv 3 --cantidad 3 --testing`.',
      'Se emitió: fe del punto de venta 3, 5. Verificalo con `arcli ultimos fe --pv 3 --cantidad 2 --testing`.',
      'Se emitió: fc del punto de venta 4, 5. Verificalo con `arcli ultimos fc --pv 4 --cantidad 2 --testing`.',
      'Se emitió: fc del punto de venta 3, 5. Verificalo con `arcli ultimos fc --pv 3 --cantidad 2 --produccion`.',
    ]);
  });
});
