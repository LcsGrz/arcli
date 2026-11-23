import {
  addDaysToArcaDate,
  arcaDateToInstant,
  formatArcaDateAsArgentineDate,
  formatDateAsArcaDate,
  lastDayOfArcaMonth,
  minArcaDate,
  parseArgentineDateInputAsArcaDate,
  parseFullArgentineDateAsArcaDate,
} from '../../lib/dates/arca-date';
import { AppError, InputValidationError } from '../../lib/errors/app-error';
import { roundToCents } from '../../lib/numbers/argentine-amount';
import { assertRules } from '../../lib/rules/rules';
import { resolveBillingCurrencyCode } from '../billing/billing.mappers';
import { ARCA_LOCAL_CURRENCY_CODE } from '../billing/currency-codes';
import type { ArcliConfig } from '../config/config.schemas';

import { exportTextLengthError, MAX_EXPORT_ITEM_DESCRIPTION_LENGTH } from './export.items';
import type { ExportRule } from './export.rules';
import {
  BILLS_EXPORT_TYPE,
  DEFAULT_EXPORT_CURRENCY_CODE,
  DEFAULT_EXPORT_LANGUAGE,
  DEFAULT_EXPORT_TYPE,
  EXPORT_TYPE_VALUES,
  EXPORT_TYPES,
  EXPORT_TYPES_WITH_PAYMENT_DATE,
  EXPORT_TYPES_WITHOUT_PERMITS,
  type ExportActivity,
  type ExportAssociatedVoucherPayload,
  type ExportCountry,
  type ExportCountryCuit,
  type ExportCurrencyResolution,
  type ExportIncoterm,
  type ExportItemPayload,
  type ExportQuotation,
  type ExportType,
  type ExportVoucherInput,
  type ExportVoucherKind,
  type ExportVoucherPayload,
  isExportNote,
  MAX_EXPORT_POINT_OF_SALE,
  SERVICES_EXPORT_TYPE,
} from './export.types';

/** Codigo de pais de Argentina en la tabla DST_pais: no es un destino de exportacion. */
const ARGENTINA_COUNTRY_CODE = 200;

/** Forma de pago por defecto: WSFEX la exige y casi todas las exportaciones se cobran por transferencia internacional. */
export const DEFAULT_EXPORT_PAYMENT_TERMS = 'Transferencia Internacional';

/**
 * Las formas de cobro mas comunes de una exportacion, para sugerir en el asistente (TUI-26). ARCA toma `Forma_pago`
 * como texto libre: son sugerencias, cualquier otro texto de hasta 50 caracteres vale igual. La de por defecto va
 * primera.
 */
export const EXPORT_PAYMENT_TERMS_SUGGESTIONS: readonly string[] = [
  DEFAULT_EXPORT_PAYMENT_TERMS,
  'Pago anticipado',
  'Carta de crédito',
  'Cobranza documentaria',
  'Cuenta corriente',
];

/** ARCA no acepta cotizaciones en pesos distintas de 1. */
const LOCAL_EXCHANGE_RATE = 1;

type ExportConfig = Pick<ArcliConfig, 'puntoVentaPorDefecto'>;

export interface BuildExportResolution {
  /** Sin actividad no va el bloque `Actividades` (no es obligatorio; vacio es el error 2100). */
  readonly activity?: number;
  /** Solo en las notas: va en `Cmps_asoc`. */
  readonly associatedVoucher?: ExportAssociatedVoucherPayload;
  /** Sin CUIT del pais la E va solo con el ID impositivo (error 1580). */
  readonly clientCountryCuit?: number;
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
  readonly voucherKind: ExportVoucherKind;
  readonly voucherNumber: number;
}

function requireText(value: string | undefined, description: string, flag: string): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new InputValidationError(`Falta ${description}. Usá ${flag}.`);
  }

  return trimmed;
}

/** La fecha del comprobante, en formato ARCA: por defecto hoy en Argentina. */
export function resolveExportVoucherDate(value: string | undefined, now: Date): string {
  return value?.trim() ? parseArgentineDateInputAsArcaDate(value, now) : formatDateAsArcaDate(now);
}

/**
 * Enero de un año bisiesto: desde ahi se lee cualquier fecha incompleta que exista (`31`, `29/2`). Solo distingue una
 * incompleta de una ilegible; la fecha que sale no se usa.
 */
