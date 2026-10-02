import { invoiceKindChoices } from '../../modules/interactive/choices';
import { listRecentVouchers } from '../../modules/vouchers/voucher-history';
import { formatVoucherListAsText } from '../../modules/vouchers/voucher-history.presenter';
import { writeTerminalOutput } from '../../ui';
import { startSpinner } from '../spinner';

import { chooseOne } from './prompts';
import { type InteractiveSession, requirePointOfSale } from './session';

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

  writeTerminalOutput(
    formatVoucherListAsText({ environment: session.runtime.environment, pointOfSale, voucherKind, vouchers }),
  );
}
