import { parseStrictInteger } from '../../../lib/numbers/strict-integer';
import { exportActivityProblem } from '../../../modules/export/export.mappers';
import type {
  ExportActivity,
  ExportCountry,
  ExportCountryCuit,
  ExportGateway,
  ExportType,
} from '../../../modules/export/export.types';
import type { ExportOptions } from '../../../modules/interactive/export-optionals';
import type { Lens } from '../../../modules/interactive/steps/lens';
import { BACK, type WizardStep } from '../../../modules/interactive/wizard';
import { withSpinner } from '../../spinner';
import { validateExportPaymentDate } from '../export-options';
import { askTextStep } from '../prompts';
import { validatePositiveInteger } from '../validators';

import { dateStep } from './date';

/**
 * Lo que la E necesita de WSFEX antes de preguntar: los paises para validar el destino, sus CUIT y la tabla de
 * actividades. La cargan "Emitir factura E" y "Repetir" E.
 */
export interface ExportTables {
  readonly activities: readonly ExportActivity[];
  readonly countries: readonly ExportCountry[];
  readonly countryCuits: readonly ExportCountryCuit[];
}

export function loadExportTables(
  gateway: Pick<ExportGateway, 'getActivities' | 'getDestinationCountries' | 'getDestinationCountryCuits'>,
): Promise<ExportTables> {
  return withSpinner('Consultando las tablas de WSFEX...', async () => ({
    activities: await gateway.getActivities(),
    countries: await gateway.getDestinationCountries(),
    countryCuits: await gateway.getDestinationCountryCuits(),
  }));
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
  readonly activities: readonly ExportActivity[];
  readonly skip: (state: S) => boolean;
}

/**
 * La actividad de WSFEX, si no esta en la config (ni en la factura que se repite). Es opcional: ARCA no exige
 * `Actividades` (la 2100 solo prohibe el bloque vacio). La comparten "Emitir factura E" y "Repetir" E (REV-74, #11).
 */
export function activityStep<S>(def: ActivityStepDef<S>): WizardStep<S> {
  return {
    name: 'actividad',
    run: async (state, previous) => {
      const typed = previous ? def.activity.get(previous as S) : undefined;
      const answer = await askTextStep('Código de actividad de WSFEX, por ejemplo 620100 (Enter para no informarla):', {
        previousAnswer: typed === undefined ? undefined : String(typed),
        validate: validateActivity(def.activities),
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
