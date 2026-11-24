import { formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import {
  exportClientCountryCuitChoices,
  exportDestinationCountryChoices,
  type ExportTextField,
  exportTextFieldError,
  resolveExportClientCountryCuit,
  resolveExportDestinationCountry,
} from '../../modules/export/export.mappers';
import { EXPORT_RULES, type ExportRuleContext } from '../../modules/export/export.rules';
import {
  DEFAULT_EXPORT_LANGUAGE,
  type ExportCountry,
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
import { validateExportVoucherDate, validateOptionalDate } from '../../modules/interactive/validators';
import { BACK, type Back, requireStepValue, type WizardStep } from '../../modules/interactive/wizard';
import { formatTableRows } from '../../ui';
import { withSpinner } from '../spinner';

import { optionalsStep } from './optionals-step';
import { askTextStep, chooseOrTypeStep, chooseStep } from './prompts';
import { dateStep } from './steps/date';

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
  options: { readonly now?: () => Date; readonly undecided?: boolean } = {},
): (value: string) => string | true {
  // Hoy se lee en cada validacion, no al abrir la pregunta (ARQ-19).
  const now = options.now ?? (() => new Date());

  return ruleValidator<string | undefined, ExportVoucherInput, ExportRuleContext>({
    context: () => ({ today: formatDateAsArcaDate(now()), undecidedVoucherDate: options.undecided ?? true }),
    draft: (typed, value) => ({
      paymentDate: value.trim() ? completeDateInput(value, now()) : undefined,
      voucherDate: typed,
    }),
    field: 'paymentDate',
    rules: EXPORT_RULES,
    validate: (value: string) => validateOptionalDate(value, now()),
  })(voucherDate);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateCountry(countries: readonly ExportCountry[]): (value: string) => string | true {
  return (value) => {
    try {
      resolveExportDestinationCountry(value, countries);

      return true;
    } catch (error) {
      return errorMessage(error);
    }
  };
}

/**
 * El pais de destino de una lista donde tambien se escribe (TUI-24): los destinos de la tabla de ARCA con su codigo,
 * que tambien lo encuentra al escribir. Escrito, el nombre o el codigo se resuelven como `--pais-destino`.
 */
export async function askDestinationCountry(
  countries: readonly ExportCountry[],
  previous: string | undefined,
): Promise<typeof BACK | ExportCountry> {
  const choices = exportDestinationCountryChoices(countries);
  const { header, rows } = formatTableRows(
    ['CÓDIGO', 'PAÍS'],
    choices.map((country) => [String(country.code), country.name]),
  );
  const answer = await chooseOrTypeStep<string>(
    'País de destino:',
    choices.map((country, index) => ({
      keywords: String(country.code),
      label: rows[index] ?? country.name,
      short: country.name,
      value: country.name,
    })),
    {
      header,
      help: 'Escribí el nombre o el código de ARCA, por ejemplo "estados" o "212".',
      parse: (value) => resolveExportDestinationCountry(value, countries).name,
      previous,
      validate: validateCountry(countries),
    },
  );

  return answer === BACK ? BACK : resolveExportDestinationCountry(answer, countries);
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

/**
 * El CUIT del pais del cliente (`--cuit-pais`), de una lista donde tambien se escribe (TUI-35): la lista trae los CUIT
 * que acepta el flag para el destino (`exportClientCountryCuitChoices`), y se filtra por el pais o el numero. Un numero
 * escrito se valida como `--cuit-pais`. Con `optional`, la primera fila lo deja sin CUIT (`undefined`): la E va con el
 * ID impositivo. Con `previous` (lo respondido antes), arranca marcado si sigue siendo del destino (REV-74, #10).
 */
export async function askCountryCuit(
  context: ExportCountryCuitContext,
  message: string,
  options: {
    readonly emptyLabel?: string;
    readonly optional?: boolean;
    readonly previous?: number;
    readonly requireChoice?: string;
  } = {},
): Promise<Back | number | undefined> {
  const { previous } = options;
  const choices = exportClientCountryCuitChoices({ country: context.country, countries: context.countryCuits });
  const { header, rows } = formatTableRows(
    ['CUIT', 'PAÍS'],
    choices.map((entry) => [String(entry.cuit), entry.countryName]),
  );

  return chooseOrTypeStep<number>(
    message,
    choices.map((entry, index) => ({
      // El numero solo tambien es la fila: escribirlo entero la elige, sin "Usar lo escrito".
      keywords: String(entry.cuit),
      label: rows[index] ?? String(entry.cuit),
      value: entry.cuit,
    })),
    {
      emptyLabel: options.emptyLabel,
      header,
      optional: options.optional,
      requireChoice: options.requireChoice,
      parse: (text) => Number(parseStrictInteger(text)),
      previous: previous !== undefined && validateCountryCuit(context, previous) === true ? previous : undefined,
      validate: (text) => {
        const cuit = parseStrictInteger(text);

        return cuit === undefined
          ? `Nada de la lista coincide con "${text.trim()}": elegí un CUIT o escribí el número.`
          : validateCountryCuit(context, cuit);
      },
    },
  );
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
          const cuit = await askCountryCuit(countryCuit, `CUIT del país del cliente (${countryCuit.country.name}):`, {
            previous: previous?.clientCountryCuit ?? current.clientCountryCuit,
          });

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
            (value) => ({ ...current, voucherDate: completeDateInput(value, new Date()) }),
            (value) => validateExportVoucherDate(value, context.exportType, new Date()),
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
