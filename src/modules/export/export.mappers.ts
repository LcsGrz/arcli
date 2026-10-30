import { formatDateAsArcaDate, parseArgentineDateInputAsArcaDate } from '../../lib/dates/arca-date';
import { AppError, InputValidationError } from '../../lib/errors/app-error';
import { resolveBillingCurrencyCode } from '../billing/billing.mappers';
import type { ArcliConfig } from '../config/config.schemas';

import {
  DEFAULT_EXPORT_CURRENCY_CODE,
  DEFAULT_EXPORT_LANGUAGE,
  DEFAULT_EXPORT_TYPE,
  EXPORT_TYPE_VALUES,
  EXPORT_TYPES,
  EXPORT_TYPES_WITHOUT_PERMITS,
  EXPORT_VOUCHER_KIND,
  type ExportActivity,
  type ExportCountry,
  type ExportCountryCuit,
  type ExportCurrencyResolution,
  type ExportIncoterm,
  type ExportItemPayload,
  type ExportQuotation,
  type ExportType,
  type ExportVoucherInput,
  type ExportVoucherPayload,
  MAX_EXPORT_VOUCHER_NUMBER,
} from './export.types';

/** Codigo de pais de Argentina en la tabla DST_pais: no es un destino de exportacion. */
export const ARGENTINA_COUNTRY_CODE = 200;

/** Forma de pago por defecto: WSFEX la exige y casi todas las exportaciones se cobran por transferencia internacional. */
export const DEFAULT_EXPORT_PAYMENT_TERMS = 'Transferencia Internacional';

/** ARCA no acepta cotizaciones en pesos distintas de 1. */
const LOCAL_EXCHANGE_RATE = 1;

type ExportConfig = Pick<ArcliConfig, 'cotizacionPorDefecto' | 'puntoVentaPorDefecto'>;

export interface BuildExportResolution {
  readonly activity: number;
  readonly clientCountryCuit: number;
  readonly currency: ExportCurrencyResolution['fields'];
  readonly destinationCountry: ExportCountry;
  readonly exportType: ExportType;
  readonly incoterm?: ExportIncoterm;
  readonly items: readonly ExportItemPayload[];
  readonly languageId: number;
  readonly paymentDate: string;
  readonly pointOfSale: number;
  readonly requestId: number;
  readonly voucherDate: string;
  readonly voucherNumber: number;
}

function requireText(value: string | undefined, description: string, flag: string): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new InputValidationError(`Falta ${description}. Usá ${flag}.`);
  }

  return trimmed;
}

function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

/** La fecha del comprobante, en formato ARCA: por defecto hoy en Argentina. */
export function resolveExportVoucherDate(value: string | undefined, now = new Date()): string {
  return value?.trim() ? parseArgentineDateInputAsArcaDate(value) : formatDateAsArcaDate(now);
}

/**
 * Acepta `ARS`, `USD` o los codigos de ARCA (`PES`, `DOL`). Sin `--moneda` la exportacion va en dolares; la moneda
 * de la config es la de los comprobantes locales. Sin cotizacion explicita se pide la del dia a ARCA: WSFEX no
 * acepta `Moneda_ctz` en 0 para moneda extranjera.
 */
export function resolveExportCurrency(
  input: Pick<ExportVoucherInput, 'currencyCode' | 'exchangeRate' | 'sameCurrency'>,
  config: Pick<ExportConfig, 'cotizacionPorDefecto'>,
): ExportCurrencyResolution {
  const requested = input.currencyCode?.trim() || DEFAULT_EXPORT_CURRENCY_CODE;
  const currencyCode = resolveBillingCurrencyCode(requested);
  const displayCode = requested.toUpperCase();

  if (currencyCode === 'PES') {
    if (input.sameCurrency) {
      throw new InputValidationError('--misma-moneda solo aplica a comprobantes en moneda extranjera.');
    }

    if (typeof input.exchangeRate === 'number' && input.exchangeRate !== LOCAL_EXCHANGE_RATE) {
      throw new InputValidationError('En pesos la cotización tiene que ser 1. Quitá --cotizacion-moneda o usá --cm 1.');
    }

    return {
      fields: { CanMisMonExt: 'N', Moneda_ctz: LOCAL_EXCHANGE_RATE, Moneda_Id: currencyCode },
      needsQuotation: false,
    };
  }

  const configuredRate = config.cotizacionPorDefecto;
  const rate =
    input.exchangeRate ?? (configuredRate && configuredRate > LOCAL_EXCHANGE_RATE ? configuredRate : undefined);

  if (rate !== undefined && rate <= LOCAL_EXCHANGE_RATE) {
    throw new InputValidationError(`La cotización de ${displayCode} tiene que ser mayor a 1.`);
  }

  return {
    fields: {
      CanMisMonExt: input.sameCurrency ? 'S' : 'N',
      Moneda_ctz: rate ?? 0,
      Moneda_Id: currencyCode,
    },
    needsQuotation: rate === undefined,
  };
}