const READABLE_DATE_REFERENCE = '20240115';

/**
 * Una fecha escrita, para una regla: completa (dd/mm/aaaa) no necesita `today` (yyyymmdd); a la que le falta el mes o el
 * año la completa desde ahi, y sin `today` no se puede resolver (`undefined`). Una ilegible da error siempre.
 */
export function resolveExportRuleDate(value: string, today: string | undefined): string | undefined {
  const full = parseFullArgentineDateAsArcaDate(value);

  if (full) {
    return full;
  }

  const date = parseArgentineDateInputAsArcaDate(value, arcaDateToInstant(today ?? READABLE_DATE_REFERENCE));

  return today ? date : undefined;
}

/** Cuantos dias antes y despues de la fecha de envio acepta ARCA la fecha de la E (1500, WSFEX v3.1.0). */
const EXPORT_DATE_WINDOW_DAYS = 5;

/**
 * La fecha mas temprana que ARCA acepta para la factura o la nota E (1500, WSFEX v3.1.0), la misma ventana que
 * `EXPORT_VOUCHER_DATE_WINDOW_RULE`: hoy - 5 (yyyymmdd).
 */
export function earliestExportVoucherDate(today: string): string {
  return addDaysToArcaDate(today, -EXPORT_DATE_WINDOW_DAYS);
}

/**
 * ARCA 1500 (WSFEX v3.1.0): la fecha de la factura y de las notas E va de hoy - 5 a hoy + 5 (N = fecha de envio) y,
 * en servicios, no puede pasar del mes en curso. Testing lo confirma: +1 aprobada, +6 y -6 rechazadas con el periodo
 * en el mensaje. Una fecha futura vale (por ejemplo, la del embarque del lunes), pero traba el punto de venta: ver
 * `exportFutureDateWarning`. Sin `today` no corre.
 */
export const EXPORT_VOUCHER_DATE_WINDOW_RULE: ExportRule = {
  check: (input, { today }) => {
    if (!today) {
      return undefined;
    }

    const exportType = input.exportType ?? DEFAULT_EXPORT_TYPE;
    const voucherDate = resolveExportVoucherDate(input.voucherDate, arcaDateToInstant(today));
    const from = earliestExportVoucherDate(today);
    const windowEnd = addDaysToArcaDate(today, EXPORT_DATE_WINDOW_DAYS);
    const monthEnd = lastDayOfArcaMonth(today);
    const capsAtMonthEnd = exportType === SERVICES_EXPORT_TYPE && monthEnd < windowEnd;
    const to = capsAtMonthEnd ? monthEnd : windowEnd;

    if (voucherDate >= from && voucherDate <= to) {
      return undefined;
    }

    const range = `del ${formatArcaDateAsArgentineDate(from)} al ${formatArcaDateAsArgentineDate(to)}`;

    return `La fecha del comprobante (${formatArcaDateAsArgentineDate(voucherDate)}) está fuera de lo que acepta ARCA: ${range}, hasta ${EXPORT_DATE_WINDOW_DAYS} días antes o después de hoy${capsAtMonthEnd ? ' y, en servicios, no después del fin de mes' : ''} (error 1500).`;
  },
  fields: ['voucherDate'],
  id: 'export-voucher-date-window',
};

/** El mismo control que `EXPORT_VOUCHER_DATE_WINDOW_RULE`, con las fechas ya resueltas (yyyymmdd). */
export function assertExportVoucherDate(options: {
  readonly exportType: ExportType;
  readonly today: string;
  readonly voucherDate: string;
}): void {
  assertRules(
    [EXPORT_VOUCHER_DATE_WINDOW_RULE],
    { exportType: options.exportType, voucherDate: formatArcaDateAsArgentineDate(options.voucherDate) },
    { today: options.today },
  );
}

/**
 * La cotizacion escrita (`--cotizacion-moneda`): en pesos, 1; en moneda extranjera, mayor a 0 (errores 1600 y 1602,
 * WSFEX v3.1.0). Hay monedas que valen menos de un peso, como el guarani o el peso colombiano, y una nota sobre una
 * factura en esas monedas hereda su cotizacion. Que en pesos tenga que ser 1 es de ARCA: no acepta otra.
 */
