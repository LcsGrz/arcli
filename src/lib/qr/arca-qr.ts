import { parseFullArgentineDateAsArcaDate } from '../dates/arca-date';
import { InputValidationError } from '../errors/app-error';
import { parseCuit } from '../identity/cuit';

/**
 * El QR de los comprobantes electrónicos (RG 4892/2020, "Especificaciones del QR", versión 1 del JSON):
 * `https://www.arca.gob.ar/fe/qr/?p=<JSON en Base64>`. Los emitidos antes del cambio de nombre, el ejemplo del mismo
 * documento y `@arcasdk/pdf` usan `https://www.afip.gob.ar/fe/qr/`: valen las dos.
 */
const QR_HOSTS: ReadonlySet<string> = new Set(['www.afip.gob.ar', 'www.arca.gob.ar']);
const QR_PATHS: ReadonlySet<string> = new Set(['/fe/qr', '/fe/qr/']);
const QR_BASE = 'https://www.arca.gob.ar/fe/qr/?p=…';

/** La única versión publicada del JSON (`ver`). */
const QR_VERSION = 1;

/** `tipoCodAut`: `E` es un CAE y `A` un CAEA. El QR no tiene CAI (es de los comprobantes en papel). */
const AUTHORIZATION_MODES = { A: 'CAEA', E: 'CAE' } as const;

/** El receptor que pone `@arcasdk/pdf` para un consumidor final sin documento: no es un receptor. */
const UNIDENTIFIED_DOCUMENT_TYPE = 99;

interface ArcaQrReceiver {
  /** Solo dígitos, como texto: hasta 20 en el QR. */
  readonly documentNumber: string;
  readonly documentType: number;
}

/** Lo que trae el QR, ya como lo pide WSCDC: fecha `yyyymmdd`, `CAE` o `CAEA`, y el receptor solo si lo hay. */
export interface ArcaQrValue {
  /** El CAE o CAEA (`codAut`), 14 dígitos como texto. */
  readonly authorizationCode: string;
  /** `yyyymmdd`. */
  readonly date: string;
  /** 11 dígitos, con el verificador controlado. */
  readonly issuerCuit: string;
  readonly mode: 'CAE' | 'CAEA';
  readonly number: number;
  readonly pointOfSale: number;
  readonly receiver: ArcaQrReceiver | null;
  /** `importe`, en la moneda del comprobante. */
  readonly total: number;
  readonly voucherType: number;
}

export type ArcaQrParseResult =
  { readonly ok: true; readonly value: ArcaQrValue } | { readonly ok: false; readonly reason: string };

/** Un dato del QR que no se puede usar: el motivo ya escrito. */
class QrFieldError extends Error {}

function fail(reason: string): never {
  throw new QrFieldError(reason);
}

/** El `p` tal como vino, sin `URLSearchParams`: convierte el `+` del Base64 en espacio. */
function readRawParameter(search: string): string | undefined {
  return /[?&]p=([^&#]*)/.exec(search)?.[1];
}

function decodeParameter(raw: string): string {
  try {
    // Algunos lectores de QR copian el `=` del final como `%3D`.
    return decodeURIComponent(raw).replace(/ /g, '+');
  } catch {
    return fail('el parámetro p no es un texto en Base64');
  }
}

function decodeJson(base64: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    fail('el parámetro p no es un texto en Base64');
  }

  let json: unknown;

  try {
    json = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  } catch {
    return fail('el contenido del parámetro p no es un JSON');
  }

  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    fail('el contenido del parámetro p no es un JSON con los datos del comprobante');
  }

  return json as Record<string, unknown>;
}

function required(json: Record<string, unknown>, field: string): unknown {
  const value = json[field];

  if (value === undefined || value === null || value === '') {
    fail(`falta el campo ${field}`);
  }

  return value;
}

/** Los numéricos de la especificación: un número o, si el emisor lo escribió como texto, solo dígitos. */
function digits(value: unknown, field: string, maxDigits: number): string {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;

  if (typeof text !== 'string' || !new RegExp(`^\\d{1,${maxDigits}}$`).test(text)) {
    fail(`el campo ${field} tiene que ser un número entero de hasta ${maxDigits} dígitos`);
  }

  return text;
}

function positiveInteger(value: unknown, field: string, maxDigits: number): number {
  const number = Number(digits(value, field, maxDigits));

  if (number <= 0) {
    fail(`el campo ${field} tiene que ser mayor a 0`);
  }

  return number;
}