/**
 * La cotizacion de aduana de la fecha del comprobante. WSFEX devuelve por moneda la ultima publicada, asi que el
 * dia en curso —que todavia no tiene— o un fin de semana traen la anterior. Sin fila para la moneda no hay
 * cotizacion que usar: es error, salvo que el usuario la informe con `--cotizacion-moneda`.
 */
export function resolveExportQuotation(
  currencyCode: string,
  quotations: readonly ExportQuotation[],
  isoDate: string,
): ExportQuotation {
  const code = currencyCode.trim().toUpperCase();
  const quotation = quotations.find((entry) => entry.code.trim().toUpperCase() === code);

  if (quotation) {
    return quotation;
  }

  const available = quotations.map((entry) => entry.code).join(', ');

  throw new AppError(
    `ARCA no informó la cotización de ${code} para el ${isoDate}.${
      available ? ` Las monedas con cotización son ${available}.` : ''
    } Informá la cotización con --cotizacion-moneda.`,
    { code: 'ARCA_QUOTATION_ERROR' },
  );
}

/**
 * WSFEX exige una `Actividad` (error 2100) y solo acepta los codigos de su propia tabla, que no es la del padron y
 * es mas chica (error 2105 al emitir). Cada emisor tiene la suya, asi que no hay default: sale de `--actividad` o de
 * `exportacion.actividad`. Los nombres de la tabla llegan con la codificacion rota, por eso los mensajes solo dan codigos.
 */
export function resolveExportActivity(value: number, activities: readonly ExportActivity[] = []): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new InputValidationError('La actividad tiene que ser un número entero positivo. Usá --actividad.');
  }

  if (activities.length === 0 || activities.some((activity) => activity.id === value)) {
    return value;
  }

  const prefix = String(value).slice(0, 3);
  const family = activities.filter((activity) => String(activity.id).startsWith(prefix)).slice(0, 5);
  const candidates =
    family.length > 0 ? ` Las que empiezan con ${prefix} son ${family.map((activity) => activity.id).join(', ')}.` : '';

  throw new InputValidationError(
    `La actividad ${value} no está en la tabla de actividades de WSFEX y ARCA la rechaza (error 2105).${candidates} Indicá la que corresponda con --actividad.`,
  );
}

export function resolveExportType(value: ExportType | undefined): ExportType {
  if (value === undefined) {
    return DEFAULT_EXPORT_TYPE;
  }

  if (!EXPORT_TYPE_VALUES.includes(value)) {
    throw new InputValidationError(
      '--tipo-expo tiene que ser 1 (exportación definitiva de bienes), 2 (servicios) o 4 (otros).',
    );
  }

  return value;
}

export function resolveExportLanguage(
  value: number | undefined,
  languages: readonly { readonly id: number }[],
): number {
  if (value === undefined) {
    return DEFAULT_EXPORT_LANGUAGE;
  }

  if (languages.length > 0 && !languages.some((language) => language.id === value)) {
    throw new InputValidationError(`El idioma ${value} no existe en la tabla de ARCA.`);
  }

  return value;
}

/**
 * El pais se puede escribir por codigo (`203`) o por nombre (`Brasil`). Se valida contra la tabla de ARCA y
 * se rechaza Argentina: WSFEX es solo para exportaciones.
 */
export function resolveExportDestinationCountry(
  value: string | undefined,
  countries: readonly ExportCountry[],
): ExportCountry {
  const trimmed = requireText(value, 'el país de destino', '--pais-destino');
  const numeric = /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
  const country = numeric
    ? countries.find((entry) => entry.code === numeric)
    : countries.find((entry) => entry.name.trim().toLowerCase() === trimmed.toLowerCase());

  if (!country) {
    throw new InputValidationError(
      `El país de destino "${trimmed}" no existe en la tabla de ARCA. Usá el código o el nombre que informa ARCA.`,
    );
  }

  if (country.code === ARGENTINA_COUNTRY_CODE) {
    throw new InputValidationError(
      'Argentina no es un destino de exportación: usá `arcli factura a` o `arcli factura b`.',
    );
  }

  return country;
}

/**
 * DST_CUIT repite cada pais tres veces, con el tipo de entidad pegado al nombre: "BRASIL - Persona Jurídica".
 * DST_pais trae solo "BRASIL", asi que el sufijo no sirve para comparar ni para mostrar el pais.
 */
const COUNTRY_CUIT_ENTITY_SUFFIX =
  /\s*-\s*(?:persona\s+f[ií]sica|persona\s+jur[ií]dica|otro\s+tipo\s+de\s+entidad)\s*$/i;

