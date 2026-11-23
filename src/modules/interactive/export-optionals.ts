import { resolveExportClientCountryCuit } from '../export/export.mappers';
import type { ExportRuleContext } from '../export/export.rules';
import type {
  ExportCountry,
  ExportCountryCuit,
  ExportLanguage,
  ExportType,
  ExportVoucherInput,
} from '../export/export.types';

import type { OptionalDef } from './optional-group';
import type { RuleScope } from './rule-validator';
import type { WizardStep } from './wizard';

/** Lo opcional de una E: lo que el CLI tiene con flags y el asistente no pregunta si no se marca. */
export type ExportOptions = Pick<
  ExportVoucherInput,
  'clientCountryCuit' | 'commercialObservations' | 'incotermDescription' | 'language' | 'observations' | 'voucherDate'
>;

/** @internal Exportado para los tests. */
export type ExportOptionKey = 'cuit-pais' | 'fecha' | 'idioma' | 'incoterm' | 'observaciones';

/** El CUIT del pais se elige contra la tabla DST_CUIT, con el destino ya elegido. */
export interface ExportCountryCuitContext {
  readonly country: ExportCountry;
  readonly countryCuits: readonly ExportCountryCuit[];
}

/**
 * `true` si la tabla DST_CUIT de ARCA no tiene CUIT para el destino: entonces se pregunta, y si se deja vacio el ID
 * impositivo pasa a ser obligatorio (ARCA pide uno de los dos, error 1580).
 */
export function isCountryCuitMissing(context: ExportCountryCuitContext): boolean {
  return resolveExportClientCountryCuit({ country: context.country, countries: context.countryCuits }) === undefined;
}

export interface ExportOptionalsContext {
  /**
   * El comprobante que ajusta la nota, como una clave: el incoterm es el suyo, asi que con otro la descripcion del
   * incoterm olvida lo marcado y respondido. Lo demas que se eligio no depende del asociado.
   */
  readonly associated?: string;
  /**
   * La factura de la que se copian idioma, CUIT del pais y descripcion del incoterm ("Repetir"), como una clave:
   * si cambia, esos opcionales olvidan lo marcado y respondido y arrancan con lo copiado de la nueva.
   */
  readonly copiedFrom?: string;
  /** Solo en la factura y "Repetir": en las notas sale del asociado. */
  readonly countryCuit?: ExportCountryCuitContext;
  readonly currencyCode: string;
  /** Idioma que se usa si no se elige otro, para mostrar en la lista. */
  readonly defaultLanguage: string;
  /** La ventana de la fecha del comprobante depende del tipo: en servicios no pasa del fin de mes (1500). */
  readonly exportType: ExportType;
  /** Incoterm elegido (o el del asociado), con la descripcion por defecto. Sin esto no se ofrece la descripcion. */
  readonly incoterm?: { readonly code: string; readonly description?: string };
  /** Los nombres de los idiomas que ya se consultaron a WSFEX, para describir el elegido. */
  readonly languageNames: ReadonlyMap<number, string>;
  readonly languages: () => Promise<readonly ExportLanguage[]>;
  /**
   * Las reglas entre campos de la E (`EXPORT_RULES`) con la entrada del flujo: la fecha del comprobante, por ejemplo,
   * no puede quedar antes de la del asociado en una nota.
   */
  readonly rules: ExportRuleScope;
}

/** Las reglas de la E desde una pregunta: la entrada que se arma con lo respondido y su contexto. */
export type ExportRuleScope = RuleScope<ExportVoucherInput, ExportRuleContext>;

/** Las preguntas de cada opcional de la E: las inyecta `cli` (llaman a `prompts`). */
export type ExportOptionalQuestions = Readonly<
  Record<ExportOptionKey, (context: ExportOptionalsContext) => ReadonlyArray<WizardStep<ExportOptions>>>
>;

export type ExportOptionalDef = OptionalDef<ExportOptionKey, ExportOptions, ExportOptionalsContext>;

function describeObservations(options: ExportOptions): string {
  const parts = [
    options.observations ? 'observaciones' : undefined,
    options.commercialObservations ? 'comerciales' : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? `con ${parts.join(' y ')}` : 'sin observaciones';
}

/**
 * Sin CUIT escrito va el que ARCA publica para el destino; si no publica ninguno, la E va solo con el ID impositivo
 * (REV-74, #9).
 */
function describeCountryCuit(options: ExportOptions, context: ExportOptionalsContext): string {
  if (options.clientCountryCuit !== undefined) {
    return String(options.clientCountryCuit);
  }

  return context.countryCuit && isCountryCuitMissing(context.countryCuit)
    ? 'sin CUIT (va el ID impositivo)'
    : 'el de la tabla de ARCA';
}

const copiedFrom = (context: ExportOptionalsContext): string => context.copiedFrom ?? '';

/**
 * Los opcionales de la E (factura, notas y "Repetir"), en el orden en que se muestran y se preguntan. Lo que se copia
 * de la factura que se repite (`copiedFrom`) la sigue: con otra, arranca con lo copiado de la nueva. En las notas, la
 * descripcion del incoterm sigue al asociado (`associated`). Los items no son un opcional: son un paso fijo
 * (`exportItemsStep`, NAV-10).
 */
export function exportOptionals(questions: ExportOptionalQuestions): readonly ExportOptionalDef[] {
  return [
    {
      available: () => true,
      describe: (current) => current.voucherDate ?? 'hoy',
      key: 'fecha',
      label: 'Fecha del comprobante',
      owns: ['voucherDate'],
      steps: questions.fecha,
    },
    {
      available: () => true,
      describe: (current, context) =>
        current.language === undefined
          ? context.defaultLanguage
          : (context.languageNames.get(current.language) ?? String(current.language)),
      key: 'idioma',
      label: 'Idioma',
      owns: ['language'],
      resetWhen: copiedFrom,
      steps: questions.idioma,
    },
    {
      available: (context) => context.countryCuit !== undefined,
      describe: describeCountryCuit,
      key: 'cuit-pais',
      label: 'CUIT del país',
      owns: ['clientCountryCuit'],
      resetWhen: copiedFrom,
      steps: questions['cuit-pais'],
    },
    {
      available: () => true,
      describe: describeObservations,
      key: 'observaciones',
      label: 'Observaciones',
      owns: ['observations', 'commercialObservations'],
      steps: questions.observaciones,
    },
    {
      available: (context) => context.incoterm !== undefined,
      describe: (current, context) =>
        current.incotermDescription ?? context.incoterm?.description ?? context.incoterm?.code ?? '',
      key: 'incoterm',
      label: 'Descripción del incoterm',
      owns: ['incotermDescription'],
      resetWhen: (context) => `${copiedFrom(context)}|${context.associated ?? ''}`,
      steps: questions.incoterm,
    },
  ];
}
