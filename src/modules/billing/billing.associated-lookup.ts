import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { formatArgentineAmountInput } from '../../lib/numbers/argentine-amount';
import type { ResolvedArcaRuntime } from '../../services/arca/arca-context.resolver';
import { FCE_REGISTRY_STATE_LABELS, type FceRegistryGateway, type FceRegistryState } from '../fce/fce-registry';
import type { ParametersGateway } from '../parameters/parameters';
import type { IssuedVoucher, VoucherHistoryGateway } from '../vouchers/voucher-history';
import { formatVoucherNumber } from '../vouchers/voucher-history.presenter';

import { ARCA_LOCAL_CURRENCY_CODE } from './billing.currency';
import { formatMoneyLabel } from './billing.labels';
import { formatVoucherSubject, formatVoucherWithArticle } from './billing.mappers';
import type { BillingCommandInput } from './billing.schemas';
import type { BillingService } from './billing.service';
import type { VoucherKindDefinition } from './billing.types';
import { getVoucherKindByArcaType, getVoucherKindByShortcut } from './voucher-kind-map';

const CREDIT_NOTE_FAMILIES: ReadonlySet<VoucherKindDefinition['family']> = new Set([
  'nota-credito',
  'nota-credito-electronica',
]);

/** `la factura A 00003-00000012`, para usar dentro de una frase. */
export function describeAssociated(arcaType: number, pointOfSale: number, number: number): string {
  const kind = getVoucherKindByArcaType(arcaType);
  const name = kind ? formatVoucherWithArticle(kind) : `el comprobante tipo ${arcaType}`;

  return `${name} ${formatVoucherNumber(pointOfSale, number)}`;
}

/** El total del asociado para una frase: `la factura C 00003-00000045, de $ 120.000`. */
function describeTotal(associatedLabel: string, total: number, currency: string | undefined): string {
  return `${associatedLabel}, de ${formatMoneyLabel(total, currency)}`;
}

/**
 * El error de una NC que supera a su asociado, igual en A, B, C, FCE y E, con la sugerencia de anularlo entero.
 * `associatedLabel` es el asociado con articulo, letra y numero: `la factura C 00003-00000045`.
 */
export function creditNoteOverTotalError(options: {
  readonly associatedCurrency?: string;
  readonly associatedLabel: string;
  readonly associatedTotal: number;
  readonly noteCurrency: string;
  readonly noteTotal: number;
}): InputValidationError {
  const { associatedCurrency, associatedLabel, associatedTotal, noteCurrency, noteTotal } = options;

  return new InputValidationError(
    `La nota de crédito por ${formatMoneyLabel(noteTotal, noteCurrency)} no puede superar el total de ${describeTotal(associatedLabel, associatedTotal, associatedCurrency ?? noteCurrency)}.`,
    undefined,
    `Para anularla entera usá \`--monto ${formatArgentineAmountInput(associatedTotal)}\`.`,
  );
}

/** El mismo aviso en el paso del monto del asistente: `No puede superar el total de la factura C 00003-00000045, de $ 120.000.` */
export function creditNoteOverTotalHint(associatedLabel: string, total: number, currency?: string): string {
  return `No puede superar el total de ${describeTotal(associatedLabel, total, currency)}.`;
}

/**
 * Propia: ARCA solo observa una NC que supera al asociado (10237, WSFEv1 v4.7) y la aprueba igual; en WSFEX no hay
 * control. El tope de la NC, con el mismo criterio que las notas E: solo si van en la misma moneda, porque en otra moneda los
 * totales no se comparan.
 */
export function assertCreditNoteWithinAssociated(options: {
  readonly associated: Pick<IssuedVoucher, 'currency' | 'total'>;
  readonly associatedLabel: string;
  readonly note: { readonly currencyCode: string; readonly total: number };
}): void {
  const { associated, associatedLabel, note } = options;
  const associatedCurrency = associated.currency?.trim().toUpperCase();

  if (associatedCurrency && associatedCurrency !== note.currencyCode.trim().toUpperCase()) {
    return;
  }

  if (note.total > associated.total) {
    throw creditNoteOverTotalError({
      associatedCurrency: associated.currency,
      associatedLabel,
      associatedTotal: associated.total,
      noteCurrency: note.currencyCode,
      noteTotal: note.total,
    });
  }
}