export const EXPORT_EXCHANGE_RATE_RULE: ExportRule = {
  check: (input) => {
    const rate = input.exchangeRate;

    if (typeof rate !== 'number') {
      return undefined;
    }

    const requested = input.currencyCode?.trim() || DEFAULT_EXPORT_CURRENCY_CODE;

    if (resolveBillingCurrencyCode(requested) === ARCA_LOCAL_CURRENCY_CODE) {
      return rate === LOCAL_EXCHANGE_RATE
        ? undefined
        : {
            message: 'En pesos la cotización tiene que ser 1. Sacá `--cotizacion-moneda` o usá `--cm 1`.',
            question: 'En pesos la cotización tiene que ser 1.',
          };
    }

    return rate > 0 ? undefined : `La cotización de ${requested.toUpperCase()} tiene que ser mayor a 0.`;
  },
  fields: ['exchangeRate'],
  id: 'export-exchange-rate',
};

/**
 * Acepta `ARS`, `USD` o los codigos de ARCA (`PES`, `DOL`). Sin `--moneda` la exportacion va en dolares; la moneda
 * de la config es la de los comprobantes locales. Sin `--cotizacion-moneda` se usa la de aduana que publica ARCA
 * (WSFEX no acepta `Moneda_ctz` en 0): la clave `cotizacion` de la config no aplica, porque una cotizacion guardada
 * queda vieja en dias (REV-35).
 */
export function resolveExportCurrency(
  input: Pick<ExportVoucherInput, 'currencyCode' | 'exchangeRate' | 'sameCurrency'>,
): ExportCurrencyResolution {
  const requested = input.currencyCode?.trim() || DEFAULT_EXPORT_CURRENCY_CODE;
  const currencyCode = resolveBillingCurrencyCode(requested);

  if (currencyCode === ARCA_LOCAL_CURRENCY_CODE) {
    if (input.sameCurrency) {
      throw new InputValidationError('`--misma-moneda` solo aplica a comprobantes en moneda extranjera.');
    }

    assertRules([EXPORT_EXCHANGE_RATE_RULE], input, {});

    // Con la E en pesos ARCA pide que `CanMisMonExt` no se informe (error 1605): testing lo acepta, produccion no.
    return {
      fields: { Moneda_ctz: LOCAL_EXCHANGE_RATE, Moneda_Id: currencyCode },
      needsQuotation: false,
    };
  }

  const rate = input.exchangeRate;

  assertRules([EXPORT_EXCHANGE_RATE_RULE], input, {});

  return {
    fields: {
      CanMisMonExt: input.sameCurrency ? 'S' : 'N',
      Moneda_ctz: rate ?? 0,
      Moneda_Id: currencyCode,
    },
    needsQuotation: rate === undefined,
  };
}

/** De que dia se pide la cotizacion de aduana y por que. */
export interface ExportQuotationDate {
  /** Fecha ARCA (yyyymmdd) con la que se consulta `FEXGetPARAM_MON_CON_COTIZACION`. */
  readonly date: string;
  /**
   * `previous-business-day`: ARCA exige la del dia habil anterior (servicios, error 2053, o pago en la misma moneda);
   * `voucher-date`: la de la fecha del comprobante, o la ultima publicada antes.
   */
  readonly rule: 'previous-business-day' | 'voucher-date';
}

/**
 * La fecha de la cotizacion que exige ARCA. En la factura de servicios en moneda extranjera tiene que ser la del dia
 * habil anterior a la fecha de emision, o a la de la solicitud si la factura es posterior (error 2053). Con el pago
 * en la misma moneda (`CanMisMonExt` en `S`), lo mismo, por el historial 3.0.0 del manual. Se consulta el dia
 * anterior y WSFEX devuelve la ultima publicada hasta ese dia, que en un lunes o despues de un feriado es la del
 * ultimo dia habil. Las notas heredan la cotizacion del asociado (2053) y bienes y otros siguen con la del dia.
 * Con fecha futura (1500 la acepta hasta 5 dias) no hay cotizacion de ese dia: se toma la de hoy o, en servicios y con
 * `--misma-moneda`, la del dia habil anterior a hoy, como pide el manual (2053 e historial 3.0.0).
 */
