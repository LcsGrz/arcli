import { formatExchangeRate } from '../../../lib/numbers/argentine-amount';
import { DEFAULT_CURRENCY_CODE } from '../../../modules/billing/billing.constants';
import { isForeignCurrency } from '../../../modules/billing/billing.currency';
import { toIsoCurrencyCode } from '../../../modules/billing/currency-codes';
import { amountInputText, parseExchangeRateInput } from '../../../modules/interactive/amount-input';
import { currencyName, type ExchangeRateSuggestion } from '../../../modules/interactive/billing-optionals';
import { currencyChoices } from '../../../modules/interactive/choices';
import type { CurrencyChoice, CurrencyLock } from '../../../modules/interactive/steps/currency';
import type { Lens } from '../../../modules/interactive/steps/lens';
import { BACK, type Back, type WizardDependency, type WizardStep } from '../../../modules/interactive/wizard';
import { noticePanel, writeTerminalOutput } from '../../../ui';
import { askTextStep, chooseStep } from '../prompts';
import { validateExchangeRate } from '../validators';

/** El codigo de la moneda en la lista de monedas: `PES` para pesos. */
function currencyChoiceValue(options: { readonly currencyCode?: string } | undefined): string {
  return options?.currencyCode && isForeignCurrency({ currencyCode: options.currencyCode })
    ? toIsoCurrencyCode(options.currencyCode)
    : 'PES';
}

/**
 * Como se cobra un comprobante en moneda extranjera: en pesos (la cotizacion arranca con la de la config o la oficial de
 * ARCA y se puede cambiar por la acordada) o en esa moneda (se usa la oficial de ARCA, `--misma-moneda`). Devuelve si es en esa moneda.
 */
export async function askPaymentCurrency(currencyCode: string, previous?: boolean): Promise<Back | boolean> {
  const payment = await chooseStep(
    '¿Cómo te pagan?',
    [
      {
        description: `El comprobante va en ${currencyName(currencyCode)} y lo cobrás en pesos: confirmás o cambiás la cotización`,
        name: 'En pesos',
        value: 'pesos' as const,
      },
      {
        description: 'Se usa la cotización oficial de ARCA',
        name: `En ${currencyName(currencyCode)}`,
        value: 'moneda' as const,
      },
    ],
    previous === undefined ? undefined : previous ? 'moneda' : 'pesos',
  );

  return payment === BACK ? BACK : payment === 'moneda';
}

/** La cotizacion de un comprobante en moneda extranjera cobrado en pesos, y de donde sale si no se escribio. */
type AgreedExchangeRate = Pick<CurrencyChoice, 'exchangeRate' | 'exchangeRateSource'>;

function describeSuggestion(suggested: ExchangeRateSuggestion): string {
  const rate = formatExchangeRate(suggested.rate);

  switch (suggested.source) {
    case 'associated':
      return `la de ${suggested.associated} es ${rate}`;
    case 'config':
      return `la de tu config, \`cotizacion\`, es ${rate}`;
    default:
      return `la oficial de ARCA es ${rate}`;
  }
}

/**
 * La cotizacion, si te pagan en pesos un comprobante en moneda extranjera. Arranca escrita con la escrita antes o, si no
 * hay, con `suggested`: la de la config (`cotizacion`, deprecada) si el CLI la tomaria sin `--cm`, la oficial de ARCA
 * o, en una nota E, la del asociado. Si dejas lo que arranco escrito, va como el CLI sin `--cm`: la de la config marcada
 * como tal, o ninguna (la vista previa consulta la oficial o toma la del asociado). Si escribis otra cosa, es la
 * acordada y va con `--cm`. Sin `suggested` (la consulta de la oficial fallo), arranca vacia. `validate` reemplaza la
 * validacion de `--cm` de A, B y C (la E usa sus reglas).
 */
async function askAgreedExchangeRate(
  currencyCode: string,
  previous?: AgreedExchangeRate,
  suggested?: ExchangeRateSuggestion,
  validate: (value: string) => string | true = validateExchangeRate,
): Promise<AgreedExchangeRate | Back> {
  const iso = toIsoCurrencyCode(currencyCode);
  // Solo una escrita a mano arranca como antes; una sugerida se vuelve a sugerir (la oficial puede haber cambiado).
  const typed = previous?.exchangeRateSource === undefined ? previous?.exchangeRate : undefined;
  const suggestedText = typed === undefined ? amountInputText(suggested?.rate) : undefined;
  const rate = await askTextStep(`Cotización de ${iso}${suggested ? ` (${describeSuggestion(suggested)})` : ''}:`, {
    previousAnswer: suggestedText ?? amountInputText(typed),
    validate,
  });

  if (rate === BACK) {
    return BACK;
  }

  if (suggested && suggestedText !== undefined && rate.trim() === suggestedText) {
    return suggested.source === 'config'
      ? { exchangeRate: suggested.rate, exchangeRateSource: 'config' }
      : { exchangeRate: undefined, exchangeRateSource: undefined };
  }

  return { exchangeRate: parseExchangeRateInput(rate), exchangeRateSource: undefined };
}

