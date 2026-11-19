import { currentMonthPeriod, previousMonthPeriod, type ServicePeriod } from '../../lib/dates/periods';
import { DEFAULT_CURRENCY_CODE } from '../../modules/billing/billing.constants';
import { isForeignCurrency } from '../../modules/billing/billing.currency';
import { formatMoneyLabel } from '../../modules/billing/billing.labels';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { toIsoCurrencyCode } from '../../modules/billing/currency-codes';
import { EXPORT_VOUCHER_KIND, type ExportVoucherKind } from '../../modules/export/export.types';
import { amountInputText, parseAmountInput } from '../../modules/interactive/amount-input';
import { exportInvoiceChoice, invoiceKindChoices, reciboChoices } from '../../modules/interactive/choices';
import {
  copiedReceiverNotice,
  copyInvoiceAmounts,
  copyInvoiceReceiver,
  UNSUPPORTED_DOCUMENT_TYPE_NOTICE,
} from '../../modules/interactive/invoice-copy';
import { defaultIvaRate } from '../../modules/interactive/iva-rate';
import { BACK, type Back, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';
import type { IssuedVoucher } from '../../modules/vouchers/voucher-history';
import { noticePanel, writeTerminalOutput } from '../../ui';

import { askAdvancedOptions, askAgreedExchangeRate, askPaymentCurrency, askServiceDate } from './advanced-options';
import { runExportRepeatFlow } from './export-repeat.flow';
import { buildInvoiceInput, cbuSteps, type InvoiceState, offerSavingCbu } from './invoice.flow';
import { pickInvoice } from './invoice-picker';
import { markIfNew } from './new-mark';
import { askTextStep, chooseStep } from './prompts';
import { askReceiverIvaCondition } from './receiver-padron';
import { type InteractiveSession, previewAndEmit, requirePointOfSale } from './session';
import { normalizeDocumentNumber, validateAmount, validateCuit } from './validators';

type RepeatPeriod = 'actual' | 'anterior' | 'hoy' | 'otro';

export interface RepeatState extends InvoiceState {
  readonly original?: IssuedVoucher;
  /** Punto de venta del original: puede no ser el configurado si se ingreso a mano. */
  readonly originalPointOfSale?: number;
  /** "¿Mismo monto?": si no, se escribe en el paso siguiente. */
  readonly sameAmount?: boolean;
  /** El periodo elegido; con "otro", desde y hasta se escriben en los pasos siguientes. */
  readonly servicePeriod?: RepeatPeriod;
}

const letterOf = (state: RepeatState) => state.voucherKind?.letter ?? 'c';

/** El aviso de un receptor copiado que la letra elegida no admite (una A a un DNI): pide el CUIT. */
function copiedNotice(state: RepeatState): string | undefined {
  const receiver = state.original ? copyInvoiceReceiver(state.original) : undefined;

  return receiver && state.voucherKind ? copiedReceiverNotice(receiver, state.voucherKind) : undefined;
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
    run: async (_state, previous) => {
      // Volver desde el primer paso de la E vuelve a este selector, con la E marcada.
      let picked: ExportVoucherKind | VoucherKindDefinition | undefined = previous?.voucherKind;

      for (;;) {
        const voucherKind: Back | ExportVoucherKind | VoucherKindDefinition = await chooseStep<
          ExportVoucherKind | VoucherKindDefinition
        >(
          '¿Qué comprobante querés repetir?',
          [...invoiceKindChoices(), ...reciboChoices(), markIfNew(exportInvoiceChoice(), 'repetir-e')],
          picked,
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

        picked = voucherKind;
      }
    },
  };
  const periods = { actual: currentMonthPeriod(today), anterior: previousMonthPeriod(today) } as const;
  const billingSteps: Array<WizardStep<RepeatState>> = [
    {
      dependsOn: ['tipo'],
      name: 'factura',
      run: async (state, previous) => {
        const voucherKind = requireStepValue(state.voucherKind, 'voucherKind');
        const picked = await pickInvoice(session, {
          message: '¿Cuál repetimos?',
          pointOfSale,
          previous:
            previous?.original && previous.originalPointOfSale !== undefined
              ? { number: previous.original.number, pointOfSale: previous.originalPointOfSale }
              : undefined,
          voucherKind,
        });

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
          originalPointOfSale: picked.pointOfSale,
          totalAmount: original.total,
        };
      },
    },
    {
      // Una A (o FCE) vieja a un DNI, CUIL o consumidor final: se pide el CUIT ya, no en el rechazo de la vista previa.
      dependsOn: ['tipo', 'factura'],
      name: 'cuit-receptor',
      run: async (state, previous) => {
        writeTerminalOutput(noticePanel(requireStepValue(copiedNotice(state), 'el aviso del receptor'), 'warning'));

        const cuit = await askTextStep('CUIT del receptor:', {
          previousAnswer: previous?.documentNumber === undefined ? undefined : String(previous.documentNumber),
          validate: validateCuit,
        });

        return cuit === BACK
          ? BACK
          : { documentNumber: normalizeDocumentNumber(cuit), documentType: 'cuit', ivaCondition: undefined };
      },
      skip: (state) => copiedNotice(state) === undefined,
    },
    {
      dependsOn: ['tipo', 'factura', 'cuit-receptor'],
      name: 'iva-receptor',
      // ARCA no devuelve la condicion IVA de la factura, asi que se pregunta.
      run: async (state, previous) => {
        return askReceiverIvaCondition(
          session,
          state,
          letterOf(state),
          config.ivaReceptorPorDefecto,
          previous?.ivaCondition,
        );
      },
      skip: (state) => state.documentType === 'consumidor-final',
    },
    {
      dependsOn: ['factura'],
      name: 'mismo-monto',
      run: async (state, previous) => {
        const original = requireStepValue(state.original, 'original');
        const scope = await chooseStep(
          '¿Mismo monto?',
          [
            { name: `Sí, ${formatMoneyLabel(original.total, original.currency)}`, value: 'mismo' as const },
            { name: 'No, ingresar otro monto', value: 'otro' as const },
          ],
          previous?.sameAmount === undefined ? undefined : previous.sameAmount ? 'mismo' : 'otro',
        );

        if (scope === BACK) {
          return BACK;
        }

        return scope === 'mismo' ? { sameAmount: true, totalAmount: original.total } : { sameAmount: false };
      },
      // Si no se puede reproducir (varias alicuotas, tributos), "mismo monto" no daria la misma factura.
      skip: (state) => !state.original || Boolean(copyInvoiceAmounts(state.original, letterOf(state)).limitation),
    },
    {
      // Va en la moneda de la factura.
      dependsOn: ['factura'],
      name: 'monto',
      run: async (state, previous) => {
        const currency = foreignCurrencyOf(state.original);
        const answer = await askTextStep(currency ? `Monto total en ${currency}:` : 'Monto total:', {
          previousAnswer: amountInputText(previous?.totalAmount),
          validate: validateAmount,
        });

        return answer === BACK ? BACK : { totalAmount: parseAmountInput(answer) };
      },
      skip: (state) => state.sameAmount === true,
    },
    {
      dependsOn: ['factura'],
      name: 'pago',
      // La cotizacion del original ya no sirve: se pide la de hoy, en la moneda del original.
      run: async (state, previous) => {
        const currency = requireStepValue(foreignCurrencyOf(state.original), 'currency');

        writeTerminalOutput(
          noticePanel(
            `El comprobante original era en ${currency}: se repite en ${currency} con una cotización nueva.`,
            'info',
          ),
        );

        const sameCurrency = await askPaymentCurrency(currency, previous?.advanced?.sameCurrency);

        return sameCurrency === BACK
          ? BACK
          : { advanced: { ...state.advanced, currencyCode: currency, exchangeRate: undefined, sameCurrency } };
      },
      skip: (state) => !foreignCurrencyOf(state.original),
    },
    {
      dependsOn: ['factura', 'pago'],
      name: 'cotizacion',
      run: async (state, previous) => {
        const currency = requireStepValue(foreignCurrencyOf(state.original), 'currency');
        const exchangeRate = await askAgreedExchangeRate(currency, previous?.advanced?.exchangeRate);

        return exchangeRate === BACK ? BACK : { advanced: { ...state.advanced, exchangeRate } };
      },
      skip: (state) => !foreignCurrencyOf(state.original) || Boolean(state.advanced.sameCurrency),
    },
    {
      name: 'periodo',
      run: async (state, previous) => {
        const servicePeriod = await chooseStep<RepeatPeriod>(
          'Período del servicio:',
          [
            { description: describePeriod(periods.actual), name: 'Este mes', value: 'actual' },
            { description: describePeriod(periods.anterior), name: 'El mes pasado', value: 'anterior' },
            { description: 'Desde y hasta hoy', name: 'Solo hoy', value: 'hoy' },
            { name: 'Otro período', value: 'otro' },
          ],
          previous?.servicePeriod,
        );

        if (servicePeriod === BACK) {
          return BACK;
        }

        const period = servicePeriod === 'actual' || servicePeriod === 'anterior' ? periods[servicePeriod] : undefined;

        // "Otro período" se escribe en los dos pasos siguientes.
        return {
          advanced: { ...state.advanced, serviceEndDate: period?.to, serviceStartDate: period?.from },
          servicePeriod,
        };
      },
      skip: (state) => state.concept === 'productos',
    },
    {
      name: 'periodo-desde',
      run: async (state, previous) => {
        const start = await askServiceDate('desde', previous?.advanced?.serviceStartDate);

        return start === BACK ? BACK : { advanced: { ...state.advanced, serviceStartDate: start } };
      },
      skip: (state) => state.concept === 'productos' || state.servicePeriod !== 'otro',
    },
    {
      name: 'periodo-hasta',
      run: async (state, previous) => {
        const end = await askServiceDate('hasta', previous?.advanced?.serviceEndDate);

        return end === BACK ? BACK : { advanced: { ...state.advanced, serviceEndDate: end } };
      },
      skip: (state) => state.concept === 'productos' || state.servicePeriod !== 'otro',
    },
    ...cbuSteps<RepeatState>(config),
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
