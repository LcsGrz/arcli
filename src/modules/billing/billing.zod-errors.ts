import { type output, type ZodError, ZodRealError, type ZodType } from 'zod';

import type { InputIssue } from '../../lib/errors/input-issue';

import {
  BILLING_JSON_KEY_BY_INTERNAL_KEY,
  BILLING_JSON_NESTED_KEY_BY_INTERNAL_KEY,
  describeExpected,
} from './billing.json-input';
import { INVALID_POINT_OF_SALE_MESSAGE } from './billing.schemas';

const ZOD_PATH_LABELS: Record<string, string> = {
  associatedPeriod: 'período asociado',
  associatedVoucher: 'comprobante asociado',
  billingDate: 'fecha del comprobante',
  cancellation: 'anulación',
  cbu: 'CBU',
  cbuAlias: 'alias del CBU',
  concept: 'concepto',
  currencyCode: 'moneda',
  documentNumber: 'número de documento',
  documentType: 'tipo de documento',
  dueDay: 'día de vencimiento',
  exchangeRate: 'cotización',
  exemptAmount: 'importe exento',
  ivaRate: 'alícuota de IVA',
  ivaCondition: 'IVA receptor',
  paymentDueDate: 'vencimiento de pago',
  pdfDescription: 'descripción',
  pointOfSale: 'punto de venta',
  receiverAddress: 'domicilio del receptor',
  receiverName: 'nombre del receptor',
  saleCondition: 'condición de venta',
  sameCurrency: 'misma moneda',
  serviceEndDate: 'servicio hasta',
  serviceStartDate: 'servicio desde',
  totalAmount: 'monto',
  transferMode: 'modalidad de transferencia',
  untaxedAmount: 'importe no gravado',
};

function formatZodIssuePath(path: PropertyKey[]): string {
  return path.map((segment) => String(segment)).join('.');
}

/** La clave como la escribe quien carga el JSON, tambien adentro de otra: `alicuotas.0.monto`. Solo para el texto. */
function formatPublicKey(path: PropertyKey[]): string {
  const [head, ...rest] = path.map((segment) => String(segment));
  const nested = head === undefined ? undefined : BILLING_JSON_NESTED_KEY_BY_INTERNAL_KEY[head];

  return [
    head === undefined ? undefined : (BILLING_JSON_KEY_BY_INTERNAL_KEY[head] ?? head),
    ...rest.map((segment) => nested?.[segment] ?? segment),
  ].join('.');
}

type ZodInputIssue = ZodError['issues'][number] & { readonly received?: string };

/**
 * Valida una entrada y, si no pasa, lanza un `ZodError` en el que cada problema dice de que tipo era lo que llego
 * (`received`), o nada si faltaba: zod no lo dice, y sin eso un tipo equivocado se lee como un dato que falta. El
 * valor no queda en el error (puede ser un CBU o una ruta), y tampoco en su `message`, que es el JSON de los problemas.
 */
export function parseZodInput<T extends ZodType>(schema: T, value: unknown): output<T> {
  const result = schema.safeParse(value, { reportInput: true });

  if (result.success) {
    return result.data;
  }

  // `ZodRealError`, como `parse`: es un `Error`. zod lo crea sin stack y lo captura al lanzarlo.
  const error = new ZodRealError(
    result.error.issues.map(({ input, ...issue }) =>
      input === undefined ? issue : { ...issue, received: typeof input },
    ) as ZodError['issues'],
  );

  Error.captureStackTrace(error, parseZodInput);

  throw error;
}

/** De que habla el mensaje: la etiqueta, la clave como se escribe, o "El valor" si el problema no trae ruta. */
function describeSubject(issue: ZodInputIssue): string {
  if (issue.path.length === 0) {
    return 'El valor';
  }

  const label = ZOD_PATH_LABELS[formatZodIssuePath(issue.path)];

  return label ? `${label[0]?.toUpperCase() ?? ''}${label.slice(1)}` : `\`${formatPublicKey(issue.path)}\``;
}

const SIZE_UNITS: Readonly<Record<string, readonly [one: string, many: string]>> = {
  array: ['elemento', 'elementos'],
  string: ['carácter', 'caracteres'],
};

type ZodSizeIssue = Extract<ZodInputIssue, { code: 'too_big' | 'too_small' }>;

/** El limite que no se cumple: el largo de un texto o de una lista, o el valor de un numero. */
function describeLimit(issue: ZodSizeIssue, limit: number): string {
  const unit = SIZE_UNITS[issue.origin];
  const minimum = issue.code === 'too_small';

  if (unit) {
    const bound = issue.exact ? '' : minimum ? 'al menos ' : 'hasta ';

    return `tiene que tener ${bound}${limit} ${limit === 1 ? unit[0] : unit[1]}.`;
  }

  if (issue.inclusive) {
    return `debe ser ${limit} o ${minimum ? 'más' : 'menos'}.`;
  }

  return `debe ser ${minimum ? 'mayor' : 'menor'} a ${limit}.`;
}

function humanizeZodIssue(issue: ZodInputIssue, label: string): string {
  if (issue.code === 'invalid_type') {
    return issue.received === undefined
      ? `Falta el dato: ${label}.`
      : `${describeSubject(issue)} tiene que ser ${describeExpected(issue.expected)}.`;
  }

  if (issue.code === 'too_small' && typeof issue.minimum === 'number') {
    switch (formatZodIssuePath(issue.path)) {
      case 'pointOfSale':
        return INVALID_POINT_OF_SALE_MESSAGE;
      case 'totalAmount':
        return 'El monto debe ser mayor a 0.';
      default:
        return `${describeSubject(issue)} ${describeLimit(issue, issue.minimum)}`;
    }
  }

  // El maximo de un numero trae su mensaje en el esquema (por ejemplo, con el error de ARCA).
  if (issue.code === 'too_big' && typeof issue.maximum === 'number' && issue.origin !== 'number') {
    return `${describeSubject(issue)} ${describeLimit(issue, issue.maximum)}`;
  }

  if (issue.code === 'invalid_value') {
    const allowedValues = issue.values.map((value) => String(value)).join(', ');
    const problem = issue.path.length === 0 ? 'no está entre los soportados' : 'tiene un valor no soportado';

    return `${describeSubject(issue)} ${problem}. Valores válidos: ${allowedValues}.`;
  }

  return issue.message;
}

function formatPublicIssuePath(path: PropertyKey[]): string[] {
  // La clave del JSON sale del esquema de `--cargar`, la misma que se documenta.
  const publicKey = BILLING_JSON_KEY_BY_INTERNAL_KEY[formatZodIssuePath(path)];

  return publicKey ? [publicKey] : path.map((segment) => String(segment));
}

export function describeZodIssues(error: ZodError): InputIssue[] {
  return error.issues.map((issue) => {
    const pathKey = formatZodIssuePath(issue.path);
    const label = ZOD_PATH_LABELS[pathKey] ?? (formatPublicKey(issue.path) || 'Valor');

    return { label, mensaje: humanizeZodIssue(issue, label), ruta: formatPublicIssuePath(issue.path) };
  });
}

/** Resumen de una linea, para listar errores por item (por ejemplo, en un lote). */
export function summarizeZodError(error: ZodError): string {
  return describeZodIssues(error)
    .map((issue) => issue.mensaje)
    .join(' ');
}
