import { afterEach, describe, expect, it, vi } from 'vitest';

import { BillingService } from '../../../modules/billing/billing.service';
import type { VoucherKindDefinition, VoucherShortcut } from '../../../modules/billing/billing.types';
import { getVoucherKindByShortcut } from '../../../modules/billing/voucher-kind-map';
import type { IssuedVoucher } from '../../../modules/vouchers/voucher-history';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import { type NoteState, noteSteps } from '../note.flow';
import type { InteractiveSession } from '../session';

import { createScript } from './script';

let script = createScript([]);

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
}));

const session = {
  billingGateway: { createVoucher: vi.fn(), getNextVoucherNumber: vi.fn(), getQuotation: vi.fn() },
  historyGateway: { getLastNumber: vi.fn(), getVoucher: vi.fn() },
  runtime: { config: {}, context: { cuit: 20333333334 }, environment: 'testing' } as unknown as ResolvedArcaRuntime,
  service: new BillingService(),
} as unknown as InteractiveSession;

const invoice: IssuedVoucher = {
  concept: 2,
  date: '20261001',
  documentNumber: 30709965812,
  documentTypeCode: 80,
  ivaAmount: 21,
  netAmount: 100,
  number: 14,
  total: 121,
};

function amountStep(shortcut: VoucherShortcut) {
  const step = noteSteps(session, 3).find((candidate) => candidate.name === 'monto');
  const invoiceKind = getVoucherKindByShortcut(shortcut) as VoucherKindDefinition;
  const isLetterC = invoiceKind.letter === 'c';
  const state: NoteState = {
    invoice: isLetterC ? { ...invoice, ivaAmount: 0, netAmount: 121 } : invoice,
    invoiceKind,
    kind: 'credito',
    target: 'factura',
  };

  return () => step?.run(state);
}

afterEach(() => {
  expect(script.remaining()).toBe(0);
});

// REV-45: en el asistente la NC no pasa del paso del monto si supera el total de la factura.
describe.each<VoucherShortcut>(['fa', 'fb', 'fc', 'fcea', 'fceb', 'fcec', 'rc'])(
  'monto de una NC sobre %s',
  (shortcut) => {
    it('no deja avanzar con un monto mayor que el total', async () => {
      script = createScript([
        [/Total o parcial/, 'Parcial'],
        [/Monto de la nota de crédito/, '121,01'],
      ]);

      await expect(amountStep(shortcut)()).rejects.toThrow(/No puede superar el total del comprobante \(\$ 121\)/);
    });

    it('acepta el total justo', async () => {
      script = createScript([
        [/Total o parcial/, 'Parcial'],
        [/Monto de la nota de crédito/, '121'],
      ]);

      await expect(amountStep(shortcut)()).resolves.toEqual({ annulsTotal: false, totalAmount: 121 });
    });
  },
);