export function resolveExportQuotationDate(options: {
  readonly exportType: ExportType;
  readonly isNote: boolean;
  readonly sameCurrency: boolean;
  readonly today: string;
  readonly voucherDate: string;
}): ExportQuotationDate {
  const { exportType, isNote, sameCurrency, today, voucherDate } = options;
  const reference = minArcaDate(voucherDate, today);

  if (isNote || (exportType !== SERVICES_EXPORT_TYPE && !sameCurrency)) {
    return { date: reference, rule: 'voucher-date' };
  }

  return { date: addDaysToArcaDate(reference, -1), rule: 'previous-business-day' };
}

/**
 * La cotizacion de aduana de la fecha del comprobante. WSFEX devuelve por moneda la ultima publicada, asi que el
 * dia en curso —que todavia no tiene— o un fin de semana traen la anterior. Sin fila para la moneda no hay
 * cotizacion que usar: es error, salvo que el usuario la informe con `--cotizacion-moneda`.
 */
export function resolveExportQuotation(
  currencyCode: string,
  quotations: readonly ExportQuotation[],
  voucherDate: string,
): ExportQuotation {
  const code = currencyCode.trim().toUpperCase();
  const quotation = quotations.find((entry) => entry.code.trim().toUpperCase() === code);

  if (quotation) {
    return quotation;
  }

  const available = quotations.map((entry) => entry.code).join(', ');

  throw new AppError(
    `ARCA no informó la cotización de ${code} para el ${formatArcaDateAsArgentineDate(voucherDate)}.${
      available ? ` Las monedas con cotización son ${available}.` : ''
    } Informá la cotización con --cotizacion-moneda.`,
    { code: 'ARCA_QUOTATION_ERROR' },
  );
}

/**
 * La actividad es opcional (`Actividades` no es obligatorio en WSFEX v3.1.0; la 2100 solo prohibe el bloque vacio),
 * pero si se informa, ARCA solo acepta los codigos de su propia tabla, que no es la del padron y es mas chica (error
 * 2105 al emitir). Sale de `--actividad` o de `exportacion.actividad`: no hay default. Los nombres de la tabla llegan
 * con la codificacion rota, por eso los mensajes solo dan codigos.
 */
/**
 * El aviso de una tabla de WSFEX que ARCA devolvio vacia: el dato no se pudo validar y va como se escribio
 * (`resolveExportActivity`, `resolveExportIncoterm`). Si esta mal, lo rechaza ARCA al emitir.
 */
export function exportEmptyTableWarning(table: 'actividades' | 'incoterms', value: number | string): string {
  return `ARCA devolvió vacía la tabla de ${table} de WSFEX: ${value} va sin validar y, si no es válido, ARCA lo rechaza al emitir.`;
}

/**
 * Lo que tiene de malo una actividad contra la tabla de WSFEX (error 2105), con el texto del CLI y el del asistente
 * (`question`, sin el flag), o `undefined` si esta o si ARCA devolvio la tabla vacia. Es la misma regla para `arcli fe`
 * (`resolveExportActivity`) y para las preguntas de la actividad de "Emitir factura E" y "Repetir" E (REV-74, #11).
 */
export function exportActivityProblem(
  value: number,
  activities: readonly ExportActivity[] = [],
): { readonly message: string; readonly question: string } | undefined {
  if (activities.length === 0 || activities.some((activity) => activity.id === value)) {
    return undefined;
  }

  const prefix = String(value).slice(0, 3);
  const family = activities.filter((activity) => String(activity.id).startsWith(prefix)).slice(0, 5);
  const candidates =
    family.length > 0 ? ` Las que empiezan con ${prefix} son ${family.map((activity) => activity.id).join(', ')}.` : '';
  const problem = `La actividad ${value} no está en la tabla de actividades de WSFEX y ARCA la rechaza (error 2105).${candidates}`;

  return { message: `${problem} Indicá la que corresponda con \`--actividad\`.`, question: problem };
}

export function resolveExportActivity(value: number, activities: readonly ExportActivity[] = []): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new InputValidationError('La actividad tiene que ser un número entero positivo. Usá `--actividad`.');
  }

  const problem = exportActivityProblem(value, activities);

  if (problem) {
    throw new InputValidationError(problem.message);
  }

  return value;
}

