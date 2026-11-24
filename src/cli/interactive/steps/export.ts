import { formatDateAsArcaDate } from '../../../lib/dates/arca-date';
import { formatExchangeRate } from '../../../lib/numbers/argentine-amount';
import { parseStrictInteger } from '../../../lib/numbers/strict-integer';
import { isForeignCurrency } from '../../../modules/billing/billing.currency';
import { toArcaCurrencyCode, toIsoCurrencyCode } from '../../../modules/billing/currency-codes';
import { exportActivityProblem } from '../../../modules/export/export.mappers';
import { EXPORT_RULES } from '../../../modules/export/export.rules';
import type {
  ExportActivity,
  ExportCountry,
  ExportCountryCuit,
  ExportCurrency,
  ExportGateway,
  ExportType,
} from '../../../modules/export/export.types';
import { DEFAULT_EXPORT_CURRENCY_CODE, EXPORT_TYPES_WITH_PAYMENT_DATE } from '../../../modules/export/export.types';
import { parseExchangeRateInput } from '../../../modules/interactive/amount-input';
import type { ExchangeRateSuggestion } from '../../../modules/interactive/billing-optionals';
import { exportCurrencyChoices } from '../../../modules/interactive/choices';
import type { ExportRuleEnv } from '../../../modules/interactive/export-input';
import type { ExportOptions, ExportRuleScope } from '../../../modules/interactive/export-optionals';
import { scopedRuleValidator } from '../../../modules/interactive/rule-validator';
import {
  exportAsksExchangeRate,
  type ExportExchangeRateCase,
  exportFixedExchangeRate,
} from '../../../modules/interactive/steps/currency';
import type { Lens } from '../../../modules/interactive/steps/lens';
import {
  validateCurrencyCode,
  validateExchangeRate,
  validatePositiveInteger,
} from '../../../modules/interactive/validators';
import { BACK, type WizardDependency, type WizardStep } from '../../../modules/interactive/wizard';
import { formatTableRows, noticePanel, writeTerminalOutput } from '../../../ui';
import { withSpinner } from '../../spinner';
import { validateExportPaymentDate } from '../export-options';
import type { FilterListRow } from '../filter-list';
import { chooseOrTypeStep, chooseStep } from '../prompts';

import { askPaymentCurrency, exchangeRateStep } from './currency';
import { dateStep } from './date';

/**
 * Lo que la E necesita de WSFEX antes de preguntar: los paises para validar el destino y sus CUIT. La cargan "Emitir
 * factura E" y "Repetir" E. La tabla de actividades se consulta recien si se pregunta la actividad (`activitiesLoader`).
 */
export interface ExportTables {
  readonly countries: readonly ExportCountry[];
  readonly countryCuits: readonly ExportCountryCuit[];
}

/** Lo que las reglas de la E toman de la sesion, con hoy leido cada vez que se pide (ARQ-19): la factura y "Repetir". */
export function exportRuleEnv(configuredActivity: number | undefined): () => ExportRuleEnv {
  return () => ({ configuredActivity, today: formatDateAsArcaDate(new Date()) });
}

export function loadExportTables(
  gateway: Pick<ExportGateway, 'getDestinationCountries' | 'getDestinationCountryCuits'>,
): Promise<ExportTables> {
  return withSpinner('Consultando las tablas de WSFEX...', async () => ({
    countries: await gateway.getDestinationCountries(),
    countryCuits: await gateway.getDestinationCountryCuits(),
  }));
}

/**
 * La tabla de actividades de WSFEX, una vez por flujo y solo cuando se pregunta la actividad: si la factura que se
 * repite la trae o esta en la config, no se consulta (y una falla de ARCA en esa tabla no corta el flujo).
 */
export function activitiesLoader(
  gateway: Pick<ExportGateway, 'getActivities'>,
): () => Promise<readonly ExportActivity[]> {
  let loaded: Promise<readonly ExportActivity[]> | undefined;

  return () => {
    loaded ??= withSpinner('Consultando las actividades de WSFEX...', () => gateway.getActivities());

    return loaded;
  };
}

/**
 * Vacio (la E va sin actividad) o un entero positivo que, si ARCA devolvio la tabla, esta en las de WSFEX: la misma
 * regla que `--actividad` (`exportActivityProblem`, error 2105).
 */
