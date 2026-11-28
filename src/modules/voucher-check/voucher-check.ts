import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { parseDateInputAsArcaDate } from '../../lib/dates/relative-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { parseDni } from '../../lib/identity/dni';
import {
  AMOUNT_DECIMALS,
  formatArgentineAmount,
  formatArgentineMoney,
  hasAtMostDecimals,
} from '../../lib/numbers/argentine-amount';
import { type ArcaQrValue, parseArcaQrUrl } from '../../lib/qr/arca-qr';
import { assertRules, findRuleFailure, type Rule } from '../../lib/rules/rules';
import { documentTypeCode, documentTypeLabel } from '../billing/arca-codes';
import type { VoucherKindDefinition } from '../billing/billing.types';
import { getVoucherKindByArcaType, getVoucherKindByShortcut, VOUCHER_SHORTCUTS } from '../billing/voucher-kind-map';
import { formatVoucherSubject } from '../billing/voucher-names';
import type { ArcliEnvironment } from '../config/config.schemas';
import { getExportVoucherKindByArcaType, getExportVoucherKindByShortcut } from '../export/export.kinds';

/*
 * `arcli constatar` (SDK-10): constatar en WSCDC un comprobante que emitió otro. Los límites salen del manual del
 * desarrollador de WSCDC v0.4 (01-12-2025), §2.2.2 (tabla CmpReq) y §2.2.4 (validaciones, con su código de error u
 * observación). Lo que el manual no dice no se valida acá: lo contesta ARCA.
 */

/** `PtoVta`: de 1 a 99998 (WSCDC v0.4 §2.2.4, error 3). */
const MAX_POINT_OF_SALE = 99_998;
/** `CbteNro`: de 1 a 99999999 (WSCDC v0.4 §2.2.4, error 5). */
const MAX_VOUCHER_NUMBER = 99_999_999;
/** `CbteTipo`: 3 dígitos (WSCDC v0.4 §2.2.2); la lista la da `ComprobantesTipoConsultar` (error 4). */
const MAX_VOUCHER_TYPE = 999;
/** `CodAutorizacion`: 14 caracteres numéricos (WSCDC v0.4 §2.2.4, error 10). */
const AUTHORIZATION_CODE = /^\d{14}$/;

/**
 * Desde cuánto el receptor de una B o una C común es obligatorio: si el importe lo supera (WSCDC v0.4 §2.2.4,
 * observaciones 115 y 116; el tope de la v0.3). Es "supera", no "desde": a diferencia de la RG 5700 al emitir
 * (`CONSUMER_IDENTIFICATION_THRESHOLD`, que es "o más"), el comprobante de $ 10.000.000 justos va sin receptor.
 */
const RECEIVER_REQUIRED_ABOVE = 10_000_000;

type AuthorizationMode = 'CAE' | 'CAEA';

export interface VoucherCheckReceiver {
  /** Solo dígitos, como texto: WSCDC lo recibe así (`DocNroReceptor`, string de 20). */
  readonly documentNumber: string;
  /** El código de ARCA: 80 CUIT, 86 CUIL, 96 DNI. */
  readonly documentType: number;
}

/** Lo que se manda a WSCDC, ya validado. */
export interface VoucherCheckRequest {
  readonly authorizationCode: string;
  /** La moneda del importe (`moneda` del QR, código de ARCA); `null` con los flags, que no la dicen. */
  readonly currency: string | null;
  /** `yyyymmdd`. */
  readonly date: string;
  readonly issuerCuit: string;
  readonly mode: AuthorizationMode;
  readonly number: number;
  readonly pointOfSale: number;
  readonly receiver: VoucherCheckReceiver | null;
  /** El atajo de ARCLI, si el tipo es uno que ARCLI emite. */
  readonly shortcut: string | null;
  readonly total: number;
  readonly voucherType: number;
}

export interface ArcaMessage {
  readonly code: number;
  readonly message: string;
}