/**
 * Lo que una nota FCE tiene que compartir con su asociado, segun el manual (WSFEv1 v4.7, sin probar en testing: hace
 * falta un escenario FCE con otro receptor o moneda):
 * - la moneda, o pesos para ajustar una diferencia de cambio (10181);
 * - emisor y receptor (10183; el emisor ya lo controla la 10155 en `resolveAssociatedVouchers`);
 * - la fecha del asociado, si se paso `--afecha` (10160: "con la misma fecha informada en el asociado").
 */
export function assertFceNoteMatchesAssociated(options: {
  readonly associated: Pick<IssuedVoucher, 'currency' | 'date' | 'documentNumber'>;
  readonly associatedLabel: string;
  readonly note: { readonly currencyCode: string; readonly date?: string; readonly documentNumber: number };
  readonly voucherKind: VoucherKindDefinition;
}): void {
  const { associated, associatedLabel, note, voucherKind } = options;
  const subject = formatVoucherWithArticle(voucherKind);
  const associatedCurrency = associated.currency?.trim().toUpperCase();
  const noteCurrency = note.currencyCode.trim().toUpperCase();

  if (associatedCurrency && noteCurrency !== associatedCurrency && noteCurrency !== ARCA_LOCAL_CURRENCY_CODE) {
    throw new InputValidationError(
      `${formatVoucherSubject(voucherKind)} va en la moneda de ${associatedLabel} (${associatedCurrency}) o en pesos, no en ${noteCurrency}: ARCA la rechaza (error 10181).`,
      undefined,
      `Usá \`--moneda ${associatedCurrency}\`, o pesos si ajusta una diferencia de cambio.`,
    );
  }

  if (associated.documentNumber !== note.documentNumber) {
    throw new InputValidationError(
      `${formatVoucherSubject(voucherKind)} tiene que ir al mismo receptor que ${associatedLabel} (${associated.documentNumber}), no a ${note.documentNumber}: ARCA la rechaza (error 10183).`,
      undefined,
      `Usá \`--cuit ${associated.documentNumber}\`.`,
    );
  }

  if (note.date && note.date !== associated.date) {
    throw new InputValidationError(
      `La fecha del asociado (${formatArcaDateAsArgentineDate(note.date)}) no es la de ${associatedLabel} en ARCA (${formatArcaDateAsArgentineDate(associated.date)}): en ${subject} ARCA la rechaza (error 10160).`,
      undefined,
      `Usá \`--afecha ${formatArcaDateAsArgentineDate(associated.date)}\`, o sacala y ARCLI la toma de ARCA.`,
    );
  }
}

/** Si el total del asociado es tope de la nota: solo en una NC y, como en la E, no si ajusta otra NC. */
function capsCreditNote(voucherKind: VoucherKindDefinition, associatedArcaType: number | undefined): boolean {
  const associatedFamily =
    associatedArcaType === undefined ? undefined : getVoucherKindByArcaType(associatedArcaType)?.family;

  return (
    CREDIT_NOTE_FAMILIES.has(voucherKind.family) &&
    (associatedFamily === undefined || !CREDIT_NOTE_FAMILIES.has(associatedFamily))
  );
}

/**
 * Si hay que consultar el asociado en ARCA antes de emitir la nota: que exista, el tope de una NC y la fecha de una
 * nota FCE sin `--afecha`. Solo se consultan comprobantes propios; el de otro CUIT no se puede leer.
 */
function shouldLookUpAssociated(
  input: BillingCommandInput,
  voucherKind: VoucherKindDefinition,
  emitterCuit: number,
): boolean {
  const associated = input.associatedVoucher;

  if (!voucherKind.requiresAssociatedVoucher || !associated?.numero || !associated.puntoVenta) {
    return false;
  }

  if (associated.cuit !== undefined && associated.cuit.replace(/\D/g, '') !== String(emitterCuit)) {
    return false;
  }

  return true;
}

