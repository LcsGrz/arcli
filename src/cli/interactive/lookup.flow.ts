import { VOUCHER_KIND_MAP, VOUCHER_SHORTCUTS } from '../../modules/billing/voucher-kind-map';
import { BACK } from '../../modules/interactive/wizard';
import { formatQuotationAsText, formatStatusAsText } from '../../modules/parameters/parameters.presenter';
import { buildStatusReport } from '../../modules/parameters/status';
import { formatVoucherDetailAsText, formatVoucherNumber } from '../../modules/vouchers/voucher-history.presenter';
import { ArcaParametersGateway } from '../../services/arca/arca-parameters.gateway';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { startSpinner } from '../spinner';

import { askTextStep, chooseStep } from './prompts';
import { type InteractiveSession, requirePointOfSale } from './session';

async function withSpinner<T>(text: string, run: () => Promise<T>): Promise<T> {
  const spinner = startSpinner(text);

  try {
    return await run();
  } finally {
    spinner?.stop();
  }
}

/** Consultar un comprobante por numero, de cualquier tipo. Propone el ultimo emitido. */
export async function runLookupFlow(session: InteractiveSession): Promise<void> {
  const pointOfSale = requirePointOfSale(session);

  if (!pointOfSale) {
    return;
  }

  const voucherKind = await chooseStep(
    '¿Que tipo de comprobante?',
    VOUCHER_SHORTCUTS.map((shortcut) => ({
      name: `${VOUCHER_KIND_MAP[shortcut].displayName} (${shortcut})`,
      value: VOUCHER_KIND_MAP[shortcut],
    })),
  );

  if (voucherKind === BACK) {
    return;
  }

  const lastNumber = await withSpinner('Consultando ARCA...', () =>
    session.historyGateway.getLastNumber(pointOfSale, voucherKind.arcaType),
  );

  if (lastNumber === 0) {
    writeTerminalOutput(
      noticePanel(`No hay ${voucherKind.displayName} emitidas en el punto de venta ${pointOfSale}.`, 'muted'),
    );

    return;
  }

  const answer = await askTextStep(`Numero (el ultimo es ${lastNumber}):`, {
    defaultValue: String(lastNumber),
    validate: (value) => {
      const number = Number(value.trim());

      return Number.isInteger(number) && number > 0 && number <= lastNumber
        ? true
        : `Ingrese un numero entre 1 y ${lastNumber}.`;
    },
  });

  if (answer === BACK) {
    return;
  }

  const number = Number(answer.trim());
  const voucher = await withSpinner('Consultando ARCA...', () =>
    session.historyGateway.getVoucher(number, pointOfSale, voucherKind.arcaType),
  );

  if (!voucher) {
    writeTerminalOutput(
      noticePanel(`No existe la ${voucherKind.displayName} N° ${formatVoucherNumber(pointOfSale, number)}.`, 'warning'),
    );

    return;
  }

  writeTerminalOutput(
    formatVoucherDetailAsText({ environment: session.runtime.environment, pointOfSale, voucher, voucherKind }),
  );
}

/** Estado de los servidores de ARCA, del punto de venta y la cotizacion oficial del dolar. */
export async function runStatusFlow(session: InteractiveSession): Promise<void> {
  const gateway = new ArcaParametersGateway(session.arca);
  const { environment, pointOfSale } = session.runtime;
  const [report, quotation] = await withSpinner('Consultando ARCA...', () =>
    Promise.all([
      buildStatusReport({ environment, gateway, pointOfSale }),
      // La cotizacion es un extra: si falla, el estado se muestra igual.
      gateway.getQuotation('USD').catch(() => undefined),
    ]),
  );

  writeTerminalOutput(formatStatusAsText(report));

  if (quotation) {
    writeTerminalOutput(formatQuotationAsText(quotation, environment));
  }
}