/** Cuando el pais tiene las tres filas, gana la de persona juridica: el cliente de una exportacion suele ser una empresa. */
const COUNTRY_CUIT_ENTITY_PREFERENCE = [
  /\bpersona\s+jur[ií]dica\s*$/i,
  /\botro\s+tipo\s+de\s+entidad\s*$/i,
  /\bpersona\s+f[ií]sica\s*$/i,
];

/** Para comparar nombres de las dos tablas: sin tipo de entidad, sin acentos, sin mayusculas y con un solo espacio. */
function normalizeCountryName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function countryNameWithoutEntity(value: string): string {
  return value.replace(COUNTRY_CUIT_ENTITY_SUFFIX, '').trim();
}

function pickCountryCuit(entries: readonly ExportCountryCuit[]): ExportCountryCuit | undefined {
  for (const preference of COUNTRY_CUIT_ENTITY_PREFERENCE) {
    const preferred = entries.find((entry) => preference.test(entry.countryName));

    if (preferred) {
      return preferred;
    }
  }

  return entries[0];
}

/**
 * WSFEX pide el CUIT del pais del cliente. Se resuelve con la tabla DST_CUIT, que nombra cada pais con el tipo de
 * entidad ("ESTADOS UNIDOS - Persona Jurídica"), mientras que la tabla de destinos dice solo "ESTADOS UNIDOS": por
 * eso se compara sin el sufijo. Si el CUIT viene por flag se valida contra la tabla, salvo para los paises cuyo
 * nombre no coincide entre las dos tablas ("CHINA" y "CHINA REP.POPULAR"), donde solo se acepta que exista.
 */
export function resolveExportClientCountryCuit(options: {
  readonly country: ExportCountry;
  readonly countries: readonly ExportCountryCuit[];
  readonly cuit?: number;
}): number {
  const destination = normalizeCountryName(options.country.name);
  const forDestination = options.countries.filter(
    (entry) => normalizeCountryName(countryNameWithoutEntity(entry.countryName)) === destination,
  );

  if (options.cuit === undefined) {
    const resolved = pickCountryCuit(forDestination);

    if (!resolved) {
      throw new InputValidationError(
        `La tabla de ARCA no tiene CUIT para "${options.country.name}". Indicalo con --cuit-pais.`,
      );
    }

    return resolved.cuit;
  }

  const match = options.countries.find((entry) => entry.cuit === options.cuit);

  if (!match) {
    throw new InputValidationError(`El CUIT de país ${options.cuit} no existe en la tabla de ARCA.`);
  }

  const expected = pickCountryCuit(forDestination);

  if (expected && normalizeCountryName(countryNameWithoutEntity(match.countryName)) !== destination) {
    throw new InputValidationError(
      `El CUIT de país ${options.cuit} corresponde a "${countryNameWithoutEntity(match.countryName)}" y el destino es "${options.country.name}". Para "${options.country.name}" la tabla de ARCA trae ${expected.cuit}.`,
    );
  }

  return options.cuit;
}

/** `--incoterm` se compara contra la tabla de ARCA, sin importar mayusculas. */
export function resolveExportIncoterm(
  value: string | undefined,
  incoterms: readonly ExportIncoterm[],
): ExportIncoterm | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const incoterm = incoterms.find((entry) => entry.code.trim().toUpperCase() === trimmed.toUpperCase());

  if (!incoterm) {
    throw new InputValidationError(
      `El incoterm "${trimmed}" no existe en la tabla de ARCA. Consultá los válidos con arcli parametros.`,
    );
  }

  return incoterm;
}

export function resolveExportPointOfSale(value: number | undefined, config: ExportConfig): number {
  const pointOfSale = value ?? config.puntoVentaPorDefecto;

  if (pointOfSale === undefined) {
    throw new InputValidationError('Falta el punto de venta. Usá --punto-venta o configurá puntoVentaPorDefecto.');
  }

  if (!Number.isInteger(pointOfSale) || pointOfSale < 1) {
    throw new InputValidationError('El punto de venta tiene que ser un número entero positivo.');
  }

  return pointOfSale;
}

/** Numero del comprobante o de la solicitud: el indicado por el usuario o el que sigue al ultimo de ARCA. */
export function resolveExportNumber(options: {
  readonly label: string;
  readonly last: number;
  readonly provided?: number;
}): number {
  if (options.provided !== undefined) {
    if (!Number.isInteger(options.provided) || options.provided < 1) {
      throw new InputValidationError(`${options.label} tiene que ser un número entero positivo.`);
    }

    return options.provided;
  }

  const next = (Number.isFinite(options.last) ? options.last : 0) + 1;

  if (next > MAX_EXPORT_VOUCHER_NUMBER) {
    throw new InputValidationError(`${options.label} supera el máximo de ARCA (${MAX_EXPORT_VOUCHER_NUMBER}).`);
  }

  return next;
}

