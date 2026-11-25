import { describe, expect, it } from 'vitest';

import { EXPORT_CREDIT_NOTE_KIND, EXPORT_DEBIT_NOTE_KIND, EXPORT_VOUCHER_KIND } from '../../export/export.kinds';
import type { ExportIssuedVoucher } from '../../export/export.types';
import { buildExportNoteInput, type ExportNoteState } from '../export-note-input';

const INVOICE = { number: 7, pointOfSale: 4 } as ExportIssuedVoucher;
const ITEMS = [{ description: 'Ajuste', quantity: 1, unit: 7, unitPrice: 500 }];
const STATE: ExportNoteState = { invoice: INVOICE, items: ITEMS };

describe('buildExportNoteInput', () => {
  it('una NC E sobre la factura E: el asociado sin `--ac`, un renglón en la forma rápida y la nota sin emitir', () => {
    expect(buildExportNoteInput(STATE, { kind: 'credito' })).toEqual({
      amount: 500,
      associatedVoucher: { number: 7, pointOfSale: 4, shortcut: undefined },
      description: 'Ajuste',
      emit: false,
      permits: undefined,
      voucherKind: EXPORT_CREDIT_NOTE_KIND,
    });
  });

  it('una ND E; sobre otra nota E, el asociado lleva su atajo', () => {
    const input = buildExportNoteInput({ ...STATE, associatedKind: EXPORT_CREDIT_NOTE_KIND }, { kind: 'debito' });

    expect(input.voucherKind).toBe(EXPORT_DEBIT_NOTE_KIND);
    expect(input.associatedVoucher).toEqual({ number: 7, pointOfSale: 4, shortcut: 'nce' });
    expect(
      buildExportNoteInput({ ...STATE, associatedKind: EXPORT_VOUCHER_KIND }, { kind: 'debito' }).associatedVoucher
        ?.shortcut,
    ).toBeUndefined();
  });

  it('suma los opcionales y los permisos', () => {
    expect(
      buildExportNoteInput(
        { ...STATE, options: { language: 2, voucherDate: '17/11/2026' }, permits: ['26001EC01000123A'] },
        { kind: 'credito' },
      ),
    ).toMatchObject({ language: 2, permits: ['26001EC01000123A'], voucherDate: '17/11/2026' });
  });

  it('sin el asociado elegido, el flujo está mal armado', () => {
    expect(() => buildExportNoteInput({ items: ITEMS }, { kind: 'credito' })).toThrow(/invoice/);
  });
});
