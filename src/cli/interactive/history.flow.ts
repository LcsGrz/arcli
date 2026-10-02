import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { formatMoneyLabel } from '../../modules/billing/billing.labels';
import { invoiceKindChoices } from '../../modules/interactive/choices';
import { listRecentVouchers } from '../../modules/interactive/voucher-history';
import { keyValuePanel, noticePanel, writeTerminalOutput } from '../../ui';
import { startSpinner } from '../spinner';

import { chooseOne } from './prompts';
import { type InteractiveSession, requirePointOfSale } from './session';
import { formatReceiver, formatVoucherNumber } from './voucher-format';

export async function runHistoryFlow(session: InteractiveSession): Promise<void> {
  const pointOfSale = requirePointOfSale(session);

  if (!pointOfSale) {
    return;
  }

  const voucherKind = await chooseOne('¿Que comprobantes queres ver?', invoiceKindChoices());
  const spinner = startSpinner('Consultando ARCA...');
  const vouchers = await listRecentVouchers(session.historyGateway, pointOfSale, voucherKind.arcaType).finally(() =>
    spinner?.stop(),
  );

  if (vouchers.length === 0) {
    writeTerminalOutput(
      noticePanel(`No hay ${voucherKind.displayName} emitidas en el punto de venta ${pointOfSale}.`, 'muted'),
    );

    return;
  }

  const rows = vouchers.map((voucher) =>
    [
      formatVoucherNumber(pointOfSale, voucher.number),
      formatArcaDateAsArgentineDate(voucher.date),
      formatReceiver(voucher).padEnd(20),
      formatMoneyLabel(voucher.total).padStart(16),
      voucher.cae ? `CAE ${voucher.cae}` : '',
    ].join('  '),
  );

  writeTerminalOutput(
    keyValuePanel(
      `Ultimas ${voucherKind.displayName} · PV ${pointOfSale} · ${session.runtime.environment}`,
      rows,
      undefined,
      'wide',
    ),
  );
}