function validateActivity(activities: readonly ExportActivity[]): (value: string) => string | true {
  return (value) => {
    if (!value.trim()) {
      return true;
    }

    const valid = validatePositiveInteger('La actividad')(value);

    return valid === true
      ? (exportActivityProblem(parseStrictInteger(value) as number, activities)?.question ?? true)
      : valid;
  };
}

export interface ActivityStepDef<S> {
  readonly activity: Lens<S, number>;
  /** La tabla de WSFEX (`activitiesLoader`): se consulta al preguntar. */
  readonly activities: () => Promise<readonly ExportActivity[]>;
  readonly skip: (state: S) => boolean;
}

/**
 * Las actividades de WSFEX como filas de una lista donde tambien se escribe, con CODIGO y DESCRIPCION (TUI-25). El
 * codigo es palabra clave (escrito entero gana a otro que lo contiene, como 620100 y 6201000) y la descripcion es lo
 * que queda al elegirla (escrita entera, tambien gana). La usan la E y "Modificar configuracion".
 */
export function activityRows(activities: readonly ExportActivity[]): {
  readonly header: string;
  readonly rows: ReadonlyArray<FilterListRow<number>>;
} {
  const { header, rows } = formatTableRows(
    ['CÓDIGO', 'DESCRIPCIÓN'],
    activities.map((activity) => [String(activity.id), activity.name]),
  );

  return {
    header,
    rows: activities.map((activity, index) => ({
      keywords: String(activity.id),
      label: rows[index] ?? String(activity.id),
      short: activity.name,
      value: activity.id,
    })),
  };
}

/** La ayuda de la lista de actividades. */
export const ACTIVITY_HELP = 'Escribí el código o parte de la descripción, por ejemplo "6201" o "consultores".';

/**
 * La actividad de WSFEX, si no esta en la config (ni en la factura que se repite), de una lista donde tambien se escribe
 * (TUI-25). Es opcional: ARCA no exige `Actividades` (la 2100 solo prohibe el bloque vacio), y la primera fila la deja
 * sin informar. Sin la tabla de ARCA es una pregunta de texto. La comparten "Emitir factura E" y "Repetir" E (REV-74,
 * #11).
 */
export function activityStep<S>(def: ActivityStepDef<S>): WizardStep<S> {
  return {
    name: 'actividad',
    run: async (state, { previous }) => {
      const typed = previous ? def.activity.get(previous as S) : undefined;
      const activities = await def.activities();
      const { header, rows } = activityRows(activities);
      const answer = await chooseOrTypeStep<number>(
        rows.length > 0 ? 'Actividad de WSFEX:' : 'Actividad de WSFEX, por ejemplo 620100:',
        rows,
        {
          emptyLabel: 'Sin actividad (no se informa)',
          header,
          help: ACTIVITY_HELP,
          // Sin tabla es una pregunta de texto: "actividad" es femenino, no el "Enter para omitirlo" de siempre.
          hint: '(Enter para no informarla)',
          optional: true,
          parse: (text) => parseStrictInteger(text) as number,
          previous: typed,
          validate: validateActivity(activities),
        },
      );

      return answer === BACK ? BACK : def.activity.set(answer, state);
    },
    skip: def.skip,
  };
}

/**
 * "Fecha de pago", antes de los opcionales (TUI-22): ARCA la pide en servicios y otros, asi que no va despues de lo
 * opcional. No puede ser anterior a la fecha del comprobante (1674), que se elige despues: al preguntar se compara con la mas
 * temprana que acepta ARCA, y la comparacion exacta la hacen "Fecha del comprobante" de los opcionales y `finalize`, que
 * vuelve aca. Con Enter va la del comprobante, la que se elija (como el CLI sin `--fecha-pago`). En bienes ARCA la
 * rechaza (1673). La comparten "Emitir factura E" y "Repetir" E.
 */
