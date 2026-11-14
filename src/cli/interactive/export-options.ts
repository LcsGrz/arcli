import { formatArgentineAmount, formatExchangeRate, parseArgentineAmount } from '../../lib/numbers/argentine-amount';
import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import { sumExportItems } from '../../modules/export/export.items';
import { resolveExportClientCountryCuit, resolveExportCurrency } from '../../modules/export/export.mappers';
import {
  DEFAULT_EXPORT_LANGUAGE,
  DEFAULT_EXPORT_UNIT_CODE,
  type ExportCountry,
  type ExportCountryCuit,
  type ExportItemInput,
  type ExportLanguage,
  type ExportUnit,
  type ExportVoucherInput,
} from '../../modules/export/export.types';
import { parseExchangeRateInput } from '../../modules/interactive/amount-input';
import { BACK, type Back } from '../../modules/interactive/wizard';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { withSpinner } from '../spinner';

import { askTextStep, chooseManyStep, chooseStep } from './prompts';
import { validateExchangeRate } from './validators';

/** Lo opcional de una E: lo que el CLI tiene con flags y el asistente no pregunta si no se marca. */
export type ExportOptions = Pick<
  ExportVoucherInput,
  | 'clientCountryCuit'
  | 'commercialObservations'
  | 'exchangeRate'
  | 'incotermDescription'
  | 'items'
  | 'language'
  | 'observations'
>;

export type ExportOptionKey = 'cotizacion' | 'cuit-pais' | 'idioma' | 'incoterm' | 'items' | 'observaciones';

/** El CUIT del pais se elige contra la tabla DST_CUIT, con el destino ya elegido. */
export interface ExportCountryCuitContext {
  readonly country: ExportCountry;
  readonly countryCuits: readonly ExportCountryCuit[];
}