/**
 * Mas estricta que ARCA: en A, B y C un asociado que no existe es una observacion (10041, WSFEv1 v4.7), en FCE un
 * rechazo (10160). El asociado propio no existe en ARCA. Mismo error que en las notas E: ARCA testing llega a aprobar una nota A, B
 * o C asociada a un comprobante que no existe.
 */
export function missingAssociatedVoucherError(associatedLabel: string, reason?: string): InputValidationError {
  return new InputValidationError(
    `ARCA no tiene ${associatedLabel}${reason ? `, así que ${reason}` : ''}.`,
    undefined,
    'Revisá `--ar`, `--apv` y `--ac`: el asociado tiene que ser un comprobante tuyo ya emitido.',
  );
}

/**
 * De donde es el punto de venta de un asociado que ARCA no tiene:
 * - `web-service`: uno de los puntos de venta de web service del emisor. Ahi el comprobante tendria que estar, asi
 *   que casi seguro es un numero mal escrito.
 * - `other`: no es de web service (Comprobantes en linea, controlador fiscal, otro sistema). `FECompConsultar` no
 *   ve esos comprobantes y ARCA los acepta como asociados (10041 solo controla los de un punto de venta electronico;
 *   10211 y 10212 prevén los de controlador fiscal o FactuWeb).
 * - `unknown`: ARCA no respondio y no se sabe.
 */
export type AssociatedPointOfSaleOrigin = 'other' | 'unknown' | 'web-service';

/**
 * Clasifica el punto de venta con `FEParamGetPtosVenta`, que lista solo los de web service (CAE y CAEA). En testing
 * esa lista viene vacia ("Sin Resultados", 602), asi que si no hay lista se mira si ARCA tiene comprobantes de ese
 * tipo en ese punto de venta (`FECompUltimoAutorizado`): si tiene, es de web service.
 */
export async function classifyAssociatedPointOfSale(options: {
  readonly history: Pick<VoucherHistoryGateway, 'getLastNumber'>;
  readonly pointOfSale: number;
  readonly salesPoints?: Pick<ParametersGateway, 'getSalesPoints'>;
  readonly voucherType: number;
}): Promise<AssociatedPointOfSaleOrigin> {
  const { history, pointOfSale, salesPoints, voucherType } = options;
  let listed: readonly number[] | undefined;

  try {
    listed = salesPoints ? (await salesPoints.getSalesPoints()).map((point) => point.number) : undefined;
  } catch {
    listed = undefined;
  }

  if (listed && listed.length > 0) {
    return listed.includes(pointOfSale) ? 'web-service' : 'other';
  }

  try {
    if ((await history.getLastNumber(pointOfSale, voucherType)) > 0) {
      return 'web-service';
    }
  } catch {
    return 'unknown';
  }

  return listed ? 'other' : 'unknown';
}

/**
 * El aviso de un asociado que ARCA no tiene en un punto de venta que no es de web service (o que no se pudo
 * clasificar): la nota sigue, sin controlar su tope, y si falta la fecha se recuerda la 10211. Lo usan los flags y el
 * modo interactivo.
 */
export function missingAssociatedWarning(options: {
  readonly hasDate: boolean;
  readonly isCreditNote: boolean;
  readonly label: string;
  readonly origin: Exclude<AssociatedPointOfSaleOrigin, 'web-service'>;
  readonly pointOfSale: number;
}): string {
  const { hasDate, isCreditNote, label, origin, pointOfSale } = options;
  const where =
    origin === 'other'
      ? `el punto de venta ${pointOfSale} no es de web service`
      : `no se pudo consultar si el punto de venta ${pointOfSale} es de web service`;

  return [
    `No se encontró ${label} en ARCA y ${where}: si es de Comprobantes en línea, de un controlador fiscal o de otro sistema, está bien; si no, revisá \`--ar\`, \`--apv\` y \`--ac\`.`,
    ...(isCreditNote ? ['No se pudo controlar que la nota de crédito no lo supere.'] : []),
    ...(hasDate
      ? []
      : ['Si es de un controlador fiscal o de FactuWeb, ARCA pide su fecha (error 10211): pasala con `--afecha`.']),
  ].join(' ');
}