export function exportPaymentDateStep<S extends { readonly options?: ExportOptions; readonly paymentDate?: string }>(
  exportType: (state: S) => ExportType | undefined,
): WizardStep<S> {
  return dateStep<S>({
    date: {
      get: (state) => state.paymentDate,
      set: (paymentDate) => ({ paymentDate }) as Partial<S>,
    },
    message: 'Fecha de pago (Enter para la fecha del comprobante):',
    name: 'fecha-pago',
    optional: true,
    skip: (state) => {
      const type = exportType(state);

      return type !== undefined && !EXPORT_TYPES_WITH_PAYMENT_DATE.includes(type);
    },
    // Si `finalize` volvio aca, no se eligio fecha del comprobante (la pregunta de la fecha ya controla contra esta): va
    // la de hoy, y se compara con ella para no aceptar de nuevo la misma.
    validate: (state, retry) => validateExportPaymentDate(state.options?.voucherDate, { undecided: !retry }),
    writes: ['paymentDate'],
  });
}

/**
 * La tabla de monedas de WSFEX, una vez por flujo y al preguntar la moneda. Vacia si ARCA no la devolvio o la consulta
 * fallo: la pregunta deja escribir el codigo y la vista previa vuelve a consultarla.
 */
export function currenciesLoader(
  gateway: Pick<ExportGateway, 'getCurrencies'>,
): () => Promise<readonly ExportCurrency[]> {
  let loaded: Promise<readonly ExportCurrency[]> | undefined;

  return () => {
    loaded ??= withSpinner('Consultando las monedas de WSFEX...', () => gateway.getCurrencies()).catch(() => []);

    return loaded;
  };
}

export interface ExportCurrencyStepDef<S> {
  /** El codigo de ARCA de la moneda. */
  readonly currency: Lens<S, string>;
  /** La tabla de WSFEX (`currenciesLoader`): se consulta al preguntar. */
  readonly currencies: () => Promise<readonly ExportCurrency[]>;
}

/**
 * La moneda de una E: la misma pregunta y las mismas monedas que en A, B y C, con los dolares primero y marcados. Sin la
 * tabla de WSFEX, dolares, pesos o el codigo escrito.
 */
export function exportCurrencyStep<S>(def: ExportCurrencyStepDef<S>): WizardStep<S> {
  return {
    name: 'moneda',
    run: async (state, { previous }) => {
      const typed = previous ? def.currency.get(previous as S) : undefined;
      const table = await def.currencies();
      const choices = exportCurrencyChoices(table);
      const message = 'Moneda del comprobante:';
      const answer =
        table.length > 0
          ? await chooseStep(message, choices, typed ?? DEFAULT_EXPORT_CURRENCY_CODE)
          : await chooseOrTypeStep<string>(
              message,
              choices.map(({ name, value, ...choice }) => ({ ...choice, label: name, value })),
              {
                help: 'ARCA no devolvió la lista: elegí una o escribí el código, por ejemplo EUR.',
                parse: toArcaCurrencyCode,
                previous: typed,
                validate: validateCurrencyCode,
              },
            );

      return answer === BACK ? BACK : def.currency.set(answer, state);
    },
  };
}

export interface ExportPaymentStepDef<S> {
  /** Si te pagan en la moneda del comprobante (`--misma-moneda`). */
  readonly sameCurrency: Lens<S, boolean>;
  readonly voucher: (state: S) => ExportExchangeRateCase;
  /** Los pasos de donde salen la moneda y el tipo: la pregunta los nombra. */
  readonly dependsOn: readonly WizardDependency[];
}

/**
 * "¿Cómo te pagan?" de una E en moneda extranjera, la de A, B y C (`askPaymentCurrency`): sin otra cosa, en pesos, como
 * `arcli fe` sin `--misma-moneda`. Arranca en lo que haya en el estado: "Repetir" propone lo que informo la factura. La
 * comparten "Emitir factura E" y "Repetir" E.
 */
export function exportPaymentStep<S>(def: ExportPaymentStepDef<S>): WizardStep<S> {
  return {
    dependsOn: def.dependsOn,
    name: 'pago',
    run: async (state, { previous }) => {
      const voucher = def.voucher(state);
      const answered = previous ? def.sameCurrency.get(previous as S) : undefined;
      const sameCurrency = await askPaymentCurrency(
        voucher.currencyCode,
        answered ?? def.sameCurrency.get(state) ?? false,
        // En servicios la cotizacion tampoco se puede cambiar cobrando en pesos.
        { fixedExchangeRate: exportFixedExchangeRate({ ...voucher, sameCurrency: false }) !== undefined },
      );

      return sameCurrency === BACK ? BACK : def.sameCurrency.set(sameCurrency, state);
    },
    skip: (state) => !isForeignCurrency({ currencyCode: def.voucher(state).currencyCode }),
  };
}

