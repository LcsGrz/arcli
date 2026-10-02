import { invoiceKindChoices } from '../../modules/interactive/choices';
import { BACK } from '../../modules/interactive/wizard';
import { listRecentVouchers } from '../../modules/vouchers/voucher-history';
import { formatVoucherListAsText } from '../../modules/vouchers/voucher-history.presenter';
import { writeTerminalOutput } from '../../ui';
import { startSpinner } from '../spinner';

import { chooseStep } from './prompts';
import { type InteractiveSession, requirePointOfSale } from './session';

export async function runHistoryFlow(session: InteractiveSession): Promise<void> {
  const pointOfSale = requirePointOfSale(session);

  if (!pointOfSale) {
    return;
  }

  const voucherKind = await chooseStep('¿Que comprobantes queres ver?', invoiceKindChoices());

  if (voucherKind === BACK) {
    return;
  }
  const spinner = startSpinner('Consultando ARCA...');
  const vouchers = await listRecentVouchers(session.historyGateway, pointOfSale, voucherKind.arcaType).finally(() =>
    spinner?.stop(),
  );

  writeTerminalOutput(
    formatVoucherListAsText({ environment: session.runtime.environment, pointOfSale, voucherKind, vouchers }),
  );
}
