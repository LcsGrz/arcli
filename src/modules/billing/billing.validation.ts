import { formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { parseCuit } from '../../lib/identity/cuit';
import { assertRules } from '../../lib/rules/rules';

import { formatDocumentFlag, formatVoucherSubject, formatVoucherWithArticle } from './billing.mappers';
import { RECEIVER_NOT_EMITTER_RULE } from './billing.rules';
import type { BillingCommandInput } from './billing.schemas';
import type { VoucherKindDefinition } from './billing.types';
import { getVoucherKindByFamilyAndLetter } from './voucher-kind-map';

export function validateConceptDateInputs(input: BillingCommandInput, voucherKind: VoucherKindDefinition): void {
  const hasAnyServiceDate = Boolean(input.serviceStartDate || input.serviceEndDate);
  const hasPartialServiceDate = Boolean(input.serviceStartDate) !== Boolean(input.serviceEndDate);

  if (input.paymentDueDate && input.dueDay) {
    throw new InputValidationError(
      '`--dia` y `--vencimiento` son el mismo vencimiento: dejá solo `--vencimiento` o `--vto`.',
    );
  }

  if (input.paymentDueDate || input.dueDay) {
    const flag = input.dueDay ? '`--dia`' : '`--vencimiento`';

    if (voucherKind.isElectronicCredit && voucherKind.family !== 'factura-credito-electronica') {
      throw new InputValidationError(
        `${formatVoucherSubject(voucherKind)} no lleva vencimiento de pago. Sacá ${flag}.`,
      );
    }

    if (!voucherKind.isElectronicCredit && input.concept === 'productos') {
      throw new InputValidationError(`El concepto "productos" no usa ${flag}.`);
    }
  }

  // Productos sin fechas de servicio ni vencimiento: ARCA 10049 (WSFEv1 v4.7; el texto solo las pide en servicios, pero
  // ARCA testing las rechaza en productos con ese codigo). En NC/ND FCE el vencimiento es la 10175, que lo prohibe
  // salvo en las de anulacion, donde es opcional: que tambien se frene ahi es propio.
  if (input.concept === 'productos') {
    if (hasAnyServiceDate) {
      throw new InputValidationError(
        'El concepto "productos" no usa fechas de servicio. Sacá `--servicio-desde` y `--servicio-hasta`.',
      );
    }

    return;
  }

  // ARCA 10031 y 10033 (WSFEv1 v4.7).
  if (hasPartialServiceDate) {
    throw new InputValidationError(
      'Si informás fechas de servicio, tenés que enviar ambas: `--servicio-desde` y `--servicio-hasta`.',
    );
  }
}

/** Que documento de receptor se puede usar: `ra --cuil` y `fceb --dni` se frenan con la misma regla. */
const DOCUMENT_LABELS: Record<BillingCommandInput['documentType'], string> = {
  'consumidor-final': 'consumidor final',
  cuil: 'CUIL',
  cuit: 'CUIT',
  dni: 'DNI',
};

/** La nota o factura comun de la misma letra que una FCE: `fceb` → `fb`. */
function commonVoucherFor(voucherKind: VoucherKindDefinition): VoucherKindDefinition | undefined {
  const family = COMMON_FAMILY_OF_FCE[voucherKind.family];

  return (family && getVoucherKindByFamilyAndLetter(family, voucherKind.letter)) || undefined;
}

const COMMON_FAMILY_OF_FCE: Partial<Record<VoucherKindDefinition['family'], VoucherKindDefinition['family']>> = {
  'factura-credito-electronica': 'factura',
  'nota-credito-electronica': 'nota-credito',
  'nota-debito-electronica': 'nota-debito',
};

/**
 * Lo que la letra o la FCE exigen del documento del receptor (WSFEv1 v4.7):
 * - clase A, solo CUIT (10013). Consumidor final en la A ya lo frena el IVA receptor (10243), con su sugerencia.
 * - FCE, solo CUIT (10015: "el documento del receptor debe ser 80 CUIT").
 */
function validateDocumentTypeForVoucher(input: BillingCommandInput, voucherKind: VoucherKindDefinition): void {
  if (input.documentType === 'cuit') {
    return;
  }

  const document = DOCUMENT_LABELS[input.documentType];

  if (voucherKind.isElectronicCredit) {
    const common = commonVoucherFor(voucherKind);

    throw new InputValidationError(
      `${formatVoucherSubject(voucherKind)} solo se emite a un CUIT: ARCA rechaza una FCE ${document === 'consumidor final' ? 'a consumidor final' : `con ${document}`} (error 10015).`,
      undefined,
      common
        ? `Identificá al receptor con \`--cuit\` o, si no tiene, emití ${formatVoucherWithArticle(common)} (\`${common.shortcut}\`).`
        : 'Identificá al receptor con `--cuit`.',
    );
  }

  if (voucherKind.letter === 'a' && input.documentType !== 'consumidor-final') {
    throw new InputValidationError(
      `${formatVoucherSubject(voucherKind)} solo se emite a un CUIT: ARCA rechaza un comprobante A con ${document} (error 10013).`,
      undefined,
      `Identificá al receptor con \`--cuit\` o, si no tiene CUIT, emití el comprobante B (\`${voucherKind.shortcut.replace(/a$/, 'b')}\`).`,
    );
  }
}

/**
 * B a un No Categorizado con importe gravado (ARCA 10067, WSFEv1 v4.7, excluyente): si `CbteTipo` es 6, 7 u 8, el
 * receptor es el CUIT 23000000000 y neto + IVA es mayor a 0, ARCA exige el tributo 13 (percepcion de IVA No
 * Categorizado, RG 2126/2006). ARCLI no informa tributos, asi que lo frena antes con la salida que tiene.
 */
const UNCATEGORIZED_CUIT = 23_000_000_000;
const UNCATEGORIZED_VOUCHER_TYPES: ReadonlySet<number> = new Set([6, 7, 8]);

export function validateUncategorizedReceiver(
  input: Pick<BillingCommandInput, 'documentNumber' | 'documentType'>,
  voucherKind: VoucherKindDefinition,
  taxedAmount: number,
): void {
  if (
    !UNCATEGORIZED_VOUCHER_TYPES.has(voucherKind.arcaType) ||
    input.documentType !== 'cuit' ||
    input.documentNumber !== UNCATEGORIZED_CUIT ||
    taxedAmount <= 0
  ) {
    return;
  }

  throw new InputValidationError(
    `${formatVoucherSubject(voucherKind)} a un No Categorizado (CUIT 23000000000) con importe gravado lleva la percepción de IVA No Categorizado (tributo 13), y ARCLI todavía no informa tributos: ARCA la rechaza sin ella (error 10067).`,
    undefined,
    'Si la operación es exenta o no gravada, pasá el total con `--exento` o `--nogravado`. Si no, identificá al receptor con su CUIT, DNI o CUIL, o emitila desde Comprobantes en línea.',
  );
}

export function validateDocumentIdentity(
  input: BillingCommandInput,
  voucherKind: VoucherKindDefinition,
  emitterCuit?: number,
): void {
  validateDocumentTypeForVoucher(input, voucherKind);

  // Consumidor final con documento 0 y numero obligatorio en el resto: ARCA 10015 (WSFEv1 v4.7). Que el IVA receptor
  // sea consumidor final es propio (ARCA testing acepta otro); el formato del CUIT y del DNI es propio.
  if (input.documentType === 'consumidor-final') {
    if (input.ivaCondition !== 'consumidor-final') {
      throw new InputValidationError(
        `${formatVoucherSubject(voucherKind)} usa consumidor final solo con \`--ir-cf\` o \`--iva-receptor consumidor-final\`.`,
      );
    }

    if (typeof input.documentNumber === 'number' && input.documentNumber !== 0) {
      throw new InputValidationError(
        `${formatVoucherSubject(voucherKind)} usa consumidor final solo con documento 0. Usá \`--consumidor-final\`.`,
      );
    }

    return;
  }

  if (typeof input.documentNumber !== 'number') {
    throw new InputValidationError(
      `${formatVoucherSubject(voucherKind)} requiere documento del receptor. Usá ${formatDocumentFlag(input.documentType)}.`,
    );
  }

  if (input.documentType === 'cuit' || input.documentType === 'cuil') {
    const result = parseCuit(input.documentNumber);

    if (!result.ok) {
      throw new InputValidationError(
        `\`${formatDocumentFlag(input.documentType)}\` ${input.documentNumber} no es válido en ${formatVoucherWithArticle(voucherKind)}: ${result.reason}.`,
      );
    }

    // ARCA 10069: la regla es la misma que usa el asistente al preguntar el CUIT.
    assertRules([RECEIVER_NOT_EMITTER_RULE], input, {
      emitterCuit,
      today: formatDateAsArcaDate(new Date()),
      voucherKind,
    });
  }

  // Propia: ARCA acepta cualquier DocNro de hasta 11 digitos (p. 28) y testing aprobo una B a DNI 543210. Desde 6
  // digitos entran las LE y LC viejas; menos es casi seguro un error de tipeo.
  if (input.documentType === 'dni' && !/^\d{6,8}$/.test(String(input.documentNumber))) {
    throw new InputValidationError(
      `\`--dni\` debe tener de 6 a 8 dígitos en ${formatVoucherWithArticle(voucherKind)}.`,
    );
  }
}