export interface ExchangeRateStepDef<S> {
  /** Donde esta la cotizacion (y de donde sale, si es de la config) en el estado del flujo. */
  readonly rate: Lens<S, AgreedExchangeRate>;
  /** La moneda del comprobante (codigo de ARCA o ISO): la pregunta la nombra. */
  readonly currency: (state: S) => string;
  /** Con que cotizacion arranca escrita: la que tomaria el CLI sin `--cm`. */
  readonly suggestion?: (state: S) => Promise<ExchangeRateSuggestion | undefined>;
  /** La validacion de lo escrito; sin esto, la de `--cm` de A, B y C. */
  readonly validate?: (state: S) => (value: string) => string | true;
  readonly dependsOn?: readonly WizardDependency[];
  readonly skip?: (state: S) => boolean;
  /** Los campos que escribe, para que `finalize` vuelva a esta pregunta (en la E, `exchangeRate`). */
  readonly writes?: readonly string[];
}

/**
 * La pregunta de la cotizacion de un comprobante en moneda extranjera cobrado en pesos (`askAgreedExchangeRate`), como
 * un paso: la comparten la moneda de A, B y C (`currencySteps`) y la E, factura, nota y "Repetir" (`exportExchangeRateStep`).
 */
export function exchangeRateStep<S>(def: ExchangeRateStepDef<S>): WizardStep<S> {
  return {
    dependsOn: def.dependsOn,
    name: 'cotizacion',
    run: async (state, { previous }) => {
      const rate = await askAgreedExchangeRate(
        def.currency(state),
        previous ? def.rate.get(previous as S) : undefined,
        await def.suggestion?.(state),
        def.validate?.(state),
      );

      // La cotizacion y de donde sale, siempre juntas: una escrita no queda marcada como de la config.
      return rate === BACK ? BACK : def.rate.set(rate, state);
    },
    skip: def.skip,
    writes: def.writes,
  };
}

export interface CurrencyStepsDef<S> {
  /** Donde estan la moneda, como pagan y la cotizacion en el estado del flujo. */
  readonly currency: Lens<S, Partial<CurrencyChoice>>;
  /**
   * La moneda trabada (REV-73): no se pregunta cual, y si es extranjera se pregunta como pagan con el motivo como aviso.
   * Sin traba, primero se elige la moneda.
   */
  readonly lock?: (state: S) => CurrencyLock | undefined;
  /** Con que cotizacion arranca escrita la pregunta si te pagan en pesos (la de la config o la oficial de ARCA). */
  readonly suggestion?: (currencyCode: string) => Promise<ExchangeRateSuggestion | undefined>;
  /** Pasos anteriores de donde sale la moneda trabada: si cambian, como pagan y la cotizacion se preguntan de cero. */
  readonly dependsOn?: readonly WizardDependency[];
  /** Cuando no aplica ninguna de las preguntas. */
  readonly skip?: (state: S) => boolean;
}

/**
 * La moneda de un comprobante de A, B o C, en tres pasos: cual ("Moneda del comprobante:"), como te pagan y, si es en
 * pesos, la cotizacion. Elegir otra moneda descarta como pagan y la cotizacion. Con la moneda trabada (`lock`) solo se
 * preguntan como pagan y la cotizacion, en esa moneda. Lo comparten el opcional "Moneda extranjera" (factura, recibo,
 * notas y "Repetir") y "Repetir" en moneda extranjera.
 */
export function currencySteps<S>(def: CurrencyStepsDef<S>): Array<WizardStep<S>> {
  const { currency } = def;
  const skip = (state: S) => Boolean(def.skip?.(state));
  const lockOf = (state: S) => def.lock?.(state);
  const codeOf = (state: S) => lockOf(state)?.code ?? currency.get(state)?.currencyCode ?? DEFAULT_CURRENCY_CODE;
  const previousOf = (previous: Partial<S> | undefined) => (previous ? currency.get(previous as S) : undefined);
  const isForeign = (state: S) => isForeignCurrency({ currencyCode: codeOf(state) });
  const dependsOn = def.dependsOn ?? [];

  return [
    {
      dependsOn,
      name: 'moneda',
      run: async (state, { previous }) => {
        const chosen = await chooseStep(
          'Moneda del comprobante:',
          currencyChoices(),
          currencyChoiceValue(previousOf(previous) ?? currency.get(state)),
        );

        if (chosen === BACK) {
          return BACK;
        }

        return currency.set(
          {
            currencyCode: chosen === 'PES' ? DEFAULT_CURRENCY_CODE : chosen,
            exchangeRate: undefined,
            exchangeRateSource: undefined,
            sameCurrency: false,
          },
          state,
        );
      },
      skip: (state) => skip(state) || lockOf(state) !== undefined,
    },
    {
      // La pregunta nombra la moneda.
      dependsOn: [...dependsOn, 'moneda'],
      name: 'pago',
      run: async (state, { previous }) => {
        const lock = lockOf(state);

        if (lock) {
          writeTerminalOutput(noticePanel(lock.reason, 'info'));
        }

        const sameCurrency = await askPaymentCurrency(codeOf(state), previousOf(previous)?.sameCurrency);

        return sameCurrency === BACK
          ? BACK
          : currency.set(
              {
                ...(lock ? { currencyCode: lock.code } : {}),
                exchangeRate: undefined,
                exchangeRateSource: undefined,
                sameCurrency,
              },
              state,
            );
      },
      skip: (state) => skip(state) || !isForeign(state),
    },
    exchangeRateStep<S>({
      currency: codeOf,
      dependsOn: [...dependsOn, 'moneda', 'pago'],
      rate: currency,
      skip: (state) => skip(state) || !isForeign(state) || Boolean(currency.get(state)?.sameCurrency),
      suggestion: (state) => def.suggestion?.(codeOf(state)) ?? Promise.resolve(undefined),
    }),
  ];
}