export interface ExportOptionsContext {
  /** Monto total: la suma de los items tiene que darlo. */
  readonly amount: number;
  /** Solo en la factura: en las notas sale del asociado. */
  readonly countryCuit?: ExportCountryCuitContext;
  readonly currencyCode: string;
  /** Cotizacion que se usa si no se ingresa otra, para mostrar en la lista. Sin esto no se ofrece la cotizacion. */
  readonly defaultExchangeRate?: string;
  /** Idioma que se usa si no se elige otro, para mostrar en la lista. */
  readonly defaultLanguage: string;
  /** Incoterm elegido (o el del asociado), con la descripcion por defecto. Sin esto no se ofrece la descripcion. */
  readonly incoterm?: { readonly code: string; readonly description?: string };
  readonly languages: () => Promise<readonly ExportLanguage[]>;
  readonly sameCurrency?: boolean;
  readonly units: () => Promise<readonly ExportUnit[]>;
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

/** `true` si la tabla DST_CUIT de ARCA no tiene CUIT para el destino: entonces hay que pedirlo. */
export function isCountryCuitMissing(context: ExportCountryCuitContext): boolean {
  try {
    resolveExportClientCountryCuit({ country: context.country, countries: context.countryCuits });

    return false;
  } catch {
    return true;
  }
}

function findCountryCuits(context: ExportCountryCuitContext, search: string): ExportCountryCuit[] {
  const wanted = normalizeName(search);

  return context.countryCuits.filter((entry) => normalizeName(entry.countryName).includes(wanted));
}

/**
 * El CUIT del pais del cliente (`--cuit-pais`): se escribe el numero o se busca el pais por nombre en la tabla de
 * ARCA y se elige de la lista. Es la salida cuando ARCA no publica un CUIT para el destino.
 */
export async function askCountryCuit(context: ExportCountryCuitContext, message: string): Promise<Back | number> {
  for (;;) {
    const answer = await askTextStep(message, {
      validate: (value) => {
        if (!value.trim()) {
          return 'Escribí el CUIT o parte del nombre del país.';
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

  return value.includes('|') ? 'La descripción no puede llevar "|".' : true;
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

/**
 * Los items, uno por uno: descripcion, cantidad, precio unitario y unidad. Enter en la descripcion termina, y la
 * suma tiene que dar el monto total, igual que `--item`. Si no da, avisa y sigue pidiendo items.
 */
async function askItems(current: ExportOptions, context: ExportOptionsContext): Promise<Back | ExportOptions> {
  const units = await withSpinner('Consultando las unidades de WSFEX...', context.units);
  const items: ExportItemInput[] = [];

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
        return { ...current, items };
      }

      writeTerminalOutput(
        noticePanel(
          `La suma de los ítems (${formatArgentineAmount(total)}) no coincide con el monto total (${formatArgentineAmount(context.amount)}). Agregá otro ítem o volvé para empezar de nuevo.`,
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

    const unit =
      units.length > 0
        ? await chooseStep(
            'Unidad:',
            units.map((entry) => ({ name: entry.name, value: entry.id })),
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
  }
}

async function askLanguage(
  current: ExportOptions,
  context: ExportOptionsContext,
  names: Map<number, string>,
): Promise<Back | ExportOptions> {
  const languages = await withSpinner('Consultando los idiomas de WSFEX...', context.languages);

  for (const language of languages) names.set(language.id, language.name);

  const language = await chooseStep(
    'Idioma del comprobante:',
    languages.map((entry) => ({ name: entry.name, value: entry.id })),
    current.language ?? DEFAULT_EXPORT_LANGUAGE,
  );

  return language === BACK ? BACK : { ...current, language };
}

async function askObservations(current: ExportOptions): Promise<Back | ExportOptions> {
  const observations = await askTextStep('Observaciones (Enter si no hay):');

  if (observations === BACK) {
    return BACK;
  }

  const commercial = await askTextStep('Observaciones comerciales (Enter si no hay):');

  return commercial === BACK
    ? BACK
    : {
        ...current,
        commercialObservations: commercial.trim() || undefined,
        observations: observations.trim() || undefined,
      };
}

async function askIncotermDescription(
  current: ExportOptions,
  incoterm: NonNullable<ExportOptionsContext['incoterm']>,
): Promise<Back | ExportOptions> {
  const answer = await askTextStep(`Descripción del incoterm ${incoterm.code}:`, {
    defaultValue: current.incotermDescription ?? incoterm.description,
  });

  if (answer === BACK) {
    return BACK;
  }

  const description = answer.trim();

  return {
    ...current,
    incotermDescription: description && description !== incoterm.description ? description : undefined,
  };
}

/** Mismas reglas que `--cm`: un numero valido y, en moneda extranjera, mayor a 1. */
function validateExportExchangeRate(context: ExportOptionsContext): (value: string) => string | true {
  return (value) => {
    const valid = validateExchangeRate(value);

    if (valid !== true) {
      return valid;
    }

    try {
      resolveExportCurrency({
        currencyCode: context.currencyCode,
        exchangeRate: parseExchangeRateInput(value),
        sameCurrency: context.sameCurrency,
      });

      return true;
    } catch (error) {
      return errorMessage(error);
    }
  };
}

async function askExchangeRate(current: ExportOptions, context: ExportOptionsContext): Promise<Back | ExportOptions> {
  const answer = await askTextStep(`Cotización de ${context.currencyCode === 'DOL' ? 'USD' : context.currencyCode}:`, {
    validate: validateExportExchangeRate(context),
  });

  return answer === BACK ? BACK : { ...current, exchangeRate: parseExchangeRateInput(answer) };
}

function describeItems(options: ExportOptions): string {
  const count = options.items?.length ?? 0;

  if (count === 0) {
    return 'un renglón con el monto total';
  }

  return count === 1 ? '1 ítem' : `${count} ítems`;
}

function describeObservations(options: ExportOptions): string {
  const parts = [
    options.observations ? 'observaciones' : undefined,
    options.commercialObservations ? 'comerciales' : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? `con ${parts.join(' y ')}` : 'sin observaciones';
}

function optionalChoices(options: ExportOptions, context: ExportOptionsContext, languageNames: Map<number, string>) {
  return [
    { description: describeItems(options), name: 'Ítems', value: 'items' as const },
    {
      description:
        options.language === undefined
          ? context.defaultLanguage
          : (languageNames.get(options.language) ?? String(options.language)),
      name: 'Idioma',
      value: 'idioma' as const,
    },
    ...(context.countryCuit
      ? [
          {
            description:
              options.clientCountryCuit === undefined ? 'el de la tabla de ARCA' : String(options.clientCountryCuit),
            name: 'CUIT del país',
            value: 'cuit-pais' as const,
          },
        ]
      : []),
    { description: describeObservations(options), name: 'Observaciones', value: 'observaciones' as const },
    ...(context.incoterm
      ? [
          {
            description: options.incotermDescription ?? context.incoterm.description ?? context.incoterm.code,
            name: 'Descripción del incoterm',
            value: 'incoterm' as const,
          },
        ]
      : []),
    ...(context.defaultExchangeRate
      ? [
          {
            description:
              options.exchangeRate === undefined
                ? context.defaultExchangeRate
                : formatExchangeRate(options.exchangeRate),
            name: 'Cotización',
            value: 'cotizacion' as const,
          },
        ]
      : []),
  ];
}

/**
 * Lo opcional de la factura y las notas E en una sola pregunta, como en A, B y C: se marca con espacio y Enter
 * sigue (sin marcar nada, todo queda por defecto). Despues se pregunta solo lo marcado, en orden. "Volver" en una
 * de esas preguntas vuelve a la seleccion, con lo marcado y lo ya respondido.
 */
export async function askExportOptions(
  initial: ExportOptions,
  context: ExportOptionsContext,
): Promise<Back | ExportOptions> {
  const languageNames = new Map<number, string>();
  const asks: Record<ExportOptionKey, (current: ExportOptions) => Promise<Back | ExportOptions>> = {
    cotizacion: (current) => askExchangeRate(current, context),
    'cuit-pais': async (current) => {
      const countryCuit = context.countryCuit;

      if (!countryCuit) {
        return current;
      }

      const cuit = await askCountryCuit(
        countryCuit,
        `CUIT del país del cliente (el número, o buscá ${countryCuit.country.name} por nombre):`,
      );

      return cuit === BACK ? BACK : { ...current, clientCountryCuit: cuit };
    },
    idioma: (current) => askLanguage(current, context, languageNames),
    incoterm: (current) =>
      context.incoterm ? askIncotermDescription(current, context.incoterm) : Promise.resolve(current),
    items: (current) => askItems(current, context),
    observaciones: askObservations,
  };
  let options = initial;
  let selected: ExportOptionKey[] = [];

  for (;;) {
    const picked = await chooseManyStep<ExportOptionKey>(
      '¿Agregamos algún opcional? (espacio para marcar, Enter para seguir)',
      optionalChoices(options, context, languageNames),
      selected,
    );

    if (picked === BACK) {
      return BACK;
    }

    selected = picked;

    let completed = true;

    for (const option of picked) {
      const updated = await asks[option](options);

      if (updated === BACK) {
        completed = false;
        break;
      }

      options = updated;
    }

    if (completed) {
      return options;
    }
  }
}