/** `fecha` es full-date de RFC 3339: `AAAA-MM-DD`, como texto. */
function readDate(value: unknown): string {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;

  if (!match) {
    fail('el campo fecha tiene que ser una fecha AAAA-MM-DD');
  }

  try {
    return (
      parseFullArgentineDateAsArcaDate(`${match[3]}/${match[2]}/${match[1]}`) ?? fail(`el campo fecha no es válido`)
    );
  } catch (error) {
    if (error instanceof InputValidationError) {
      fail(`el campo fecha (${value as string}) no es una fecha que exista`);
    }

    throw error;
  }
}

/** `importe`: decimal de 13 enteros y 2 decimales, en la moneda del comprobante. */
function readTotal(value: unknown): number {
  const number = typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;

  if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) {
    fail('el campo importe tiene que ser un número mayor o igual a 0');
  }

  return number;
}

function readMode(value: unknown): ArcaQrValue['mode'] {
  if (value !== 'A' && value !== 'E') {
    fail('el campo tipoCodAut tiene que ser E (CAE) o A (CAEA)');
  }

  return AUTHORIZATION_MODES[value];
}

function readIssuerCuit(value: unknown): string {
  const cuit = parseCuit(digits(value, 'cuit', 11));

  return cuit.ok ? cuit.value : fail(`el campo cuit no es un CUIT válido: ${cuit.reason}`);
}

/** `tipoDocRec` y `nroDocRec` van "de corresponder": sin ellos, o con el 99/0 del consumidor final, no hay receptor. */
function readReceiver(json: Record<string, unknown>): ArcaQrReceiver | null {
  const { nroDocRec, tipoDocRec } = json;
  const hasType = tipoDocRec !== undefined && tipoDocRec !== null;
  const hasNumber = nroDocRec !== undefined && nroDocRec !== null;

  if (!hasType && !hasNumber) {
    return null;
  }

  if (!hasType || !hasNumber) {
    fail(hasType ? 'trae tipoDocRec sin nroDocRec' : 'trae nroDocRec sin tipoDocRec');
  }

  const documentType = Number(digits(tipoDocRec, 'tipoDocRec', 2));
  const documentNumber = digits(nroDocRec, 'nroDocRec', 20);

  if (Number(documentNumber) === 0 || documentType === UNIDENTIFIED_DOCUMENT_TYPE) {
    return null;
  }

  return { documentNumber, documentType };
}

function readValue(json: Record<string, unknown>): ArcaQrValue {
  const version = required(json, 'ver');

  if (version !== QR_VERSION) {
    fail(`es de la versión ${String(version)} y ARCLI lee la versión ${QR_VERSION}`);
  }

  return {
    authorizationCode: readAuthorizationCode(required(json, 'codAut')),
    date: readDate(required(json, 'fecha')),
    issuerCuit: readIssuerCuit(required(json, 'cuit')),
    mode: readMode(required(json, 'tipoCodAut')),
    number: positiveInteger(required(json, 'nroCmp'), 'nroCmp', 8),
    pointOfSale: positiveInteger(required(json, 'ptoVta'), 'ptoVta', 5),
    receiver: readReceiver(json),
    total: readTotal(required(json, 'importe')),
    voucherType: positiveInteger(required(json, 'tipoCmp'), 'tipoCmp', 3),
  };
}

function readAuthorizationCode(value: unknown): string {
  const code = digits(value, 'codAut', 14);

  return code.length === 14 ? code : fail('el campo codAut tiene que tener 14 dígitos');
}

/**
 * Lee la URL de un QR de ARCA (la que copia un lector de QR, con o sin espacios alrededor) y devuelve los datos del
 * comprobante, o el motivo por el que no se puede usar. No consulta nada: si el comprobante existe lo dice WSCDC.
 */
export function parseArcaQrUrl(text: string): ArcaQrParseResult {
  const trimmed = text.trim();
  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: `no es la dirección de un QR de ARCA (${QR_BASE})` };
  }

  if (url.protocol !== 'https:' || !QR_HOSTS.has(url.hostname) || !QR_PATHS.has(url.pathname)) {
    return { ok: false, reason: `no es la dirección de un QR de ARCA (${QR_BASE})` };
  }

  const raw = readRawParameter(url.search);

  if (!raw) {
    return { ok: false, reason: 'le falta el parámetro p, con los datos del comprobante' };
  }

  try {
    return { ok: true, value: readValue(decodeJson(decodeParameter(raw))) };
  } catch (error) {
    if (error instanceof QrFieldError) {
      return { ok: false, reason: error.message };
    }

    throw error;
  }
}
