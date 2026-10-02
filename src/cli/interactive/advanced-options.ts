import type { BillingCommandInput } from '../../modules/billing/billing.schemas';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { parseAmountInput } from '../../modules/interactive/amount-input';
import { BACK, type Back } from '../../modules/interactive/wizard';

import { askTextStep, chooseStep } from './prompts';
import { validateDate, validateExchangeRate, validateOptionalAmount } from './validators';

export type AdvancedOptions = Pick<
  BillingCommandInput,
  | 'currencyCode'
  | 'exchangeRate'
  | 'exemptAmount'
  | 'paymentDueDate'
  | 'sameCurrency'
  | 'serviceEndDate'
  | 'serviceStartDate'
  | 'untaxedAmount'
>;

type Option = 'divisas' | 'exento' | 'listo' | 'servicio' | 'vencimiento';

interface AdvancedContext {
  readonly concept: BillingCommandInput['concept'];
  readonly voucherKind: VoucherKindDefinition;
}

function describeCurrency(options: AdvancedOptions): string {
  if (!options.currencyCode || options.currencyCode === 'PES' || options.currencyCode === 'ARS') {
    return 'pesos';
  }

  return options.sameCurrency ? 'dolares, cotizacion oficial de ARCA' : `dolares, cotizacion ${options.exchangeRate}`;
}

function describeAmounts(options: AdvancedOptions): string {
  const parts = [
    options.exemptAmount ? `exento ${options.exemptAmount}` : undefined,
    options.untaxedAmount ? `no gravado ${options.untaxedAmount}` : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(', ') : 'sin exento ni no gravado';
}

async function askCurrency(current: AdvancedOptions): Promise<AdvancedOptions | Back> {
  const currency = await chooseStep('Moneda del comprobante:', [
    { name: 'Pesos', value: 'PES' as const },
    { name: 'Dolares (USD)', value: 'USD' as const },
  ]);

  if (currency === BACK) {
    return BACK;
  }

  if (currency === 'PES') {
    return { ...current, currencyCode: 'ARS', exchangeRate: undefined, sameCurrency: false };
  }

  const payment = await chooseStep('¿Como te pagan?', [
    { description: 'Ingresas la cotizacion acordada', name: 'En pesos', value: 'pesos' as const },
    { description: 'Se usa la cotizacion oficial de ARCA', name: 'En dolares', value: 'dolares' as const },
  ]);

  if (payment === BACK) {
    return BACK;
  }

  if (payment === 'dolares') {
    return { ...current, currencyCode: 'USD', exchangeRate: undefined, sameCurrency: true };
  }

  const rate = await askTextStep('Cotizacion del dolar:', { validate: validateExchangeRate });

  return rate === BACK
    ? BACK
    : { ...current, currencyCode: 'USD', exchangeRate: parseAmountInput(rate), sameCurrency: false };
}

async function askExemptAmounts(current: AdvancedOptions): Promise<AdvancedOptions | Back> {
  const exempt = await askTextStep('Parte exenta del monto total (vacio si no hay):', {
    validate: validateOptionalAmount,
  });

  if (exempt === BACK) {
    return BACK;
  }

  const untaxed = await askTextStep('Parte no gravada del monto total (vacio si no hay):', {
    validate: validateOptionalAmount,
  });

  if (untaxed === BACK) {
    return BACK;
  }

  return { ...current, exemptAmount: parseAmountInput(exempt), untaxedAmount: parseAmountInput(untaxed) };
}

async function askServicePeriod(current: AdvancedOptions): Promise<AdvancedOptions | Back> {
  const start = await askTextStep('Servicio desde:', { validate: validateDate });

  if (start === BACK) {
    return BACK;
  }

  const end = await askTextStep('Servicio hasta:', { validate: validateDate });

  return end === BACK ? BACK : { ...current, serviceEndDate: end, serviceStartDate: start };
}

async function askPaymentDueDate(current: AdvancedOptions): Promise<AdvancedOptions | Back> {
  const due = await askTextStep('Vencimiento del pago:', { validate: validateDate });

  return due === BACK ? BACK : { ...current, paymentDueDate: due };
}

/**
 * Menu de opciones avanzadas antes de la vista previa. Cada opcion se puede cambiar varias veces;
 * "Volver" en el menu vuelve al paso anterior del flujo, y "Volver" dentro de una opcion vuelve al menu.
 */
export async function askAdvancedOptions(
  initial: AdvancedOptions,
  context: AdvancedContext,
): Promise<AdvancedOptions | Back> {
  const usesService = context.concept !== 'productos';
  const usesPaymentDue = usesService || context.voucherKind.family === 'factura-credito-electronica';
  const allowsExempt = context.voucherKind.letter !== 'c';
  let options = initial;

  for (;;) {
    const choice = await chooseStep<Option>('¿Agregamos algo mas?', [
      { name: 'No, ver la vista previa', value: 'listo' },
      { description: describeCurrency(options), name: 'Moneda extranjera', value: 'divisas' },
      ...(allowsExempt
        ? [{ description: describeAmounts(options), name: 'Importe exento o no gravado', value: 'exento' as const }]
        : []),
      ...(usesService
        ? [
            {
              description: options.serviceStartDate
                ? `${options.serviceStartDate} al ${options.serviceEndDate}`
                : 'hoy',
              name: 'Periodo del servicio',
              value: 'servicio' as const,
            },
          ]
        : []),
      ...(usesPaymentDue
        ? [
            {
              description: options.paymentDueDate ?? 'por defecto',
              name: 'Vencimiento del pago',
              value: 'vencimiento' as const,
            },
          ]
        : []),
    ]);

    if (choice === BACK) {
      return BACK;
    }

    if (choice === 'listo') {
      return options;
    }

    const ask = {
      divisas: askCurrency,
      exento: askExemptAmounts,
      servicio: askServicePeriod,
      vencimiento: askPaymentDueDate,
    }[choice];
    const updated = await ask(options);

    if (updated !== BACK) {
      options = updated;
    }
  }
}
