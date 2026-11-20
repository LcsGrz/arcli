import { parseStrictInteger } from '../../../lib/numbers/strict-integer';
import { exportActivityProblem } from '../../../modules/export/export.mappers';
import { EXPORT_RULES } from '../../../modules/export/export.rules';
import type {
  ExportActivity,
  ExportCountry,
  ExportCountryCuit,
  ExportGateway,
  ExportType,
} from '../../../modules/export/export.types';
import { parseExchangeRateInput } from '../../../modules/interactive/amount-input';
import type { ExchangeRateSuggestion } from '../../../modules/interactive/billing-optionals';
import type { ExportOptions, ExportRuleScope } from '../../../modules/interactive/export-optionals';
import { scopedRuleValidator } from '../../../modules/interactive/rule-validator';
import { exportAsksExchangeRate, type ExportExchangeRateCase } from '../../../modules/interactive/steps/currency';
import type { Lens } from '../../../modules/interactive/steps/lens';
import { BACK, type WizardDependency, type WizardStep } from '../../../modules/interactive/wizard';
import { withSpinner } from '../../spinner';
import { validateExportPaymentDate } from '../export-options';
import { askTextStep } from '../prompts';
import { validateExchangeRate, validatePositiveInteger } from '../validators';

import { exchangeRateStep } from './currency';
import { dateStep } from './date';

/**
 * Lo que la E necesita de WSFEX antes de preguntar: los paises para validar el destino y sus CUIT. La cargan "Emitir
 * factura E" y "Repetir" E. La tabla de actividades se consulta recien si se pregunta la actividad (`activitiesLoader`).
 */
export interface ExportTables {
  readonly countries: readonly ExportCountry[];
  readonly countryCuits: readonly ExportCountryCuit[];
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
 * La actividad de WSFEX, si no esta en la config (ni en la factura que se repite). Es opcional: ARCA no exige
 * `Actividades` (la 2100 solo prohibe el bloque vacio). La comparten "Emitir factura E" y "Repetir" E (REV-74, #11).
 */
export function activityStep<S>(def: ActivityStepDef<S>): WizardStep<S> {
  return {
    name: 'actividad',
    run: async (state, { previous }) => {
      const typed = previous ? def.activity.get(previous as S) : undefined;
      const activities = await def.activities();
      const answer = await askTextStep('Código de actividad de WSFEX, por ejemplo 620100 (Enter para no informarla):', {
        previousAnswer: typed === undefined ? undefined : String(typed),
        validate: validateActivity(activities),
      });

      return answer === BACK ? BACK : def.activity.set(answer.trim() ? parseStrictInteger(answer) : undefined, state);
    },
    skip: def.skip,
  };
}

/**
 * "Fecha de pago", despues de los opcionales: no puede ser anterior a la fecha del comprobante, que se elige ahi
 * (1674). Solo la fecha del comprobante: cambiar otro opcional no la olvida. En bienes ARCA la rechaza (1673). La
 * comparten "Emitir factura E" y "Repetir" E.
 */
export function exportPaymentDateStep<S extends { readonly options?: ExportOptions; readonly paymentDate?: string }>(
  exportType: (state: S) => ExportType | undefined,
): WizardStep<S> {
  return dateStep<S>({
    date: {
      get: (state) => state.paymentDate,
      set: (paymentDate) => ({ paymentDate }) as Partial<S>,
    },
    dependsOn: [{ fields: ['options.voucherDate'], step: 'opcionales' }],
    message: 'Fecha de pago (Enter para la fecha del comprobante):',
    name: 'fecha-pago',
    optional: true,
    skip: (state) => exportType(state) === 1,
    validate: (state) => validateExportPaymentDate(state.options?.voucherDate),
    writes: ['paymentDate'],
  });
}

export interface ExportExchangeRateStepDef<S> {
  readonly exchangeRate: Lens<S, number>;
  /** Moneda, tipo de exportacion y como pagan: deciden si se pregunta (`exportAsksExchangeRate`). */
  readonly voucher: (state: S) => ExportExchangeRateCase;
  /**
   * Con que arranca escrita: la que toma el CLI sin `--cotizacion-moneda`, la de aduana de ARCA en la factura
   * (`exportExchangeRateLoader`) o la del asociado en la nota.
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
 * `--cm`, y si se edita, si. No se pregunta donde ARCA exige la suya (servicios y `--misma-moneda`) ni en pesos. La
 * comparten la factura, la nota y "Repetir" E (NAV-9).
 */
export function exportExchangeRateStep<S>(def: ExportExchangeRateStepDef<S>): WizardStep<S> {
  return exchangeRateStep<S>({
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
}