/** Lo que contesta WSCDC cuando constató o rechazó: los errores de formato, autenticación o de ARCA ya cortaron. */
export interface VoucherCheckAnswer {
  /** Los de una respuesta `A`: con `R` cortan antes, como error. */
  readonly errors: readonly ArcaMessage[];
  readonly events: readonly ArcaMessage[];
  /**
   * El motivo de un no constatado (100 y 102 a 112: no existe o no coincide) o el aviso de un constatado (200, CAEA sin
   * rendir). Las de un dato de la consulta (101, 113 a 118) cortan antes, como error de entrada.
   */
  readonly observations: readonly ArcaMessage[];
  /** `FchProceso`, `yyyymmddhhmmss`; `null` si ARCA no lo manda. */
  readonly processedAt: string | null;
  /** `A`: constatado. `R`: no constatado. */
  readonly result: 'A' | 'R';
}

export interface VoucherCheckGateway {
  check(request: VoucherCheckRequest): Promise<VoucherCheckAnswer>;
}

export interface VoucherCheckReport {
  readonly answer: VoucherCheckAnswer;
  readonly environment: ArcliEnvironment;
  readonly request: VoucherCheckRequest;
}

/** Los flags y argumentos de `arcli constatar`, como llegan: los montos y CUIT ya los leyó cada flag. */
export interface VoucherCheckInput {
  readonly amount?: number;
  readonly cae?: string;
  readonly caea?: string;
  readonly cuil?: string;
  readonly cuit?: string;
  readonly date?: string;
  readonly dni?: string;
  readonly issuer?: string;
  readonly kind?: string;
  readonly qr?: string;
  readonly voucher?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Los datos de a uno, con textos sin nombres de flags: los usan los flags y, en el PR 2 de SDK-10, las preguntas del
// asistente. Lo que compara flags entre sí (los que faltan, `--cae` con `--caea`, dos documentos, `--qr` con datos) es
// solo de los flags y va al final.
// ---------------------------------------------------------------------------------------------------------------

/** Los atajos que se ofrecen. La E se acepta (`fe`, `19`) pero no se ofrece: ver `resolveType`. */
const TYPE_HINT = `Usá el atajo (${VOUCHER_SHORTCUTS.join(', ')}) o el código de ARCA (1, 6, 11, 49…).`;

interface ResolvedType {
  readonly kind: VoucherKindDefinition | null;
  readonly shortcut: string | null;
  readonly voucherType: number;
}

function fromArcaType(voucherType: number): ResolvedType {
  const kind = getVoucherKindByArcaType(voucherType);

  return {
    kind,
    shortcut: kind?.shortcut ?? getExportVoucherKindByArcaType(voucherType)?.shortcut ?? null,
    voucherType,
  };
}

/**
 * El atajo (`fa`, `FA`) o el código de ARCA (`1`, `51`): se constatan también los que ARCLI no emite. La E (`fe`,
 * `19`) se acepta, pero en homologación WSCDC no la encuentra (R 100) y en producción no está verificado.
 */
function resolveType(raw: string): ResolvedType {
  const value = raw.trim().toLowerCase();

  if (/^\d{1,3}$/.test(value) && Number(value) >= 1 && Number(value) <= MAX_VOUCHER_TYPE) {
    return fromArcaType(Number(value));
  }

  const arcaType = getVoucherKindByShortcut(value)?.arcaType ?? getExportVoucherKindByShortcut(value)?.arcaType;

  if (arcaType === undefined) {
    throw new InputValidationError(`El tipo de comprobante "${raw}" no es válido. ${TYPE_HINT}`);
  }

  return fromArcaType(arcaType);
}

/** `PV-NÚMERO`, con o sin ceros: `3-1234` o `00003-00001234`. */
function parseVoucher(raw: string): { readonly number: number; readonly pointOfSale: number } {
  const match = /^(\d{1,5})-(\d{1,8})$/.exec(raw.trim());

  if (!match) {
    throw new InputValidationError(
      `El comprobante "${raw}" no es válido: escribí el punto de venta y el número separados por un guion, como 3-1234 o 00003-00001234.`,
    );
  }

  const pointOfSale = Number(match[1]);
  const number = Number(match[2]);

  if (pointOfSale < 1 || pointOfSale > MAX_POINT_OF_SALE) {
    throw new InputValidationError(
      `El comprobante "${raw}" no es válido: el punto de venta va de 1 a ${MAX_POINT_OF_SALE}.`,
    );
  }

  if (number < 1 || number > MAX_VOUCHER_NUMBER) {
    throw new InputValidationError(`El comprobante "${raw}" no es válido: el número va de 1 a ${MAX_VOUCHER_NUMBER}.`);
  }

  return { number, pointOfSale };
}

function parseAuthorizationCode(raw: string, mode: AuthorizationMode): string {
  const code = raw.trim();

  if (!AUTHORIZATION_CODE.test(code)) {
    throw new InputValidationError(`El ${mode} "${code}" no es válido: tiene que tener 14 dígitos.`);
  }

  return code;
}

/** Propia, la misma que al emitir (`parseDni`): de 6 a 8 dígitos. */
function parseReceiverDni(raw: string): string {
  const dni = parseDni(raw);

  if (!dni.ok) {
    throw new InputValidationError(`El DNI "${raw}" no es válido: debe tener ${dni.reason}.`);
  }

  return dni.value;
}

/**
 * Lo que leen las reglas del receptor. Sin definir es que todavía no se sabe (el asistente no lo preguntó): no falla.
 * `receiver` en `null` es que no hay receptor, como pasa el CLI.
 */
interface VoucherCheckRuleInput {
  readonly receiver: VoucherCheckReceiver | null;
  /** El importe en pesos; `null` si no se sabe (un QR en otra moneda): el tope lo controla ARCA. */
  readonly totalInPesos: number | null;
  readonly voucherType: number;
}

/*
 * La clase de cada tipo sale de la tabla de tipos de WSFE (`FEParamGetTiposCbte`, testing, 27/11/2026). WSCDC tiene la
 * suya (`ComprobantesTipoConsultar`), que puede no ser igual: sin verificar.
 */

/** Clase A: Factura, Notas, Recibo, Nota de venta al contado, RG 1415, Cuenta de venta y Liquidación A. */
const CLASS_A_TYPES: ReadonlySet<number> = new Set([1, 2, 3, 4, 5, 34, 39, 60, 63]);
/** A con leyenda "Operación sujeta a retención" (no son la M, que no está en la tabla). */
const CLASS_A_WITH_LEGEND_TYPES: ReadonlySet<number> = new Set([51, 52, 53, 54]);
/** FCE MiPyMEs A, B y C. */
const FCE_TYPES: ReadonlySet<number> = new Set([201, 202, 203, 206, 207, 208, 211, 212, 213]);
/** Clase B y clase C. */
const CLASS_B_AND_C_TYPES: ReadonlySet<number> = new Set([6, 7, 8, 9, 10, 35, 40, 61, 64, 11, 12, 13, 15]);
/**
 * Los que el manual nombra por código en las observaciones 115 y 116, además de B, C y "R" (49 es la compra de bienes
 * usados). Qué tipos son "R" no lo dice: sin verificar, no se controlan.
 */
const RECEIVER_ABOVE_THRESHOLD_TYPES: ReadonlySet<number> = new Set([30, 31, 37, 38, 41, 49]);
/** Comprobantes de turismo, clase T (WSCDC v0.4 §2.2.4, observación 118). */
const TOURISM_TYPES: ReadonlySet<number> = new Set([195, 196, 197]);
/** Los documentos que acepta un comprobante T (observación 118): CUIT, CI extranjera, pasaporte y DNI. */
const TOURISM_DOCUMENT_TYPES: ReadonlySet<number> = new Set([80, 91, 94, 96]);

type ReceiverRequirement = 'above-threshold' | 'cuit' | 'tourism';

/**
 * Qué pide WSCDC del receptor según el tipo (WSCDC v0.4 §2.2.4):
 * - `cuit`: clase A, A con leyenda y FCE de cualquier letra (la "MiPyme" del manual), siempre y con CUIT (113 y 114;
 *   en homologación, una `fceb` sin CUIT da R 113 y 114).
 * - `above-threshold`: clase B y C y los tipos 30, 31, 37, 38, 41 y 49, solo si el importe supera $ 10.000.000 (115 y
 *   116).
 * - `tourism`: T (195 a 197), si va, con CUIT, CI extranjera, pasaporte o DNI (118).
 * Los demás (la E, "R", los que el manual no nombra) los decide ARCA.
 */
function receiverRequirement(voucherType: number): ReceiverRequirement | null {
  if (CLASS_A_TYPES.has(voucherType) || CLASS_A_WITH_LEGEND_TYPES.has(voucherType) || FCE_TYPES.has(voucherType)) {
    return 'cuit';
  }

  if (CLASS_B_AND_C_TYPES.has(voucherType) || RECEIVER_ABOVE_THRESHOLD_TYPES.has(voucherType)) {
    return 'above-threshold';
  }

  return TOURISM_TYPES.has(voucherType) ? 'tourism' : null;
}

/** `La factura A`; un tipo que ARCLI no emite, con su código: `El comprobante tipo 49`. */
function voucherSubject(voucherType: number): string {
  const kind = getVoucherKindByArcaType(voucherType);

  return kind ? formatVoucherSubject(kind) : `El comprobante tipo ${voucherType}`;
}

/** El flag con el que se pasó ese documento: los flags solo dan 80, 86 y 96. */
function documentFlag(documentType: number): string {
  if (documentType === documentTypeCode('dni')) return '--dni';

  return documentType === documentTypeCode('cuil') ? '--cuil' : '--cuit';
}

function documentName(documentType: number): string {
  return documentTypeLabel(documentType) ?? `el documento ${documentType}`;
}

/**
 * El documento del receptor que pide el tipo: el CUIT en A y FCE, y en la T uno de los que acepta. Solo lee el
 * receptor, así que en el asistente corre al preguntarlo.
 */
const RECEIVER_DOCUMENT_RULE: Rule<VoucherCheckRuleInput, undefined> = {
  check: ({ receiver, voucherType = 0 }) => {
    if (receiver === undefined) {
      return undefined;
    }

    const requirement = receiverRequirement(voucherType);
    const subject = voucherSubject(voucherType);

    if (requirement === 'cuit' && !receiver) {
      return {
        message: `${subject} se constata con el CUIT del receptor: agregá \`--cuit\`.`,
        question: `${subject} se constata con el CUIT del receptor.`,
      };
    }

    if (requirement === 'cuit' && receiver && receiver.documentType !== documentTypeCode('cuit')) {
      return {
        message: `${subject} se constata con el CUIT del receptor: usá \`--cuit\` en vez de \`${documentFlag(receiver.documentType)}\`.`,
        question: `${subject} se constata con el CUIT del receptor, no con ${documentName(receiver.documentType)}.`,
      };
    }

    if (requirement === 'tourism' && receiver && !TOURISM_DOCUMENT_TYPES.has(receiver.documentType)) {
      const accepted = `${subject} (turismo) va con CUIT, CI extranjera, pasaporte o DNI del receptor`;

      return {
        message: `${accepted}: usá \`--cuit\` o \`--dni\` en vez de \`${documentFlag(receiver.documentType)}\`.`,
        question: `${accepted}, no con ${documentName(receiver.documentType)}.`,
      };
    }

    return undefined;
  },
  fields: ['receiver'],
  id: 'voucher-check-receiver-document',
};

/** El receptor desde el tope: necesita el receptor y el importe, así que en el asistente corre con los dos. */
const RECEIVER_THRESHOLD_RULE: Rule<VoucherCheckRuleInput, undefined> = {
  check: ({ receiver, totalInPesos, voucherType = 0 }) => {
    if (
      receiver !== null ||
      totalInPesos === undefined ||
      totalInPesos === null ||
      totalInPesos <= RECEIVER_REQUIRED_ABOVE ||
      receiverRequirement(voucherType) !== 'above-threshold'
    ) {
      return undefined;
    }

    const over = `${voucherSubject(voucherType)} de más de ${formatArgentineMoney(RECEIVER_REQUIRED_ABOVE)} se constata con el documento del receptor`;

    return { message: `${over}: agregá \`--cuit\`, \`--cuil\` o \`--dni\`.`, question: `${over}.` };
  },
  fields: ['receiver', 'totalInPesos'],
  id: 'voucher-check-receiver-threshold',
};

/**
 * El receptor que pide WSCDC según el comprobante, con el texto de los flags (`message`) y el de las preguntas
 * (`question`, REV-76). Con `--qr` las usa `fromQr`, con el texto de las preguntas y qué hacer.
 *
 * @internal Exportada para los tests; la usa también el asistente (SDK-10, PR 2).
 */
export const VOUCHER_CHECK_RECEIVER_RULES: ReadonlyArray<Rule<VoucherCheckRuleInput, undefined>> = [
  RECEIVER_DOCUMENT_RULE,
  RECEIVER_THRESHOLD_RULE,
];

/** WSCDC no constata comprobantes anteriores al 1/1/2013 (WSCDC v0.4 §2.2.4, observación 101). */
const FIRST_CHECKABLE_DATE = '20130101';

function assertCheckableDate(date: string): void {
  if (date < FIRST_CHECKABLE_DATE) {
    throw new InputValidationError(
      `La fecha ${formatArcaDateAsArgentineDate(date)} es anterior al ${formatArcaDateAsArgentineDate(FIRST_CHECKABLE_DATE)}: ARCA no constata comprobantes de antes.`,
    );
  }
}

/** `ImpTotal`: hasta 13 enteros y 2 decimales (WSCDC v0.4 §2.2.4, error 7). El de WSFE es el mismo, con otra fuente. */
const TOTAL_LIMIT = 10_000_000_000_000;

function assertTotalFormat(total: number): void {
  if (total >= TOTAL_LIMIT || !hasAtMostDecimals(total, AMOUNT_DECIMALS)) {
    throw new InputValidationError(
      `El importe ${formatArgentineAmount(total)} no es válido: ARCA acepta hasta 13 enteros y 2 decimales (${formatArgentineAmount(TOTAL_LIMIT - 0.01)}).`,
    );
  }
}

/** El QR ya trae todo; acá van los límites de WSCDC que su especificación no pone, y el receptor que pide el tipo. */
function fromQr(text: string): VoucherCheckRequest {
  const parsed = parseArcaQrUrl(text);

  if (!parsed.ok) {
    throw new InputValidationError(`El QR no es válido: ${parsed.reason}.`);
  }

  const qr = parsed.value;

  if (qr.pointOfSale > MAX_POINT_OF_SALE) {
    throw new InputValidationError(`El QR no se puede constatar: el punto de venta va de 1 a ${MAX_POINT_OF_SALE}.`);
  }

  assertCheckableDate(qr.date);
  assertTotalFormat(qr.total);

  const failure = findRuleFailure(
    VOUCHER_CHECK_RECEIVER_RULES,
    { receiver: qr.receiver, totalInPesos: qrTotalInPesos(qr), voucherType: qr.voucherType },
    undefined,
  );

  if (failure) {
    throw new InputValidationError(
      `${failure.failure.question ?? failure.failure.message} Con lo que trae el QR no se puede constatar.`,
      undefined,
      'Constatá con los datos del comprobante (tipo, número, `--emisor`, `-f`, `-m`, `--cae` y el documento del receptor) en vez de `--qr`.',
    );
  }

  return {
    authorizationCode: qr.authorizationCode,
    currency: qr.currency,
    date: qr.date,
    issuerCuit: qr.issuerCuit,
    mode: qr.mode,
    number: qr.number,
    pointOfSale: qr.pointOfSale,
    receiver: qr.receiver,
    shortcut: fromArcaType(qr.voucherType).shortcut,
    total: qr.total,
    voucherType: qr.voucherType,
  };
}

/**
 * El importe del QR para el tope del receptor, que el manual da "en pesos": en pesos o sin moneda, tal cual; en otra
 * moneda no se controla, como con los flags, y si falta el receptor lo dice ARCA (115 y 116, error de entrada).
 */
function qrTotalInPesos(qr: ArcaQrValue): number | null {
  return qr.currency === null || qr.currency === 'PES' ? qr.total : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Solo de los flags: cuáles faltan y cuáles no van juntos.
// ---------------------------------------------------------------------------------------------------------------

/** Lo que no se puede usar junto con `--qr`, con el nombre que va en el error. */
const QR_EXCLUSIVE: ReadonlyArray<readonly [keyof VoucherCheckInput, string]> = [
  ['kind', 'el tipo ni el comprobante'],
  ['voucher', 'el tipo ni el comprobante'],
  ['issuer', '`--emisor`'],
  ['date', '`-f`'],
  ['amount', '`-m`'],
  ['cae', '`--cae`'],
  ['caea', '`--caea`'],
  ['cuit', '`--cuit`'],
  ['cuil', '`--cuil`'],
  ['dni', '`--dni`'],
];

function authorizationFromFlags(input: VoucherCheckInput): {
  readonly code: string;
  readonly mode: AuthorizationMode;
} {
  if (input.cae !== undefined && input.caea !== undefined) {
    throw new InputValidationError('Usá `--cae` o `--caea`, no los dos: el comprobante tiene uno solo.');
  }

  const mode: AuthorizationMode = input.caea === undefined ? 'CAE' : 'CAEA';
  const code = input.caea ?? input.cae;

  if (code === undefined) {
    throw new InputValidationError(
      'Falta el código de autorización: `--cae` o `--caea`, el que figura en el comprobante.',
    );
  }

  return { code: parseAuthorizationCode(code, mode), mode };
}

/** El receptor de `--cuit`, `--cuil` o `--dni` (uno solo). Los CUIT y CUIL ya los validó su flag. */
function receiverFromFlags(input: VoucherCheckInput): VoucherCheckReceiver | null {
  const given = (
    [
      ['--cuit', input.cuit, documentTypeCode('cuit')],
      ['--cuil', input.cuil, documentTypeCode('cuil')],
      ['--dni', input.dni, documentTypeCode('dni')],
    ] as const
  ).filter(([, value]) => value !== undefined);

  if (given.length > 1) {
    throw new InputValidationError(
      `Usá un solo documento del receptor: ${given.map(([flag]) => `\`${flag}\``).join(' o ')}, no ${given.length === 2 ? 'los dos' : 'varios'}.`,
    );
  }

  const [entry] = given;

  if (!entry) {
    return null;
  }

  const [flag, value = '', documentType] = entry;

  return { documentNumber: flag === '--dni' ? parseReceiverDni(value) : value, documentType };
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new InputValidationError(message);
  }

  return value;
}

function fromFlags(input: VoucherCheckInput, now: Date): VoucherCheckRequest {
  const type = resolveType(
    required(
      input.kind,
      'Falta el tipo de comprobante y su número, como `arcli constatar fa 3-1234 …`, o `--qr` con la dirección del QR.',
    ),
  );
  const voucher = parseVoucher(
    required(input.voucher, 'Falta el comprobante: el punto de venta y el número, como `3-1234`.'),
  );
  const issuerCuit = required(input.issuer, 'Falta `--emisor`: el CUIT de quien emitió el comprobante.');
  const date = parseDateInputAsArcaDate(
    required(input.date, 'Falta `-f` (`--fecha`): la fecha del comprobante.'),
    'day',
    now,
  );
  const total = required(input.amount, 'Falta `-m` (`--monto`): el importe total del comprobante.');
  const { code, mode } = authorizationFromFlags(input);
  const receiver = receiverFromFlags(input);

  assertCheckableDate(date);
  assertTotalFormat(total);
  // Con los flags no se sabe la moneda: el importe se toma en pesos (sin verificar para otra moneda).
  assertRules(
    VOUCHER_CHECK_RECEIVER_RULES,
    { receiver, totalInPesos: total, voucherType: type.voucherType },
    undefined,
  );

  return {
    authorizationCode: code,
    currency: null,
    date,
    issuerCuit,
    mode,
    number: voucher.number,
    pointOfSale: voucher.pointOfSale,
    receiver,
    shortcut: type.shortcut,
    total,
    voucherType: type.voucherType,
  };
}

/**
 * Lo que se constata, validado: de los flags o de `--qr`, nunca de los dos ni de la config (el punto de venta es el del
 * comprobante recibido, no el propio). `now` resuelve las fechas relativas (`ayer`, `-7`).
 */
export function resolveVoucherCheckRequest(input: VoucherCheckInput, now: Date): VoucherCheckRequest {
  if (input.qr === undefined) {
    return fromFlags(input, now);
  }

  const mixed = QR_EXCLUSIVE.find(([key]) => input[key] !== undefined);

  if (mixed) {
    throw new InputValidationError(
      `Con \`--qr\` los datos salen del QR: no pases también ${mixed[1]}. Usá \`--qr\` solo, o los datos sin \`--qr\`.`,
    );
  }

  return fromQr(input.qr);
}

/** Constata en ARCA. El comprobante existe y coincide si `answer.result` es `A`. */
export async function checkVoucher(
  gateway: VoucherCheckGateway,
  request: VoucherCheckRequest,
  environment: ArcliEnvironment,
): Promise<VoucherCheckReport> {
  return { answer: await gateway.check(request), environment, request };
}

export function isChecked(report: VoucherCheckReport): boolean {
  return report.answer.result === 'A';
}
