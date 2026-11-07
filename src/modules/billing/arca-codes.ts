import type { BillingConcept, BillingDocumentType, BillingIvaCondition, BillingIvaRate } from './billing.schemas';

/**
 * Los codigos de ARCA (FEParamGetTipos*) de lo que arcli escribe con nombre: concepto, tipo de documento, condicion
 * IVA del receptor y alicuota. Una sola tabla por dato, en las dos direcciones: nombre -> codigo para armar la
 * solicitud y codigo -> nombre para mostrar lo que devuelve ARCA.
 */
interface ArcaCode {
  readonly code: number;
  readonly label: string;
}

const CONCEPTS: Readonly<Record<BillingConcept, ArcaCode>> = {
  productos: { code: 1, label: 'Productos' },
  servicios: { code: 2, label: 'Servicios' },
  'productos-servicios': { code: 3, label: 'Productos y servicios' },
};

const DOCUMENT_TYPES: Readonly<Record<BillingDocumentType, ArcaCode>> = {
  cuit: { code: 80, label: 'CUIT' },
  cuil: { code: 86, label: 'CUIL' },
  dni: { code: 96, label: 'DNI' },
  'consumidor-final': { code: 99, label: 'Consumidor final' },
};

const IVA_CONDITIONS: Readonly<Record<BillingIvaCondition, ArcaCode>> = {
  'responsable-inscripto': { code: 1, label: 'Responsable inscripto' },
  'sujeto-exento': { code: 4, label: 'Sujeto exento' },
  'consumidor-final': { code: 5, label: 'Consumidor final' },
  'responsable-monotributo': { code: 6, label: 'Responsable monotributo' },
  'sujeto-no-categorizado': { code: 7, label: 'Sujeto no categorizado' },
  'proveedor-del-exterior': { code: 8, label: 'Proveedor del exterior' },
  'cliente-del-exterior': { code: 9, label: 'Cliente del exterior' },
  'iva-liberado': { code: 10, label: 'IVA liberado' },
  'monotributista-social': { code: 13, label: 'Monotributista social' },
  'iva-no-alcanzado': { code: 15, label: 'IVA no alcanzado' },
  'monotributo-trabajador-independiente-promovido': {
    code: 16,
    label: 'Monotributo trabajador independiente promovido',
  },
};

/** Ids de FEParamGetTiposIva y la tasa como texto, para calcular con Big sin errores de punto flotante. */
const IVA_RATES: Readonly<Record<BillingIvaRate, { readonly id: number; readonly rate: string }>> = {
  '0': { id: 3, rate: '0' },
  '2.5': { id: 9, rate: '0.025' },
  '5': { id: 8, rate: '0.05' },
  '10.5': { id: 4, rate: '0.105' },
  '21': { id: 5, rate: '0.21' },
  '27': { id: 6, rate: '0.27' },
};

/** `DocTipo` de consumidor final: va con `DocNro` 0 si no se identifica. */
export const CONSUMER_DOCUMENT_TYPE_CODE = DOCUMENT_TYPES['consumidor-final'].code;
/** `CondicionIVAReceptorId` de consumidor final. */
export const CONSUMER_IVA_CONDITION_CODE = IVA_CONDITIONS['consumidor-final'].code;

function findByCode<K extends string>(table: Readonly<Record<K, ArcaCode>>, code: number | undefined): K | undefined {
  return (Object.keys(table) as K[]).find((key) => table[key].code === code);
}

/** La etiqueta del codigo; uno que no esta en la tabla sale tal cual y sin valor, "N/D". */
function labelOf<K extends string>(table: Readonly<Record<K, ArcaCode>>, code: number | undefined): string {
  const key = findByCode(table, code);

  if (key) {
    return table[key].label;
  }

  return code ? String(code) : 'N/D';
}

export function conceptCode(concept: BillingConcept): number {
  return CONCEPTS[concept].code;
}

export function conceptLabel(code: number | undefined): string {
  return labelOf(CONCEPTS, code);
}

export function documentTypeCode(documentType: BillingDocumentType): number {
  return DOCUMENT_TYPES[documentType].code;
}

export function documentTypeFromCode(code: number): BillingDocumentType | undefined {
  return findByCode(DOCUMENT_TYPES, code);
}

export function documentTypeLabel(code: number | undefined): string {
  return labelOf(DOCUMENT_TYPES, code);
}

/** CUIT y CUIL se muestran con guiones; DNI no. */
export function isTaxIdDocumentType(code: number | undefined): boolean {
  return code === DOCUMENT_TYPES.cuit.code || code === DOCUMENT_TYPES.cuil.code;
}

export function ivaConditionCode(ivaCondition: BillingIvaCondition): number {
  return IVA_CONDITIONS[ivaCondition].code;
}

export function ivaConditionLabel(code: number | undefined): string {
  return labelOf(IVA_CONDITIONS, code);
}

/** "responsable-inscripto" -> "Responsable Inscripto", como lo escribe el PDF. */
export function formatIvaConditionName(value: string): string {
  return value
    .split('-')
    .map((word) => (word === 'iva' ? 'IVA' : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join(' ');
}

export function ivaRateId(rate: BillingIvaRate): number {
  return IVA_RATES[rate].id;
}

/** La tasa como texto ("0.105"), para Big. */
export function ivaRateFactor(rate: BillingIvaRate): string {
  return IVA_RATES[rate].rate;
}

export function ivaRateFromId(id: number): BillingIvaRate | undefined {
  return (Object.keys(IVA_RATES) as BillingIvaRate[]).find((rate) => IVA_RATES[rate].id === id);
}

export const BILLING_IVA_RATES = Object.keys(IVA_RATES) as readonly BillingIvaRate[];