/** En los tipos 2 (servicios) y 4 (otros) ARCA exige `Permiso_existente` vacio, no `N` (error 1550). */
function requiresEmptyPermitsExisting(exportType: ExportType): boolean {
  return EXPORT_TYPES_WITHOUT_PERMITS.includes(exportType);
}

/**
 * Con `Permiso_existente = N` ARCA rechaza el campo `Permisos` (error 1720), y en los tipos 2 y 4 pide el campo
 * vacio y no admite permisos (error 1550): sin permisos no se manda.
 */
function resolvePermits(
  input: ExportVoucherInput,
  destinationCountry: number,
  exportType: ExportType,
): ExportVoucherPayload['Permisos'] {
  const permits = (input.permits ?? []).map((permit) => permit.trim()).filter(Boolean);

  if (permits.length === 0) {
    if (input.permitsExisting) {
      throw new InputValidationError('--permiso-existente pide al menos un permiso de embarque. Usá --permiso.');
    }

    return undefined;
  }

  if (requiresEmptyPermitsExisting(exportType)) {
    throw new InputValidationError(
      `El tipo de exportación ${exportType} (${EXPORT_TYPES[exportType]}) no lleva permisos de embarque: ARCA exige Permiso_existente vacío (error 1550). Quitá --permiso.`,
    );
  }

  if (!input.permitsExisting) {
    throw new InputValidationError(
      'Los permisos de embarque van con --permiso-existente: ARCA necesita saber que el permiso ya existe.',
    );
  }

  return { Permiso: [...new Set(permits)].map((id) => ({ Dst_merc: destinationCountry, Id_permiso: id })) };
}

/**
 * Arma el `Cmp` de `FEXAuthorize` con los datos ya resueltos contra las tablas de ARCA.
 *
 * Los bloques vacios no van: `Permisos` sin permisos (error 1720), `Cmps_asoc` y `Opcionales` sin filas (error 1820
 * el primero). `Actividades`, en cambio, siempre lleva una `Actividad` (error 2100).
 */
export function buildExportPayload(input: ExportVoucherInput, resolution: BuildExportResolution): ExportVoucherPayload {
  const clientName = requireText(input.clientName, 'el nombre del cliente', '--cliente');
  const clientAddress = requireText(input.clientAddress, 'el domicilio del cliente', '--domicilio-cliente');

  if (typeof input.amount !== 'number' || !(input.amount > 0)) {
    throw new InputValidationError('Falta el importe total o no es válido. Usá --monto.');
  }

  const permits = resolvePermits(input, resolution.destinationCountry.code, resolution.exportType);
  /** En servicios y otros ARCA pide el campo vacio; en el resto, `N` sin permisos y `S` con permisos. */
  const permitsExisting: ExportVoucherPayload['Permiso_existente'] = requiresEmptyPermitsExisting(resolution.exportType)
    ? ''
    : input.permitsExisting
      ? 'S'
      : 'N';

  return {
    // Actividades va siempre con una: con el bloque vacio ARCA contesta 2100.
    Actividades: { Actividad: [{ Id: resolution.activity }] },
    CanMisMonExt: resolution.currency.CanMisMonExt,
    Cbte_nro: resolution.voucherNumber,
    Cbte_Tipo: EXPORT_VOUCHER_KIND.arcaType,
    Cliente: clientName,
    Cuit_pais_cliente: resolution.clientCountryCuit,
    Domicilio_cliente: clientAddress,
    Dst_cmp: resolution.destinationCountry.code,
    Fecha_cbte: resolution.voucherDate,
    Fecha_pago: resolution.paymentDate,
    Forma_pago: input.paymentTerms?.trim() || DEFAULT_EXPORT_PAYMENT_TERMS,
    Id: resolution.requestId,
    Id_impositivo: input.clientTaxId?.trim() ?? '',
    Idioma_cbte: resolution.languageId,
    Imp_total: roundAmount(input.amount),
    Incoterms: resolution.incoterm?.code ?? '',
    Incoterms_Ds: input.incotermDescription?.trim() || resolution.incoterm?.name || '',
    Items: { Item: [...resolution.items] },
    Moneda_ctz: resolution.currency.Moneda_ctz,
    Moneda_Id: resolution.currency.Moneda_Id,
    Obs: input.observations?.trim() ?? '',
    Obs_comerciales: input.commercialObservations?.trim() ?? '',
    Permiso_existente: permitsExisting,
    ...(permits ? { Permisos: permits } : {}),
    Punto_vta: resolution.pointOfSale,
    Tipo_expo: resolution.exportType,
  };
}
