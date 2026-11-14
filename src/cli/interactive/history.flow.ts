import { formatVoucherLabel } from '../../modules/billing/billing.mappers';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { VOUCHER_KIND_MAP, VOUCHER_SHORTCUTS } from '../../modules/billing/voucher-kind-map';
import { formatExportVoucherDetailAsText } from '../../modules/export/export.history.presenter';
import { EXPORT_VOUCHER_KINDS, type ExportVoucherKind } from '../../modules/export/export.types';
import { BACK } from '../../modules/interactive/wizard';
import { formatVoucherDetailAsText } from '../../modules/vouchers/voucher-history.presenter';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { writeTerminalOutput } from '../../ui';

import { pickExportVoucher, pickInvoice } from './invoice-picker';
import { chooseStep } from './prompts';
import { type InteractiveSession, requirePointOfSale } from './session';

/** A, B y C van por wsfe; la E (`fe`, `nde`, `nce`), por wsfex, igual que `arcli ultimos` y `arcli consultar`. */
type HistoryVoucherKind =
  | { readonly kind: VoucherKindDefinition; readonly service: 'wsfe' }
  | { readonly kind: ExportVoucherKind; readonly service: 'wsfex' };

const HISTORY_VOUCHER_KINDS: readonly HistoryVoucherKind[] = [
  ...VOUCHER_SHORTCUTS.map((shortcut) => ({ kind: VOUCHER_KIND_MAP[shortcut], service: 'wsfe' as const })),
  ...EXPORT_VOUCHER_KINDS.map((kind) => ({ kind, service: 'wsfex' as const })),
];

/** Lista de comprobantes E: el gateway de WSFEX se crea recien al elegir uno, como en `arcli ultimos fe`. */
async function browseExportVouchers(
  session: InteractiveSession,
  voucherKind: ExportVoucherKind,
  pointOfSale: number,
): Promise<void> {
  const gateway = new ArcaClientFactory().createExportGateway(session.runtime);

  await pickExportVoucher(session, gateway, {
    message: `¿Qué ${formatVoucherLabel(voucherKind)} querés ver?`,
    onPick: (picked) =>
      writeTerminalOutput(
        formatExportVoucherDetailAsText({
          environment: session.runtime.environment,
          pointOfSale: picked.pointOfSale,
          voucher: picked.invoice,
          voucherKind,
        }),
      ),
    pointOfSale,
    voucherKind,
  });
}

/**
 * Consultar comprobantes de cualquier tipo, tambien la E: la lista de los ultimos, cargar mas o buscar por numero.
 * Al elegir uno muestra el detalle y vuelve a la lista.
 */
export async function runHistoryFlow(baseSession: InteractiveSession): Promise<void> {
  const ready = await requirePointOfSale(baseSession);

  if (!ready) {
    return;
  }

  const { pointOfSale, session } = ready;

  const selected = await chooseStep(
    '¿Qué comprobantes querés consultar?',
    HISTORY_VOUCHER_KINDS.map((option) => ({
      name: `${option.kind.displayName} (${option.kind.shortcut})`,
      value: option,
    })),
  );

  if (selected === BACK) {
    return;
  }

  if (selected.service === 'wsfex') {
    await browseExportVouchers(session, selected.kind, pointOfSale);

    return;
  }

  const voucherKind = selected.kind;

  await pickInvoice(session, {
    message: `¿Qué ${formatVoucherLabel(voucherKind)} querés ver?`,
    onPick: (picked) =>
      writeTerminalOutput(
        formatVoucherDetailAsText({
          environment: session.runtime.environment,
          pointOfSale: picked.pointOfSale,
          voucher: picked.invoice,
          voucherKind,
        }),
      ),
    pointOfSale,
    voucherKind,
  });
}
