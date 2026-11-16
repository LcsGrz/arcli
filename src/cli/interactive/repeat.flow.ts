import { DEFAULT_CURRENCY_CODE } from '../../modules/billing/billing.constants';
import { isForeignCurrency } from '../../modules/billing/billing.currency';
import { formatMoneyLabel } from '../../modules/billing/billing.labels';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { toIsoCurrencyCode } from '../../modules/billing/currency-codes';
import { EXPORT_VOUCHER_KIND, type ExportVoucherKind } from '../../modules/export/export.types';
import { parseAmountInput } from '../../modules/interactive/amount-input';
import { exportInvoiceChoice, invoiceKindChoices, reciboChoice } from '../../modules/interactive/choices';
import {
  copyInvoiceAmounts,
  copyInvoiceReceiver,
  UNSUPPORTED_DOCUMENT_TYPE_NOTICE,
} from '../../modules/interactive/invoice-copy';
import { defaultIvaRate } from '../../modules/interactive/iva-rate';
import { currentMonthPeriod, previousMonthPeriod, type ServicePeriod } from '../../modules/interactive/periods';
import { BACK, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';
import type { IssuedVoucher } from '../../modules/vouchers/voucher-history';
import { noticePanel, writeTerminalOutput } from '../../ui';

import { askAdvancedOptions, askExchangeRate, askServicePeriod } from './advanced-options';
import { runExportRepeatFlow } from './export-repeat.flow';
import { buildInvoiceInput, cbuStep, type InvoiceState, offerSavingCbu } from './invoice.flow';
import { pickInvoice } from './invoice-picker';
import { markIfNew } from './new-mark';
import { askTextStep, chooseStep } from './prompts';
import { askReceiverIvaCondition } from './receiver-padron';
import { type InteractiveSession, previewAndEmit, requirePointOfSale } from './session';
import { validateAmount } from './validators';

export interface RepeatState extends InvoiceState {
  readonly original?: IssuedVoucher;
}

/** La moneda extranjera del comprobante, con su codigo ISO; `undefined` si era en pesos. */
function foreignCurrencyOf(original: IssuedVoucher | undefined): string | undefined {
  const currency = original?.currency;

  return currency && isForeignCurrency({ currencyCode: currency }) ? toIsoCurrencyCode(currency) : undefined;
}

function describePeriod(period: ServicePeriod): string {
  return `${period.from} al ${period.to}`;
}

/**
 * Repetir una factura o un recibo: se elige uno de los ultimos emitidos y se copian el comprobante, el receptor, el concepto,
 * el monto y la alicuota. Las fechas se actualizan: la factura sale con fecha de hoy y el periodo se elige. La factura E
 * corre su propio asistente (`runExportRepeatFlow`).
 */
export function repeatSteps(
  session: InteractiveSession,
  pointOfSale: number,
  today: Date = new Date(),
): Array<WizardStep<RepeatState>> {
  const { config } = session.runtime;

  const pickVoucherKind: WizardStep<RepeatState> = {
    name: 'tipo',
    run: async () => {
      // Volver desde el primer paso de la E vuelve a este selector.
      for (;;) {
        const voucherKind = await chooseStep<ExportVoucherKind | VoucherKindDefinition>(
          '¿Qué comprobante querés repetir?',
          [...invoiceKindChoices(), reciboChoice(), markIfNew(exportInvoiceChoice(), 'repetir-e')],
        );

        if (voucherKind === BACK) {
          return BACK;
        }

        if (voucherKind !== EXPORT_VOUCHER_KIND) {
          return { voucherKind: voucherKind as VoucherKindDefinition };
        }

        if ((await runExportRepeatFlow(session, pointOfSale)) !== BACK) {
          return { exported: true };
        }
      }
    },
  };
  const billingSteps: Array<WizardStep<RepeatState>> = [
    {
      name: 'factura',
      run: async (state) => {
        const voucherKind = requireStepValue(state.voucherKind, 'voucherKind');
        const picked = await pickInvoice(session, { message: '¿Cuál repetimos?', pointOfSale, voucherKind });

        if (picked === BACK) {
          return BACK;
        }

        const original = picked.invoice;
        const receiver = copyInvoiceReceiver(original);

        if (!receiver) {
          writeTerminalOutput(noticePanel(UNSUPPORTED_DOCUMENT_TYPE_NOTICE, 'warning'));

          return BACK;
        }

        const copy = copyInvoiceAmounts(original, voucherKind.letter);

        if (copy.limitation) {
          writeTerminalOutput(
            noticePanel(`${copy.limitation} Revisá la alícuota y el monto antes de emitir.`, 'warning'),
          );
        }

        return {
          advanced: {
            // El monto esta en la moneda del original: se repite en esa moneda y despues se pide la cotizacion.
            currencyCode: foreignCurrencyOf(original) ?? DEFAULT_CURRENCY_CODE,
            exchangeRate: undefined,
            exemptAmount: copy.exemptAmount,
            ivaRate: copy.ivaRate,
            sameCurrency: false,
            untaxedAmount: copy.untaxedAmount,
          },
          ...receiver,
          original,
          totalAmount: original.total,
        };
      },
    },
    {
      name: 'iva-receptor',
      // ARCA no devuelve la condicion IVA de la factura, asi que se pregunta.
      run: async (state) => {
        return askReceiverIvaCondition(session, state, state.voucherKind?.letter ?? 'c', config.ivaReceptorPorDefecto);
      },
      skip: (state) => state.documentType === 'consumidor-final',
    },
    {
      name: 'monto',
      run: async (state) => {
        const original = requireStepValue(state.original, 'original');
        // Si no se puede reproducir (varias alicuotas, tributos), "mismo monto" no daria la misma factura.
        const reproducible = !copyInvoiceAmounts(original, state.voucherKind?.letter ?? 'c').limitation;
        const scope = reproducible
          ? await chooseStep('¿Mismo monto?', [
              { name: `Sí, ${formatMoneyLabel(original.total, original.currency)}`, value: 'mismo' as const },
              { name: 'No, ingresar otro monto', value: 'otro' as const },
            ])
          : ('otro' as const);

        if (scope === BACK || scope === 'mismo') {
          return scope === BACK ? BACK : { totalAmount: original.total };
        }

        const currency = foreignCurrencyOf(original);
        const answer = await askTextStep(currency ? `Monto total en ${currency}:` : 'Monto total:', {
          validate: validateAmount,
        });

        return answer === BACK ? BACK : { totalAmount: parseAmountInput(answer) };
      },
    },
    {
      name: 'cotizacion',
      // La cotizacion del original ya no sirve: se pide la de hoy, en la moneda del original.
      run: async (state) => {
        const currency = requireStepValue(foreignCurrencyOf(state.original), 'currency');

        writeTerminalOutput(
          noticePanel(
            `El comprobante original era en ${currency}: se repite en ${currency} con una cotización nueva.`,
            'info',
          ),
        );

        const advanced = await askExchangeRate(state.advanced, currency);

        return advanced === BACK ? BACK : { advanced };
      },
      skip: (state) => !foreignCurrencyOf(state.original),
    },
    {
      name: 'periodo',
      run: async (state) => {
        const current = currentMonthPeriod(today);
        const previous = previousMonthPeriod(today);
        const choice = await chooseStep<'hoy' | 'otro' | ServicePeriod>('Período del servicio:', [
          { description: describePeriod(current), name: 'Este mes', value: current },
          { description: describePeriod(previous), name: 'El mes pasado', value: previous },
          { description: 'Desde y hasta hoy', name: 'Solo hoy', value: 'hoy' as const },
          { name: 'Otro período', value: 'otro' as const },
        ]);

        if (choice === BACK) {
          return BACK;
        }

        const advanced = { ...state.advanced };

        if (choice === 'hoy') {
          return { advanced: { ...advanced, serviceEndDate: undefined, serviceStartDate: undefined } };
        }

        if (choice !== 'otro') {
          return { advanced: { ...advanced, serviceEndDate: choice.to, serviceStartDate: choice.from } };
        }

        const typed = await askServicePeriod(advanced);

        return typed === BACK ? BACK : { advanced: typed };
      },
      skip: (state) => state.concept === 'productos',
    },
    cbuStep<RepeatState>(config),
    {
      name: 'opcionales',
      run: async (state) => {
        const advanced = await askAdvancedOptions(state.advanced, {
          concept: state.concept ?? 'servicios',
          defaultIvaRate: defaultIvaRate(config, state.advanced.ivaRate),
          // En moneda extranjera el monto esta en esa moneda: cambiarla a pesos lo emitiria como si fueran pesos.
          fixedCurrency: Boolean(foreignCurrencyOf(state.original)),
          // Sin alicuota deducida de la factura, que la elija en lugar de caer en la de la config.
          preselected: !state.advanced.ivaRate && state.voucherKind?.letter !== 'c' ? ['alicuota'] : [],
          voucherKind: requireStepValue(state.voucherKind, 'voucherKind'),
        });

        return advanced === BACK ? BACK : { advanced };
      },
    },
  ];

  return [
    pickVoucherKind,
    ...billingSteps.map((step) => ({
      ...step,
      skip: (state: RepeatState) => Boolean(state.exported) || Boolean(step.skip?.(state)),
    })),
  ];
}

export async function runRepeatFlow(baseSession: InteractiveSession): Promise<void> {
  const ready = await requirePointOfSale(baseSession);

  if (!ready) {
    return;
  }

  const { pointOfSale, session } = ready;

  const state = await runWizard(repeatSteps(session, pointOfSale), {
    advanced: { currencyCode: DEFAULT_CURRENCY_CODE, sameCurrency: false },
  });

  if (!state || state.exported) {
    return;
  }

  await previewAndEmit(session, buildInvoiceInput(state, session));
  await offerSavingCbu(session, state);
}