export interface ExportExchangeRateStepDef<S> {
  readonly exchangeRate: Lens<S, number>;
  /** Moneda, tipo de exportacion y como pagan: deciden si se pregunta (`exportAsksExchangeRate`). */
  readonly voucher: (state: S) => ExportExchangeRateCase;
  /**
   * Con que arranca escrita: la que toma el CLI sin `--cotizacion-moneda`, la de aduana de ARCA en la factura
   * (`exportExchangeRateLoader`) o la del asociado en la nota. Donde ARCA exige la suya, es la que muestra el aviso.
   */
  readonly suggestion: (state: S) => Promise<ExchangeRateSuggestion | undefined>;
  /** Las reglas de la E con lo respondido: las mismas que `--cm` (`EXPORT_RULES`). */
  readonly rules: (state: S) => ExportRuleScope;
  /** Los pasos de donde salen la moneda, el tipo y como pagan: si cambian, la cotizacion se pregunta de cero. */
  readonly dependsOn: readonly WizardDependency[];
}

/**
 * La cotizacion de una E en moneda extranjera, despues de la moneda: la misma pregunta que "En pesos" en A, B y C
 * (`exchangeRateStep`). Arranca escrita con la que tomaria el CLI; si queda esa, el comando equivalente no lleva
 * `--cm`, y si se edita, si. Donde ARCA exige la suya (servicios y `--misma-moneda`) no se pregunta: se muestra, en el
 * mismo lugar, con el motivo (`fixedExchangeRateNotice`). En pesos, nada. La comparten la factura, la nota y "Repetir" E
 * (NAV-9).
 */
export function exportExchangeRateStep<S>(def: ExportExchangeRateStepDef<S>): WizardStep<S> {
  const step = exchangeRateStep<S>({
    currency: (state) => def.voucher(state).currencyCode,
    dependsOn: def.dependsOn,
    // En la E no hay cotizacion de la config (REV-35): solo la escrita llega a la entrada.
    rate: {
      get: (state) => ({ exchangeRate: def.exchangeRate.get(state), exchangeRateSource: undefined }),
      set: (value, state) => def.exchangeRate.set(value?.exchangeRate, state),
    },
    skip: (state) => !exportAsksExchangeRate(def.voucher(state)),
    suggestion: def.suggestion,
    validate: (state) =>
      scopedRuleValidator(
        EXPORT_RULES,
        'exchangeRate',
        def.rules(state),
        (value) => ({ exchangeRate: parseExchangeRateInput(value) }),
        validateExchangeRate,
      ),
    writes: ['exchangeRate'],
  });

  return {
    ...step,
    skipNotice: async (state) => {
      const voucher = def.voucher(state);
      const fixed = exportFixedExchangeRate(voucher);

      if (fixed) {
        writeTerminalOutput(
          noticePanel(fixedExchangeRateNotice(fixed, voucher.currencyCode, await def.suggestion(state)), 'info'),
        );
      }
    },
  };
}

/**
 * El aviso de la cotizacion que exige ARCA, con el formato de `formatExchangeRate`: "Cotización: 1.174,605 por USD, la
 * de aduana del día hábil anterior. ARCA no acepta otra en servicios." Sin la cotizacion (sin red), lo que va igual.
 */
function fixedExchangeRateNotice(
  fixed: NonNullable<ReturnType<typeof exportFixedExchangeRate>>,
  currencyCode: string,
  suggested: ExchangeRateSuggestion | undefined,
): string {
  if (!suggested) {
    return 'No se pudo consultar la cotización: va la de ARCA del día hábil anterior.';
  }

  const iso = toIsoCurrencyCode(currencyCode);
  const which =
    suggested.source === 'associated'
      ? `la de ${suggested.associated}`
      : fixed === 'services'
        ? 'la de aduana del día hábil anterior'
        : 'la oficial del día hábil anterior';
  const reason = fixed === 'services' ? 'en servicios' : `si te pagan en ${iso}`;

  return `Cotización: ${formatExchangeRate(suggested.rate)} por ${iso}, ${which}. ARCA no acepta otra ${reason}.`;
}
