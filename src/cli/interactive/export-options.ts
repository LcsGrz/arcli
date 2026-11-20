import { formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { parseArgentineAmount } from '../../lib/numbers/argentine-amount';
import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import { formatMoneyLabel } from '../../modules/billing/billing.labels';
import { sumExportItems } from '../../modules/export/export.items';
import {
  type ExportTextField,
  exportTextFieldError,
  resolveExportClientCountryCuit,
} from '../../modules/export/export.mappers';
import { EXPORT_RULES, type ExportRuleContext } from '../../modules/export/export.rules';
import {
  DEFAULT_EXPORT_LANGUAGE,
  DEFAULT_EXPORT_UNIT_CODE,
  EXPORT_TOTAL_ONLY_UNIT_CODES,
  type ExportCountryCuit,
  type ExportItemInput,
  type ExportVoucherInput,
} from '../../modules/export/export.types';
import { amountInputText, parseExchangeRateInput } from '../../modules/interactive/amount-input';
import type { InteractiveChoice } from '../../modules/interactive/choices';
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
import { validateExchangeRate, validateExportVoucherDate, validateOptionalDate } from './validators';

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
 * `--fecha-pago` (`EXPORT_RULES`). Se pregunta despues de los opcionales, asi ya se sabe la del comprobante
 * (`voucherDate`, dd/mm/aaaa); sin ella, hoy.
 */
export function validateExportPaymentDate(
  voucherDate: string | undefined,
  now = new Date(),
): (value: string) => string | true {
  return ruleValidator<string | undefined, ExportVoucherInput, ExportRuleContext>({
    context: () => ({ today: formatDateAsArcaDate(now) }),
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

function validateItemDescription(value: string, allowEmpty: boolean): string | true {
  if (!value.trim()) {
    return allowEmpty ? true : 'Cada ítem necesita una descripción.';
  }

  if (value.includes('|')) {
    return 'La descripción no puede llevar "|".';
  }

  return exportTextFieldError('description', value) ?? true;
}

/** Cantidad o precio de un item, como `--item`: hasta seis decimales y mayor a 0. */
function validateItemNumber(label: string): (value: string) => string | true {
  return (value) => {
    const parsed = parseArgentineAmount(value, { maxDecimals: 6 });

    if (!parsed.ok) {
      return `${label} no tiene un formato válido: ${parsed.reason}.`;
    }

    return parsed.value > 0 ? true : `${label} tiene que ser mayor a 0.`;
  };
}

function parseItemNumber(value: string): number {
  const parsed = parseArgentineAmount(value, { maxDecimals: 6 });

  return parsed.ok ? parsed.value : 0;
}

/** "el ítem" o "los 3 ítems": como se nombran los items ya cargados. */
function loadedItems(count: number): string {
  return count === 1 ? 'el ítem' : `los ${count} ítems`;
}

type LoadedItemsChoice = 'nuevo' | 'seguir' | 'usar';

/**
 * Con items ya cargados, se elige usarlos (si suman el monto) o seguir cargando (si todavia no llegan), o empezar de
 * nuevo. Si ya se pasan del monto, solo se puede empezar de nuevo.
 */
async function askLoadedItems(
  items: readonly ExportItemInput[],
  context: ExportOptionalsContext,
): Promise<Back | LoadedItemsChoice> {
  const total = sumExportItems(items);
  const money = (value: number) => formatMoneyLabel(value, context.currencyCode);
  const verb = items.length === 1 ? 'Suma' : 'Suman';
  const choices: Array<InteractiveChoice<LoadedItemsChoice>> = [];

  if (total === context.amount) {
    choices.push({
      description: `${verb} ${money(total)}, el monto total`,
      name: `Usar ${loadedItems(items.length)}`,
      value: 'usar',
    });
  } else if (total < context.amount) {
    choices.push({
      description: `${verb} ${money(total)} de ${money(context.amount)}`,
      name: 'Seguir cargando',
      value: 'seguir',
    });
  }

  choices.push({
    description:
      total > context.amount
        ? `${verb} ${money(total)} y el monto es ${money(context.amount)}`
        : 'Empieza por el ítem 1',
    name: 'Cargar de nuevo',
    value: 'nuevo',
  });

  return chooseStep('¿Qué hacemos con los ítems ya cargados?', choices);
}

/**
 * Los items, uno por uno: descripcion, cantidad, precio unitario y unidad. Enter en la descripcion termina, y la
 * suma tiene que dar el monto total, igual que `--item`. Si no da, avisa y sigue pidiendo items.
 *
 * Al volver a la pregunta (por ejemplo, con Esc en la fecha de pago), arranca con lo cargado (REV-68), de la misma
 * fuente que la seleccion: los items de la ultima carga terminada (`previous`, lo que se aplica). Una carga a medias
 * sin ninguna terminada antes queda en el memo, para seguirla. "Cargar de nuevo" no borra nada mientras la carga nueva
 * no termina: si se vuelve antes, siguen los de antes.
 */
function itemsStep(context: ExportOptionalsContext): WizardStep<ExportOptions> {
  return {
    name: 'items',
    writes: ['items'],
    run: async (_current, previous, memo) => {
      const units = await withSpinner('Consultando las unidades de WSFEX...', context.units);
      const finished = previous?.items ?? [];
      const loaded = finished.length > 0 ? finished : (memo.get<readonly ExportItemInput[]>() ?? []);
      const items: ExportItemInput[] = [];

      if (loaded.length > 0) {
        const choice = await askLoadedItems(loaded, context);

        if (choice === BACK) {
          return BACK;
        }

        if (choice === 'usar') {
          return { items: [...loaded] };
        }

        if (choice === 'seguir') {
          items.push(...loaded);
        }
      }

      // Solo una carga sin ninguna terminada se recuerda a medias: la terminada es la que muestra la seleccion.
      const remember = finished.length === 0;

      for (;;) {
        const description = await askTextStep(
          `Descripción del ítem ${items.length + 1}${items.length > 0 ? ' (Enter para terminar)' : ''}:`,
          { validate: (value) => validateItemDescription(value, items.length > 0) },
        );

        if (description === BACK) {
          return BACK;
        }

        if (!description.trim()) {
          const total = sumExportItems(items);

          if (total === context.amount) {
            memo.set<readonly ExportItemInput[]>([]);

            return { items: [...items] };
          }

          writeTerminalOutput(
            noticePanel(
              `La suma de los ítems (${formatMoneyLabel(total, context.currencyCode)}) no coincide con el monto total (${formatMoneyLabel(context.amount, context.currencyCode)}). Agregá otro ítem, o volvé y elegí "Cargar de nuevo".`,
              'warning',
            ),
          );
          continue;
        }

        const quantity = await askTextStep('Cantidad:', { validate: validateItemNumber('La cantidad') });

        if (quantity === BACK) {
          return BACK;
        }

        const unitPrice = await askTextStep('Precio unitario:', { validate: validateItemNumber('El precio') });

        if (unitPrice === BACK) {
          return BACK;
        }

        // Sin 0, 97 (seña o anticipo) ni 99 (bonificación): van sin cantidad ni precio (1775) y ARCLI todavía no las acepta.
        const selectable = units.filter((entry) => !EXPORT_TOTAL_ONLY_UNIT_CODES.includes(entry.id));
        const unit =
          selectable.length > 0
            ? await chooseStep(
                'Unidad:',
                selectable.map((entry) => ({ name: entry.name, value: entry.id })),
                DEFAULT_EXPORT_UNIT_CODE,
              )
            : DEFAULT_EXPORT_UNIT_CODE;

        if (unit === BACK) {
          return BACK;
        }

        items.push({
          description: description.trim(),
          quantity: parseItemNumber(quantity),
          unit,
          unitPrice: parseItemNumber(unitPrice),
        });

        if (remember) {
          memo.set<readonly ExportItemInput[]>([...items]);
        }
      }
    },
  };
}

/** Mismas reglas que `--cm` (`EXPORT_RULES`): un numero valido y, en moneda extranjera, mayor a 0. */
function validateExportExchangeRate(context: ExportOptionalsContext): (value: string) => string | true {
  return ruleValidator<ExportOptionalsContext, ExportVoucherInput, ExportRuleContext>({
    context: (current) => current.rules.context,
    draft: (current, value) => ({ currencyCode: current.currencyCode, exchangeRate: parseExchangeRateInput(value) }),
    field: 'exchangeRate',
    rules: EXPORT_RULES,
    validate: validateExchangeRate,
  })(context);
}

/**
 * Las preguntas de cada opcional de la E, una por paso: "Volver" lleva a la anterior y, desde la primera, a la
 * seleccion. El idioma anota en `languageNames` los nombres que trae WSFEX, para describir el elegido en la seleccion.
 */
function exportQuestions(languageNames: Map<number, string>): ExportOptionalQuestions {
  return {
    cotizacion: (context) => [
      {
        name: 'cotizacion',
        writes: ['exchangeRate'],
        run: async (_current, previous) => {
          const code = context.currencyCode === 'DOL' ? 'USD' : context.currencyCode;
          const answer = await askTextStep(`Cotización de ${code}:`, {
            previousAnswer: amountInputText(previous?.exchangeRate),
            validate: validateExportExchangeRate(context),
          });

          return answer === BACK ? BACK : { exchangeRate: parseExchangeRateInput(answer) };
        },
      },
    ],
    'cuit-pais': (context) => [
      {
        name: 'cuit-pais',
        run: async (current, previous) => {
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
        run: async (current, previous) => {
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
        run: async (current, previous) => {
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
    items: (context) => [itemsStep(context)],
    observaciones: () => [
      {
        name: 'observaciones',
        run: async (current, previous) => {
          const observations = await askTextStep('Observaciones (Enter si no hay):', {
            previousAnswer: previous?.observations ?? current.observations,
            validate: validateExportText('observations'),
          });

          return observations === BACK ? BACK : { observations: observations.trim() || undefined };
        },
      },
      {
        name: 'observaciones-comerciales',
        run: async (current, previous) => {
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
