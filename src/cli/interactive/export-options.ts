import { formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import {
  type ExportTextField,
  exportTextFieldError,
  resolveExportClientCountryCuit,
} from '../../modules/export/export.mappers';
import { EXPORT_RULES, type ExportRuleContext } from '../../modules/export/export.rules';
import {
  DEFAULT_EXPORT_LANGUAGE,
  type ExportCountryCuit,
  type ExportVoucherInput,
} from '../../modules/export/export.types';
import { completeDateInput } from '../../modules/interactive/date-input';
import {
  type ExportCountryCuitContext,
  type ExportOptionalQuestions,
  exportOptionals,
  type ExportOptionalsContext,
  type ExportOptions,
} from '../../modules/interactive/export-optionals';
import { ruleValidator, scopedRuleValidator } from '../../modules/interactive/rule-validator';
import { BACK, type Back, requireStepValue, type WizardStep } from '../../modules/interactive/wizard';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { withSpinner } from '../spinner';

import { optionalsStep } from './optionals-step';
import { askTextStep, chooseStep } from './prompts';
import { dateStep } from './steps/date';
import { validateExportVoucherDate, validateOptionalDate } from './validators';

/**
 * Un texto de la E con el largo maximo de ARCA, como el flag (`assertExportTextLengths`). Con `required`, vacio es
 * error con ese nombre (`El cliente es obligatorio.`).
 */
export function validateExportText(field: ExportTextField, required?: string): (value: string) => string | true {
  return (value) => {
    if (required && !value.trim()) {
      return `${required} es obligatorio.`;
    }

    return exportTextFieldError(field, value) ?? true;
  };
}

/**
 * Fecha de pago opcional: igual o posterior a la del comprobante (1674, WSFEX v3.1.0), la misma regla que
 * `--fecha-pago` (`EXPORT_RULES`). Se pregunta antes de los opcionales (TUI-22), donde se elige la del comprobante:
 * sin ella (`voucherDate`, dd/mm/aaaa), contra la mas temprana que acepta ARCA (`undecided`) o, si ya se sabe que
 * va la de hoy, contra hoy. La comparacion exacta la hacen "Fecha del comprobante" y `finalize`, que vuelve aca.
 */
export function validateExportPaymentDate(
  voucherDate: string | undefined,
  options: { readonly now?: Date; readonly undecided?: boolean } = {},
): (value: string) => string | true {
  const now = options.now ?? new Date();

  return ruleValidator<string | undefined, ExportVoucherInput, ExportRuleContext>({
    context: () => ({ today: formatDateAsArcaDate(now), undecidedVoucherDate: options.undecided ?? true }),
    draft: (typed, value) => ({
      paymentDate: value.trim() ? completeDateInput(value, now) : undefined,
      voucherDate: typed,
    }),
    field: 'paymentDate',
    rules: EXPORT_RULES,
    validate: validateOptionalDate,
  })(voucherDate);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeName(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Mismo control que `--cuit-pais`: que exista en la tabla de ARCA y sea del destino. */
function validateCountryCuit(context: ExportCountryCuitContext, cuit: number): string | true {
  try {
    resolveExportClientCountryCuit({ country: context.country, countries: context.countryCuits, cuit });

    return true;
  } catch (error) {
    return errorMessage(error);
  }
}

function findCountryCuits(context: ExportCountryCuitContext, search: string): ExportCountryCuit[] {
  const wanted = normalizeName(search);

  return context.countryCuits.filter((entry) => normalizeName(entry.countryName).includes(wanted));
}

/**
 * El CUIT del pais del cliente (`--cuit-pais`): se escribe el numero o se busca el pais por nombre en la tabla de
 * ARCA y se elige de la lista. Con `optional`, Enter lo deja sin CUIT (`undefined`): la E va con el ID impositivo.
 * Con `previous` (lo respondido antes), arranca escrito si sigue siendo del destino (REV-74, #10).
 */
export async function askCountryCuit(
  context: ExportCountryCuitContext,
  message: string,
  options: { readonly optional?: boolean; readonly previous?: number } = {},
): Promise<Back | number | undefined> {
  const { previous } = options;

  for (;;) {
    const answer = await askTextStep(message, {
      previousAnswer:
        previous !== undefined && validateCountryCuit(context, previous) === true ? String(previous) : undefined,
      validate: (value) => {
        if (!value.trim()) {
          return options.optional ? true : 'Escribí el CUIT o parte del nombre del país.';
        }

        const cuit = parseStrictInteger(value);

        if (cuit !== undefined) {
          return validateCountryCuit(context, cuit);
        }

        return findCountryCuits(context, value).length > 0
          ? true
          : `La tabla de CUIT de países de ARCA no tiene "${value.trim()}". Probá con otra parte del nombre.`;
      },
    });

    if (answer === BACK) {
      return BACK;
    }

    if (!answer.trim()) {
      return undefined;
    }

    const typed = parseStrictInteger(answer);

    if (typed !== undefined) {
      return typed;
    }

    const picked = await chooseStep(
      'CUIT del país:',
      findCountryCuits(context, answer).map((entry) => ({
        description: String(entry.cuit),
        name: entry.countryName,
        value: entry.cuit,
      })),
    );

    if (picked === BACK) {
      continue;
    }

    const valid = validateCountryCuit(context, picked);

    if (valid === true) {
      return picked;
    }

    writeTerminalOutput(noticePanel(valid, 'warning'));
  }
}

/**
 * Las preguntas de cada opcional de la E, una por paso: "Volver" lleva a la anterior y, desde la primera, a la
 * seleccion. El idioma anota en `languageNames` los nombres que trae WSFEX, para describir el elegido en la seleccion.
 */
function exportQuestions(languageNames: Map<number, string>): ExportOptionalQuestions {
  return {
    'cuit-pais': (context) => [
      {
        name: 'cuit-pais',
        run: async (current, { previous }) => {
          const countryCuit = requireStepValue(context.countryCuit, 'countryCuit');
          const cuit = await askCountryCuit(
            countryCuit,
            `CUIT del país del cliente (el número, o buscá ${countryCuit.country.name} por nombre):`,
            { previous: previous?.clientCountryCuit ?? current.clientCountryCuit },
          );

          return cuit === BACK ? BACK : { clientCountryCuit: cuit };
        },
      },
    ],
    fecha: (context) => [
      // Con las reglas de `--fecha`, guardada completa (`dateStep`). La cotizacion la busca ExportService para esa fecha.
      dateStep<ExportOptions>({
        date: {
          get: (current) => current.voucherDate,
          set: (voucherDate) => ({ voucherDate }),
        },
        message: 'Fecha del comprobante:',
        name: 'fecha',
        // La ventana de ARCA y, en las notas, no antes del asociado (`EXPORT_RULES`).
        validate: (current) =>
          scopedRuleValidator(
            EXPORT_RULES,
            'voucherDate',
            context.rules,
            (value) => ({ ...current, voucherDate: completeDateInput(value) }),
            (value) => validateExportVoucherDate(value, context.exportType),
          ),
        writes: ['voucherDate'],
      }),
    ],
    idioma: (context) => [
      {
        name: 'idioma',
        run: async (current, { previous }) => {
          const languages = await withSpinner('Consultando los idiomas de WSFEX...', context.languages);

          for (const language of languages) languageNames.set(language.id, language.name);

          const language = await chooseStep(
            'Idioma del comprobante:',
            languages.map((entry) => ({ name: entry.name, value: entry.id })),
            previous?.language ?? current.language ?? DEFAULT_EXPORT_LANGUAGE,
          );

          return language === BACK ? BACK : { language };
        },
      },
    ],
    incoterm: (context) => [
      {
        name: 'incoterm',
        run: async (current, { previous }) => {
          const incoterm = requireStepValue(context.incoterm, 'incoterm');
          const answer = await askTextStep(`Descripción del incoterm ${incoterm.code}:`, {
            defaultValue: current.incotermDescription ?? incoterm.description,
            previousAnswer: previous?.incotermDescription,
            validate: validateExportText('incotermDescription'),
          });

          if (answer === BACK) {
            return BACK;
          }

          const description = answer.trim();

          return {
            incotermDescription: description && description !== incoterm.description ? description : undefined,
          };
        },
      },
    ],
    observaciones: () => [
      {
        name: 'observaciones',
        run: async (current, { previous }) => {
          const observations = await askTextStep('Observaciones (Enter si no hay):', {
            previousAnswer: previous?.observations ?? current.observations,
            validate: validateExportText('observations'),
          });

          return observations === BACK ? BACK : { observations: observations.trim() || undefined };
        },
      },
      {
        name: 'observaciones-comerciales',
        run: async (current, { previous }) => {
          const commercial = await askTextStep('Observaciones comerciales (Enter si no hay):', {
            previousAnswer: previous?.commercialObservations ?? current.commercialObservations,
            validate: validateExportText('commercialObservations'),
          });

          return commercial === BACK ? BACK : { commercialObservations: commercial.trim() || undefined };
        },
      },
    ],
  };
}

export interface ExportOptionalsStepDef<S> {
  /** Nombre del paso en el asistente del flujo. */
  readonly name: string;
  /** Los opcionales antes del paso: de ahi arranca cada respuesta y a eso vuelve lo desmarcado. */
  readonly read: (state: S) => ExportOptions;
  readonly write: (options: ExportOptions) => Partial<S>;
  readonly context: (state: S) => Omit<ExportOptionalsContext, 'languageNames'>;
}

/** Los opcionales de la E (`optionalsStep` con su catalogo): factura, notas y "Repetir". */
export function exportOptionalsStep<S>(def: ExportOptionalsStepDef<S>): WizardStep<S> {
  const languageNames = new Map<number, string>();

  return optionalsStep({
    ...def,
    context: (state) => ({ ...def.context(state), languageNames }),
    options: exportOptionals(exportQuestions(languageNames)),
  });
}