export interface CheckedAssociated {
  readonly input: BillingCommandInput;
  /** Si ARCA no respondio y la nota igual se puede emitir: el asociado y el tope de la NC quedan sin controlar. */
  readonly warnings: readonly string[];
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : 'error desconocido';
}

/**
 * Lo que se controla contra el asociado propio de una nota A, B, C o FCE, con una sola consulta a ARCA antes de la
 * vista previa: que exista, que una NC no supere su total y, en una nota FCE sin `--afecha`, su fecha. Devuelve la
 * entrada con esa fecha, asi la vista previa la muestra y la emision no vuelve a consultar.
 *
 * Si ARCA no tiene el asociado y su punto de venta es de web service del emisor, frena como en las notas E: es casi
 * seguro un numero mal escrito. Si el punto de venta no es de web service (Comprobantes en linea, controlador
 * fiscal), sigue con un aviso; la nota FCE sin fecha frena pidiendo `--afecha`. Si ARCA no responde, la nota FCE sin
 * fecha no se puede armar y frena; el resto sigue con un aviso y ARCA decide al emitir.
 */
export async function checkAssociatedInArca(options: {
  readonly gateway: Pick<VoucherHistoryGateway, 'getLastNumber' | 'getVoucher'>;
  readonly input: BillingCommandInput;
  readonly runtime: ResolvedArcaRuntime;
  readonly salesPoints?: Pick<ParametersGateway, 'getSalesPoints'>;
  readonly service: Pick<BillingService, 'buildVoucherPayload'>;
}): Promise<CheckedAssociated> {
  const { gateway, input, runtime, salesPoints, service } = options;
  const voucherKind = getVoucherKindByShortcut(input.shortcut);
  const associated = input.associatedVoucher;
  const unchanged: CheckedAssociated = { input, warnings: [] };

  if (!voucherKind || !associated || !shouldLookUpAssociated(input, voucherKind, runtime.context.cuit)) {
    return unchanged;
  }

  // Valida la entrada antes de consultar: si la nota no se puede armar, no hace falta ir a ARCA.
  const payload = service.buildVoucherPayload(input, runtime, voucherKind);
  const reference = payload.CbtesAsoc?.[0];

  if (!reference) {
    return unchanged;
  }

  const label = describeAssociated(reference.Tipo, reference.PtoVta, reference.Nro);
  const needsDate = voucherKind.isElectronicCredit && !associated.fecha;
  let voucher: IssuedVoucher | undefined;

  try {
    voucher = await gateway.getVoucher(reference.Nro, reference.PtoVta, reference.Tipo);
  } catch (error) {
    if (needsDate) {
      throw new InputValidationError(
        `No se pudo consultar en ARCA ${label} para tomar su fecha: ${reasonOf(error)}`,
        undefined,
        'Probá de nuevo en un rato o pasá la fecha del asociado con `--afecha <fecha>`.',
      );
    }

    const unchecked = CREDIT_NOTE_FAMILIES.has(voucherKind.family)
      ? `que la nota de crédito no supere ${label}`
      : `que exista ${label}`;

    return { input, warnings: [`No se pudo verificar en ARCA ${unchecked}: ${reasonOf(error)}`] };
  }

  if (!voucher) {
    const origin = await classifyAssociatedPointOfSale({
      history: gateway,
      pointOfSale: reference.PtoVta,
      salesPoints,
      voucherType: reference.Tipo,
    });

    if (origin === 'web-service') {
      throw missingAssociatedVoucherError(label, needsDate ? 'no se puede tomar su fecha' : undefined);
    }

    if (needsDate) {
      throw new InputValidationError(
        `No se encontró ${label} en ARCA, así que no se puede tomar su fecha.`,
        undefined,
        'Si es de Comprobantes en línea o de un controlador fiscal, pasá su fecha con `--afecha <fecha>`. Si no, revisá `--ar`, `--apv` y `--ac`.',
      );
    }

    return {
      input,
      warnings: [
        missingAssociatedWarning({
          hasDate: Boolean(associated.fecha),
          isCreditNote: CREDIT_NOTE_FAMILIES.has(voucherKind.family),
          label,
          origin,
          pointOfSale: reference.PtoVta,
        }),
      ],
    };
  }

  if (voucherKind.isElectronicCredit) {
    assertFceNoteMatchesAssociated({
      associated: voucher,
      associatedLabel: label,
      note: { currencyCode: payload.MonId, date: reference.CbteFch, documentNumber: payload.DocNro ?? 0 },
      voucherKind,
    });
  }

  if (capsCreditNote(voucherKind, reference.Tipo)) {
    assertCreditNoteWithinAssociated({
      associated: voucher,
      associatedLabel: label,
      note: { currencyCode: payload.MonId, total: payload.ImpTotal },
    });
  }

  if (!needsDate) {
    return unchanged;
  }

  return {
    input: { ...input, associatedVoucher: { ...associated, fecha: formatArcaDateAsArgentineDate(voucher.date) } },
    warnings: [],
  };
}

