import { parseDateInputAsArcaDate } from '../../lib/dates/relative-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { parseDni } from '../../lib/identity/dni';
import { formatArgentineMoney } from '../../lib/numbers/argentine-amount';
import { type ArcaQrValue, parseArcaQrUrl } from '../../lib/qr/arca-qr';
import { documentTypeCode } from '../billing/arca-codes';
import type { VoucherKindDefinition } from '../billing/billing.types';
import { getVoucherKindByArcaType, getVoucherKindByShortcut, VOUCHER_SHORTCUTS } from '../billing/voucher-kind-map';
import { formatVoucherSubject } from '../billing/voucher-names';
import type { ArcliEnvironment } from '../config/config.schemas';
import {
  EXPORT_VOUCHER_KINDS,
  getExportVoucherKindByArcaType,
  getExportVoucherKindByShortcut,
} from '../export/export.kinds';

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
 * Desde cuánto el receptor de una B o una C es obligatorio: si el importe lo supera (WSCDC v0.4 §2.2.4, observaciones
 * 115 y 116; el tope de la v0.3). Es "supera", no "desde": a diferencia de la RG 5700 al emitir
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
  /** El motivo de un rechazo (100 a 118) o el aviso de un constatado (200, CAEA sin rendir). */
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

const TYPE_HINT = `Usá el atajo (${[...VOUCHER_SHORTCUTS, ...EXPORT_VOUCHER_KINDS.map((kind) => kind.shortcut)].join(', ')}) o el código de ARCA (1, 6, 11, 51…).`;

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

/** El atajo (`fa`, `FA`, `fe`) o el código de ARCA (`1`, `51`): se constatan también los que ARCLI no emite. */
function resolveType(raw: string): ResolvedType {
  const value = raw.trim().toLowerCase();

  if (/^\d{1,3}$/.test(value) && Number(value) >= 1 && Number(value) <= MAX_VOUCHER_TYPE) {
    return fromArcaType(Number(value));
  }

  const kind = getVoucherKindByShortcut(value);
  const arcaType = kind?.arcaType ?? getExportVoucherKindByShortcut(value)?.arcaType;

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

function authorization(input: VoucherCheckInput): { readonly code: string; readonly mode: AuthorizationMode } {
  if (input.cae !== undefined && input.caea !== undefined) {
    throw new InputValidationError('Usá `--cae` o `--caea`, no los dos: el comprobante tiene uno solo.');
  }

  const flag = input.caea === undefined ? '--cae' : '--caea';
  const code = (input.caea ?? input.cae)?.trim();

  if (code === undefined) {
    throw new InputValidationError(
      'Falta el código de autorización: `--cae` o `--caea`, el que figura en el comprobante.',
    );
  }

  if (!AUTHORIZATION_CODE.test(code)) {
    throw new InputValidationError(`\`${flag}\` "${code}" no es válido: tiene que tener 14 dígitos.`);
  }

  return { code, mode: input.caea === undefined ? 'CAE' : 'CAEA' };
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

  if (flag === '--dni') {
    const dni = parseDni(value);

    if (!dni.ok) {
      throw new InputValidationError(`\`--dni\` "${value}" no es válido: debe tener ${dni.reason}.`);
    }

    return { documentNumber: dni.value, documentType };
  }

  return { documentNumber: value, documentType };
}

/** Clase A (también la FCE A): el receptor va siempre y con CUIT (WSCDC v0.4 §2.2.4, observaciones 113 y 114). */
function requiresCuitReceiver(kind: VoucherKindDefinition): boolean {
  return kind.letter === 'a';
}

/**
 * El receptor que pide WSCDC según el comprobante. Solo para los tipos que ARCLI conoce: en los demás (la M, la E y
 * los que ARCLI no emite) decide ARCA, que contesta con la observación que corresponda.
 */
function assertReceiver(type: ResolvedType, total: number, receiver: VoucherCheckReceiver | null): void {
  const { kind } = type;

  if (!kind) {
    return;
  }

  const cuit = documentTypeCode('cuit');

  if (requiresCuitReceiver(kind)) {
    if (!receiver) {
      throw new InputValidationError(
        `${formatVoucherSubject(kind)} se constata con el CUIT del receptor: agregá \`--cuit\`.`,
      );
    }

    if (receiver.documentType !== cuit) {
      const flag = receiver.documentType === documentTypeCode('dni') ? '--dni' : '--cuil';

      throw new InputValidationError(
        `${formatVoucherSubject(kind)} se constata con el CUIT del receptor: usá \`--cuit\` en vez de \`${flag}\`.`,
      );
    }

    return;
  }

  if (!receiver && total > RECEIVER_REQUIRED_ABOVE) {
    throw new InputValidationError(
      `${formatVoucherSubject(kind)} de más de ${formatArgentineMoney(RECEIVER_REQUIRED_ABOVE)} se constata con el documento del receptor: agregá \`--cuit\`, \`--cuil\` o \`--dni\`.`,
    );
  }
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new InputValidationError(message);
  }

  return value;
}

function fromFlags(input: VoucherCheckInput, now: Date): VoucherCheckRequest {
  const kind = required(
    input.kind,
    'Falta el tipo de comprobante y su número, como `arcli constatar fa 3-1234 …`, o `--qr` con la dirección del QR.',
  );
  const type = resolveType(kind);
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
  const { code, mode } = authorization(input);
  const receiver = receiverFromFlags(input);

  assertReceiver(type, total, receiver);

  return {
    authorizationCode: code,
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

/** El QR ya trae todo; acá van los límites de WSCDC que su especificación no pone. */
function fromQr(qr: ArcaQrValue): VoucherCheckRequest {
  const invalid = (reason: string) => new InputValidationError(`El QR de \`--qr\` no se puede constatar: ${reason}.`);

  if (qr.pointOfSale > MAX_POINT_OF_SALE) {
    throw invalid(`el punto de venta va de 1 a ${MAX_POINT_OF_SALE}`);
  }

  const type = fromArcaType(qr.voucherType);

  // El receptor no se controla: con `--qr` no se puede agregar, y si falta lo dice ARCA (observaciones 113 a 117).
  return {
    authorizationCode: qr.authorizationCode,
    date: qr.date,
    issuerCuit: qr.issuerCuit,
    mode: qr.mode,
    number: qr.number,
    pointOfSale: qr.pointOfSale,
    receiver: qr.receiver,
    shortcut: type.shortcut,
    total: qr.total,
    voucherType: qr.voucherType,
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

  const parsed = parseArcaQrUrl(input.qr);

  if (!parsed.ok) {
    throw new InputValidationError(`El QR de \`--qr\` no es válido: ${parsed.reason}.`);
  }

  return fromQr(parsed.value);
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