export function resolveExportType(value: ExportType | undefined): ExportType {
  if (value === undefined) {
    return DEFAULT_EXPORT_TYPE;
  }

  if (!EXPORT_TYPE_VALUES.includes(value)) {
    throw new InputValidationError(
      '`--tipo-expo` tiene que ser 1 (exportación definitiva de bienes), 2 (servicios) o 4 (otros).',
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
  const trimmed = requireText(value, 'el país de destino', '`--pais-destino`');
  const numeric = /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
  const country = numeric
    ? countries.find((entry) => entry.code === numeric)
    : countries.find((entry) => entry.name.trim().toLowerCase() === trimmed.toLowerCase());

  if (!country) {
    throw new InputValidationError(
      `El país de destino "${trimmed}" no existe en la tabla de ARCA. Usá el código o el nombre que informa ARCA.`,
    );
  }

  // Propia: WSFEX v3.1.0 no tiene ese control y ARCA testing aprueba una E con destino 200 (TEST-8).
  if (country.code === ARGENTINA_COUNTRY_CODE) {
    throw new InputValidationError(
      'Argentina no es un destino de exportación: usá `arcli factura a` o `arcli factura b`.',
    );
  }

  return country;
}

/** Los destinos que acepta `--pais-destino` (`resolveExportDestinationCountry`): la tabla de ARCA sin Argentina. */
export function exportDestinationCountryChoices(countries: readonly ExportCountry[]): ExportCountry[] {
  return countries.filter((country) => country.code !== ARGENTINA_COUNTRY_CODE);
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

/** Las filas de la tabla DST_CUIT del destino (una por tipo de entidad), comparando sin el tipo de entidad. */
function countryCuitsOfDestination(
  country: ExportCountry,
  countries: readonly ExportCountryCuit[],
): ExportCountryCuit[] {
  const destination = normalizeCountryName(country.name);

  return countries.filter((entry) => normalizeCountryName(countryNameWithoutEntity(entry.countryName)) === destination);
}

/** El orden de `COUNTRY_CUIT_ENTITY_PREFERENCE`: persona juridica, otro tipo de entidad y persona fisica. */
function entityRank(entry: ExportCountryCuit): number {
  const rank = COUNTRY_CUIT_ENTITY_PREFERENCE.findIndex((preference) => preference.test(entry.countryName));

  return rank === -1 ? COUNTRY_CUIT_ENTITY_PREFERENCE.length : rank;
}

/**
 * Los CUIT de pais que acepta `--cuit-pais` para el destino (`resolveExportClientCountryCuit`): los del destino si la
 * tabla de ARCA los trae, con el que eligiria el flag primero (`pickCountryCuit`), y si no, cualquiera de la tabla, en
 * su orden.
 */
export function exportClientCountryCuitChoices(options: {
  readonly country: ExportCountry;
  readonly countries: readonly ExportCountryCuit[];
}): ExportCountryCuit[] {
  const forDestination = countryCuitsOfDestination(options.country, options.countries);

  return forDestination.length > 0
    ? forDestination.toSorted((left, right) => entityRank(left) - entityRank(right))
    : [...options.countries];
}

/**
 * WSFEX pide el CUIT del pais del cliente o su ID impositivo: con uno alcanza (error 1580). Se resuelve con la tabla DST_CUIT, que nombra cada pais con el tipo de
 * entidad ("ESTADOS UNIDOS - Persona Jurídica"), mientras que la tabla de destinos dice solo "ESTADOS UNIDOS": por
 * eso se compara sin el sufijo. Si el CUIT viene por flag se valida contra la tabla, salvo para los paises cuyo
 * nombre no coincide entre las dos tablas ("CHINA" y "CHINA REP.POPULAR"), donde solo se acepta que exista. Si la
 * tabla no trae el destino y no vino por flag, no hay CUIT: la E va solo con el ID impositivo (ver
 * `assertExportClientIdentification`).
 */
export function resolveExportClientCountryCuit(options: {
  readonly country: ExportCountry;
  readonly countries: readonly ExportCountryCuit[];
  readonly cuit?: number;
}): number | undefined {
  const destination = normalizeCountryName(options.country.name);
  const forDestination = countryCuitsOfDestination(options.country, options.countries);

  if (options.cuit === undefined) {
    return pickCountryCuit(forDestination)?.cuit;
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

/**
 * ARCA pide el CUIT del pais del cliente o su ID impositivo, al menos uno (error 1580). Sin CUIT (la tabla no trae el
 * destino, como pasa con Irlanda, Alemania o las zonas francas) la E va solo con el ID impositivo.
 */
export function assertExportClientIdentification(options: {
  readonly clientCountryCuit?: number;
  readonly clientTaxId?: string;
  readonly country: ExportCountry;
}): void {
  if (options.clientCountryCuit === undefined && !options.clientTaxId?.trim()) {
    throw new InputValidationError(
      `La tabla de ARCA no tiene CUIT para "${options.country.name}" y ARCA pide el CUIT del país o el ID impositivo del cliente (error 1580). Indicá el ID impositivo con \`--id-impositivo\` o el CUIT del país con \`--cuit-pais\`.`,
    );
  }
}

/**
 * Los textos de la E con su largo maximo en WSFEX v3.1.0: el codigo de control, si el manual lo da, y el flag.
 *
 * @internal Exportado para los tests.
 */
export const EXPORT_TEXT_LIMITS = {
  clientAddress: { code: 1661, flag: '--domicilio-cliente', label: 'El domicilio del cliente', max: 300 },
  clientName: { code: 1651, flag: '--cliente', label: 'El nombre del cliente', max: 200 },
  // Tabla de campos: `ID_impositivo` String (C50), sin codigo de control.
  clientTaxId: { code: undefined, flag: '--id-impositivo', label: 'El ID impositivo del cliente', max: 50 },
  commercialObservations: {
    code: 1665,
    flag: '--obs-comerciales',
    label: 'Las observaciones comerciales',
    max: 4000,
  },
  // Sin `--item`, la descripcion es el `Pro_ds` del unico renglon.
  description: { code: 1770, flag: '--descripcion', label: 'La descripción', max: MAX_EXPORT_ITEM_DESCRIPTION_LENGTH },
  incotermDescription: { code: 1642, flag: '--incoterms-desc', label: 'La descripción del incoterm', max: 20 },
  observations: { code: 1665, flag: '--observaciones', label: 'Las observaciones', max: 1000 },
  // Tabla de campos: `Forma_pago` String (C50), sin codigo de control.
  paymentTerms: { code: undefined, flag: '--forma-pago', label: 'La forma de pago', max: 50 },
} as const;

export type ExportTextField = keyof typeof EXPORT_TEXT_LIMITS;

/** El error de largo de un texto de la E, para el CLI y el asistente; `undefined` si entra. */
export function exportTextFieldError(field: ExportTextField, value: string | undefined): string | undefined {
  const limit = EXPORT_TEXT_LIMITS[field];

  return exportTextLengthError({ code: limit.code, label: limit.label, max: limit.max, value });
}

/** Los largos maximos de los textos de la E (1642, 1651, 1661, 1665, 1770 y la tabla de campos), antes de ir a ARCA. */
export function assertExportTextLengths(input: ExportVoucherInput): void {
  for (const field of Object.keys(EXPORT_TEXT_LIMITS) as ExportTextField[]) {
    const error = exportTextFieldError(field, input[field]);

    if (error) {
      throw new InputValidationError(`${error} Acortá \`${EXPORT_TEXT_LIMITS[field].flag}\`.`);
    }
  }
}

/**
 * El incoterm de la E (WSFEX v3.1.0): obligatorio en la factura de bienes (1640) y la descripcion solo con incoterm
 * (1641). En las notas el incoterm puede venir del asociado.
 */
export function assertExportIncoterm(options: {
  readonly exportType: ExportType;
  readonly incoterm?: string;
  readonly incotermDescription?: string;
  readonly isNote: boolean;
}): void {
  const hasIncoterm = Boolean(options.incoterm?.trim());

  if (!options.isNote && options.exportType === BILLS_EXPORT_TYPE && !hasIncoterm) {
    throw new InputValidationError(
      'La factura E de bienes (`--tipo-expo 1`) lleva incoterm: ARCA lo exige (error 1640). Usá `--incoterm`, por ejemplo `FOB`.',
    );
  }

  if (options.incotermDescription?.trim() && !hasIncoterm) {
    throw new InputValidationError(
      '`--incoterms-desc` va con un incoterm: ARCA rechaza la descripción sola (error 1641). Sumá `--incoterm` o sacá `--incoterms-desc`.',
    );
  }
}

/**
 * `--incoterm` se compara contra la tabla de ARCA, sin importar mayusculas. Si ARCA la devuelve vacia no se valida
 * (como la actividad): va el codigo escrito, que tambien es la descripcion por defecto, y el servicio avisa.
 */
export function resolveExportIncoterm(
  value: string | undefined,
  incoterms: readonly ExportIncoterm[],
): ExportIncoterm | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (incoterms.length === 0) {
    return { code: trimmed.toUpperCase(), name: trimmed.toUpperCase() };
  }

  const incoterm = incoterms.find((entry) => entry.code.trim().toUpperCase() === trimmed.toUpperCase());

  if (!incoterm) {
    throw new InputValidationError(
      `El incoterm "${trimmed}" no existe en la tabla de ARCA. Consultá los válidos con \`arcli parametros\`.`,
    );
  }

  return incoterm;
}

/** 1510 (WSFEX v3.1.0): el punto de venta de la E va de 1 a 99.998. */
export function assertExportPointOfSaleRange(pointOfSale: number, label: string): void {
  if (pointOfSale > MAX_EXPORT_POINT_OF_SALE) {
    throw new InputValidationError(
      `${label} de la E va de 1 a ${MAX_EXPORT_POINT_OF_SALE}: ARCA rechaza ${pointOfSale} (error 1510).`,
    );
  }
}

export function resolveExportPointOfSale(value: number | undefined, config: ExportConfig): number {
  const pointOfSale = value ?? config.puntoVentaPorDefecto;

  if (pointOfSale === undefined) {
    throw new InputValidationError(
      'Falta el punto de venta. Usá `--pv <numero>` o configuralo con `arcli config establecer puntoVenta <numero>`.',
    );
  }

  if (!Number.isInteger(pointOfSale) || pointOfSale < 1) {
    throw new InputValidationError('El punto de venta tiene que ser un número entero positivo.');
  }

  assertExportPointOfSaleRange(pointOfSale, 'El punto de venta');

  return pointOfSale;
}

/**
 * Numero del comprobante o de la solicitud: el indicado por el usuario o el que sigue al ultimo de ARCA, hasta `max`
 * (el comprobante, 99.999.999 por la 1520; la solicitud, 15 digitos).
 */
export function resolveExportNumber(options: {
  /** El control de ARCA que fija el tope, si el manual lo da. */
  readonly code?: number;
  readonly label: string;
  readonly last: number;
  readonly max: number;
  readonly provided?: number;
}): number {
  const value = options.provided ?? (Number.isFinite(options.last) ? options.last : 0) + 1;

  if (options.provided !== undefined && (!Number.isInteger(options.provided) || options.provided < 1)) {
    throw new InputValidationError(`${options.label} tiene que ser un número entero positivo.`);
  }

  if (value > options.max) {
    throw new InputValidationError(
      `${options.label} supera el máximo de ARCA (${options.max})${options.code === undefined ? '' : ` y ARCA lo rechaza (error ${options.code})`}.`,
    );
  }

  return value;
}

/** En los tipos 2 (servicios) y 4 (otros) ARCA exige `Permiso_existente` vacio, no `N` (error 1550, WSFEX v3.1.0). */
function requiresEmptyPermitsExisting(exportType: ExportType): boolean {
  return EXPORT_TYPES_WITHOUT_PERMITS.includes(exportType);
}

/**
 * Con `Permiso_existente = N` ARCA rechaza el campo `Permisos` (error 1720), y en los tipos 2 y 4 pide el campo
 * vacio y no admite permisos (error 1550): sin permisos no se manda. En las notas de bienes los permisos son
 * opcionales y van con `Permiso_existente` vacio (tabla de la 1720), asi que no piden `--permiso-existente`.
 */
function resolvePermits(
  input: ExportVoucherInput,
  destinationCountry: number,
  exportType: ExportType,
  isNote: boolean,
): ExportVoucherPayload['Permisos'] {
  const permits = (input.permits ?? []).map((permit) => permit.trim()).filter(Boolean);

  if (permits.length === 0) {
    if (input.permitsExisting) {
      throw new InputValidationError('`--permiso-existente` pide al menos un permiso de embarque. Usá `--permiso`.');
    }

    return undefined;
  }

  if (requiresEmptyPermitsExisting(exportType)) {
    throw new InputValidationError(
      `El tipo de exportación ${exportType} (${EXPORT_TYPES[exportType]}) no lleva permisos de embarque: ARCA exige Permiso_existente vacío (error 1550). Quitá \`--permiso\`.`,
    );
  }

  if (!isNote && !input.permitsExisting) {
    throw new InputValidationError(
      'Los permisos de embarque van con `--permiso-existente`: ARCA necesita saber que el permiso ya existe.',
    );
  }

  return { Permiso: [...new Set(permits)].map((id) => ({ Dst_merc: destinationCountry, Id_permiso: id })) };
}

/**
 * `Fecha_pago` va solo en la factura de servicios u otros (1672): en las notas ARCA la rechaza (1673, WSFEX v3.1.0) y en
 * bienes tambien, aunque el manual no lo diga (visto en testing, #204).
 */
export function exportTypeTakesPaymentDate(exportType: ExportType, isNote: boolean): boolean {
  return !isNote && EXPORT_TYPES_WITH_PAYMENT_DATE.includes(exportType);
}

/**
 * Arma el `Cmp` de `FEXAuthorize` con los datos ya resueltos contra las tablas de ARCA.
 *
 * Los bloques vacios no van: `Permisos` sin permisos (error 1720), `Cmps_asoc` y `Opcionales` sin filas (error 1820
 * el primero), y `Actividades` sin actividad (error 2100). Las notas llevan `Cmps_asoc` y
 * `Permiso_existente` vacio (1550), y no llevan `Fecha_pago` (1673) ni `CanMisMonExt` (1605). La factura de bienes
 * tampoco lleva `Fecha_pago` (1673): solo va en servicios y otros. La factura en pesos no lleva `CanMisMonExt` (1605).
 */
export function buildExportPayload(input: ExportVoucherInput, resolution: BuildExportResolution): ExportVoucherPayload {
  const clientName = requireText(input.clientName, 'el nombre del cliente', '`--cliente`');
  const clientAddress = requireText(input.clientAddress, 'el domicilio del cliente', '`--domicilio-cliente`');

  if (typeof input.amount !== 'number' || !(input.amount > 0)) {
    throw new InputValidationError('Falta el importe total o no es válido. Usá `--monto`.');
  }

  const isNote = isExportNote(resolution.voucherKind);

  // 2047 (WSFEX v3.1.0): el asociado solo es obligatorio en las notas de servicios.
  if (isNote && !resolution.associatedVoucher && resolution.exportType === SERVICES_EXPORT_TYPE) {
    throw new InputValidationError('Falta el comprobante asociado de la nota de servicios (error 2047). Usá `--ar`.');
  }

  const permits = resolvePermits(input, resolution.destinationCountry.code, resolution.exportType, isNote);
  /** En notas, servicios y otros ARCA pide el campo vacio; en el resto, `N` sin permisos y `S` con permisos. */
  const permitsExisting: ExportVoucherPayload['Permiso_existente'] =
    isNote || requiresEmptyPermitsExisting(resolution.exportType) ? '' : input.permitsExisting ? 'S' : 'N';

  return {
    // Sin actividad el bloque no va: vacio, ARCA contesta 2100.
    ...(resolution.activity === undefined ? {} : { Actividades: { Actividad: [{ Id: resolution.activity }] } }),
    ...(isNote || !resolution.currency.CanMisMonExt ? {} : { CanMisMonExt: resolution.currency.CanMisMonExt }),
    Cbte_nro: resolution.voucherNumber,
    Cbte_Tipo: resolution.voucherKind.arcaType,
    Cliente: clientName,
    ...(resolution.associatedVoucher ? { Cmps_asoc: { Cmp_asoc: [resolution.associatedVoucher] } } : {}),
    ...(resolution.clientCountryCuit === undefined ? {} : { Cuit_pais_cliente: resolution.clientCountryCuit }),
    Domicilio_cliente: clientAddress,
    Dst_cmp: resolution.destinationCountry.code,
    Fecha_cbte: resolution.voucherDate,
    ...(exportTypeTakesPaymentDate(resolution.exportType, isNote) ? { Fecha_pago: resolution.paymentDate } : {}),
    Forma_pago: input.paymentTerms?.trim() || DEFAULT_EXPORT_PAYMENT_TERMS,
    Id: resolution.requestId,
    Id_impositivo: input.clientTaxId?.trim() ?? '',
    Idioma_cbte: resolution.languageId,
    Imp_total: roundToCents(input.amount),
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