/**
 * Una nota FCE de anulacion necesita que el comprador haya rechazado antes el asociado en el Registro de FCE; si no,
 * ARCA la rechaza con 10154. Se consulta el estado en wsfecred y se avisa, sin frenar: el Registro puede cambiar
 * entre la vista previa y la emision, y un rechazo de ARCA no emite nada. Solo comprobantes propios.
 *
 * Va despues de `checkAssociatedInArca`, con la entrada que ya tiene la fecha del asociado.
 */
export async function checkFceCancellationInRegistry(options: {
  readonly gateway: Pick<FceRegistryGateway, 'getVoucherState'>;
  readonly input: BillingCommandInput;
  readonly runtime: ResolvedArcaRuntime;
  readonly service: Pick<BillingService, 'buildVoucherPayload'>;
}): Promise<string[]> {
  const { gateway, input, runtime, service } = options;
  const voucherKind = getVoucherKindByShortcut(input.shortcut);
  const associated = input.associatedVoucher;
  const emitterCuit = runtime.context.cuit;

  if (
    !voucherKind?.isElectronicCredit ||
    !voucherKind.requiresAssociatedVoucher ||
    !input.cancellation ||
    !associated?.numero ||
    !associated.puntoVenta ||
    (associated.cuit !== undefined && associated.cuit.replace(/\D/g, '') !== String(emitterCuit))
  ) {
    return [];
  }

  const reference = service.buildVoucherPayload(input, runtime, voucherKind).CbtesAsoc?.[0];

  if (!reference) {
    return [];
  }

  const label = describeAssociated(reference.Tipo, reference.PtoVta, reference.Nro);
  let state: FceRegistryState | undefined;

  try {
    state = await gateway.getVoucherState({
      arcaType: reference.Tipo,
      cuit: emitterCuit,
      number: reference.Nro,
      pointOfSale: reference.PtoVta,
    });
  } catch (error) {
    return [
      `No se pudo consultar en el Registro de FCE si el comprador rechazó ${label}: ${reasonOf(error).replace(/\.$/, '')}. Si no lo rechazó, ARCA rechaza la nota de anulación con el error 10154.`,
    ];
  }

  // Sin estado, el Registro no lo tiene: que exista lo controla ARCA al emitir.
  if (state === undefined || state === 'Rechazado') {
    return [];
  }

  const overInvoice = getVoucherKindByArcaType(reference.Tipo)?.family === 'factura-credito-electronica';
  const todo = overInvoice
    ? 'Pedile al comprador que lo rechace o, si no es una anulación, emitila sin `--anulacion`.'
    : 'Pedile al comprador que lo rechace antes de emitir.';

  return [
    `El comprador no rechazó ${label} en el Registro de FCE (estado: ${FCE_REGISTRY_STATE_LABELS[state]}) y la nota de anulación lo necesita: ARCA la rechaza con el error 10154. ${todo}`,
  ];
}
