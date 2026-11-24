import {
  addDaysToArcaDate,
  formatArcaDateAsArgentineDate,
  formatDateAsArcaDate,
  parseArgentineDateInputAsArcaDate,
} from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { AMOUNT_DECIMALS, formatExchangeRate, hasAtMostDecimals } from '../../lib/numbers/argentine-amount';
import { assertRules } from '../../lib/rules/rules';
import type { Clock } from '../../lib/time/clock';
import {
  assertCurrencyInTable,
  describeExchangeRateRange,
  isExchangeRateInRange,
  officialExchangeRateWarning,
} from '../billing/billing.currency';
import { futureDateWarnings } from '../billing/billing.dates';
import { EmissionUncertainError } from '../billing/billing.errors';
import { ARCA_LOCAL_CURRENCY_CODE } from '../billing/currency-codes';
import { formatNextVouchers } from '../billing/voucher-names';
import type { ArcliConfig } from '../config/config.schemas';

import {
  assertExportItemsTotal,
  assertExportItemTexts,
  buildExportItems,
  DEFAULT_EXPORT_ITEM_DESCRIPTION,
} from './export.items';
import {
  assertExportClientIdentification,
  assertExportIncoterm,
  assertExportTextLengths,
  buildExportPayload,
  exportEmptyTableWarning,
  type ExportQuotationDate,
  exportTypeTakesPaymentDate,
  resolveExportActivity,
  resolveExportClientCountryCuit,
  resolveExportCurrency,
  resolveExportDestinationCountry,
  resolveExportIncoterm,
  resolveExportLanguage,
  resolveExportNumber,
  resolveExportPointOfSale,
  resolveExportQuotation,
  resolveExportQuotationDate,
  resolveExportType,
  resolveExportVoucherDate,
} from './export.mappers';
import {
  applyExportAssociatedDefaults,
  assertExportNoteFields,
  assertExportNoteMatchesAssociated,
  exportAssociatedVoucherWarnings,
  exportNoteHasAssociated,
  fetchExportAssociatedVoucher,
  missingExportAssociatedVoucherError,
  resolveExportAssociatedQuery,
} from './export.notes';
import { checkExportPermits } from './export.permits';
import { createDryRunExportResponse, mapExportResponse } from './export.response';
import { EXPORT_DATE_RULES } from './export.rules';
import { describeQueryFailure, readExportTable, unreadExportTableWarnings } from './export.tables';
import {
  DEFAULT_EXPORT_UNIT_CODE,
  EXPORT_VOUCHER_KIND,
  type ExportAssociatedVoucherPayload,
  type ExportDisplayInfo,
  type ExportEmissionGateway,
  type ExportExecutionResult,
  type ExportIssuedVoucher,
  type ExportPreviewGateway,
  type ExportQuotation,
  type ExportResponseSummary,
  type ExportType,
  type ExportVoucherInput,
  type ExportVoucherKind,
  getExportVoucherKindByArcaType,
  isExportNote,
  MAX_EXPORT_REQUEST_ID,
  MAX_EXPORT_VOUCHER_NUMBER,
  type ResolvedExportVoucher,
  SERVICES_EXPORT_TYPE,
} from './export.types';

export interface ExportRuntime {
  readonly config: ArcliConfig;
  /** El CUIT emisor del perfil. */
  readonly cuit: number;
  readonly environment: 'produccion' | 'testing';
}

/**
 * Lo que hay que validar antes de tocar la red: un flag que falta no tiene por que autenticar en WSAA. En las notas,
 * cliente, domicilio, destino y actividad pueden salir del asociado, asi que se validan despues de consultarlo.
 */
function assertLocalFields(input: ExportVoucherInput, kind: ExportVoucherKind): void {
  if (typeof input.amount !== 'number' || !(input.amount > 0)) {
    throw new InputValidationError('Falta el monto total o no es válido. Usá `--monto`.');
  }

  // Como en A, B y C: con mas decimales se redondearia en silencio y el total no coincidiria con el item.
  if (!hasAtMostDecimals(input.amount, AMOUNT_DECIMALS)) {
    throw new InputValidationError(`El monto total no puede tener más de ${AMOUNT_DECIMALS} decimales.`);
  }

  if (isExportNote(kind)) {
    assertExportNoteFields(input, kind);
  }

  assertExportTextLengths(input);
  assertExportItemTexts(input.items);
  assertExportItemsTotal(input.items, input.amount);
}

/**
 * En la factura de servicios en moneda extranjera ARCA exige exactamente la cotizacion de aduana del dia habil anterior
 * (2053, WSFEX v3.1.0), y con `--misma-moneda`, la oficial de ese dia (historial 3.0.0 y 1604). Una
 * `--cotizacion-moneda` distinta sale rechazada: se compara con la de ARCA y se frena antes. Si ARCA no informa la
 * moneda, no hay contra que comparar y sigue.
 */
function assertExportExchangeRateMatches(options: {
  readonly exportType: ExportType;
  readonly given: number;
  readonly official: ExportQuotation | undefined;
}): void {
  const { given, official } = options;

  if (!official || official.rate === given) {
    return;
  }

  const subject =
    options.exportType === SERVICES_EXPORT_TYPE
      ? 'En servicios ARCA exige la cotización de aduana'
      : 'Con `--misma-moneda` ARCA exige la cotización oficial';
  const code = options.exportType === SERVICES_EXPORT_TYPE ? 2053 : 1604;
  const day = official.date ? ` del ${formatArcaDateAsArgentineDate(official.date)}` : '';

  throw new InputValidationError(
    `${subject} de ${official.code} del día hábil anterior, ${formatExchangeRate(official.rate)}${day}, y \`--cotizacion-moneda\` es ${formatExchangeRate(given)}: ARCA la rechaza (error ${code}). Sacá \`--cotizacion-moneda\` y ARCLI usa la de ARCA.`,
  );
}

/**
 * Lo que pide la factura (y la nota, ya completada con su asociado) antes de consultar las tablas. La actividad no:
 * `Actividades` no es obligatorio en WSFEX v3.1.0 (la 2100 solo prohibe el bloque vacio).
 */
function assertRequiredFields(input: ExportVoucherInput): void {
  if (!input.clientName?.trim()) {
    throw new InputValidationError('Falta el nombre del cliente. Usá `--cliente`.');
  }

  if (!input.clientAddress?.trim()) {
    throw new InputValidationError('Falta el domicilio del cliente. Usá `--domicilio-cliente`.');
  }

  if (!input.destinationCountry?.trim()) {
    throw new InputValidationError('Falta el país de destino. Usá `--pais-destino`.');
  }
}

interface ResolvedAssociatedVoucher {
  readonly payload: ExportAssociatedVoucherPayload;
  readonly voucher: ExportIssuedVoucher;
}

/** Consulta en ARCA el comprobante que ajusta la nota. Es una lectura: no emite nada. */
async function fetchAssociated(
  input: ExportVoucherInput,
  gateway: ExportPreviewGateway,
  runtime: ExportRuntime,
  kind: ExportVoucherKind,
): Promise<ResolvedAssociatedVoucher> {
  const query = resolveExportAssociatedQuery({
    emitterCuit: runtime.cuit,
    input: input.associatedVoucher,
    kind,
    pointOfSale: resolveExportPointOfSale(input.pointOfSale, runtime.config),
  });
  const voucher = await fetchExportAssociatedVoucher(gateway, query);

  if (!voucher) {
    throw missingExportAssociatedVoucherError(query);
  }

  return {
    payload: {
      Cbte_cuit: runtime.cuit,
      Cbte_nro: query.number,
      Cbte_punto_vta: query.pointOfSale,
      Cbte_tipo: query.arcaType,
    },
    voucher,
  };
}

/**
 * De donde salio la cotizacion sin `--cotizacion-moneda`. En servicios y con el pago en la misma moneda es obligatoria
 * la del dia habil anterior, asi que solo se avisa si ese dia no hubo (un fin de semana o un feriado) y va la ultima
 * que publico ARCA. En el resto es un default y se avisa siempre, como en A, B y C: con el dia, si ARCA no publico la
 * del dia que se pidio.
 */
function exportQuotationWarnings(options: {
  readonly currencyCode: string;
  readonly exportType: ExportType;
  readonly quotation: ExportQuotation;
  readonly quotationDate: ExportQuotationDate;
  readonly voucherDate: string;
}): string[] {
  const { currencyCode, exportType, quotation, quotationDate, voucherDate } = options;
  const asked = formatArcaDateAsArgentineDate(quotationDate.date);
  const otherDay =
    quotation.date && quotation.date !== quotationDate.date ? formatArcaDateAsArgentineDate(quotation.date) : undefined;

  if (quotationDate.rule === 'voucher-date') {
    return [
      officialExchangeRateWarning({
        code: currencyCode,
        detail: otherDay ? `, la de aduana del ${otherDay}: ARCA no publicó la del ${asked}` : ', la de aduana',
        rate: quotation.rate,
      }),
    ];
  }

  if (!otherDay) {
    return [];
  }

  const subject = exportType === SERVICES_EXPORT_TYPE ? 'En servicios' : 'Con `--misma-moneda`';
  const used = `la del ${otherDay} (${formatExchangeRate(quotation.rate)})`;

  return [
    `${subject} ARCA exige la cotización de ${quotation.code} del día hábil anterior a ${quotationDate.date < addDaysToArcaDate(voucherDate, -1) ? 'hoy, porque la fecha del comprobante es futura' : 'la fecha del comprobante'} (error 2053): se usa ${used}, la última que publicó hasta el ${asked}.`,
  ];
}

/**
 * 1667 (WSFEX v3.1.0, p. 19), solo en la factura: la cotizacion va "entre el 2% y el 400% de la oficial" (citado en TEST-8), y no hasta
 * "superior en un 400%" como la 10119: por eso no comparte su maximo. Solo avisa: en testing no se puede probar, porque
 * sus cotizaciones son ficticias.
 */
const EXPORT_EXCHANGE_RATE_LIMITS = { maxRatio: 4, minRatio: 0.02 } as const;

/**
 * Lo que tiene la cotizacion escrita contra la oficial. En servicios y con `--misma-moneda` tiene que ser la de ARCA y
 * frena; en bienes y otros avisa si esta fuera de rango. Si ARCA no la informa, decide al emitir.
 */
async function checkWrittenExchangeRate(options: {
  readonly code: string;
  readonly exportType: ExportType;
  readonly gateway: Pick<ExportPreviewGateway, 'getQuotations'>;
  readonly quotationDate: ExportQuotationDate;
  readonly rate: number;
}): Promise<string[]> {
  const { exportType, gateway, quotationDate, rate } = options;
  const code = options.code.trim().toUpperCase();
  const table = await readExportTable(() => gateway.getQuotations(quotationDate.date));
  const official = table.rows.find((entry) => entry.code.trim().toUpperCase() === code);

  if (quotationDate.rule === 'previous-business-day') {
    assertExportExchangeRateMatches({ exportType, given: rate, official });

    return table.ok
      ? []
      : [
          `No se pudo comparar la cotización con la de ARCA (${describeQueryFailure(table.error)}): la rechaza si no es la oficial del día hábil anterior (error ${exportType === SERVICES_EXPORT_TYPE ? 2053 : 1604}).`,
        ];
  }

  return official && !isExchangeRateInRange(rate, official.rate, EXPORT_EXCHANGE_RATE_LIMITS)
    ? [
        `${describeExchangeRateRange({ code, limits: EXPORT_EXCHANGE_RATE_LIMITS, official: official.rate, rate, source: 'lo que dice el manual de ARCA' })} ARCA la puede rechazar (error 1667): revisá \`--cm\`.`,
      ]
    : [];
}

/** Las unidades escritas por codigo, que hay que validar (la de por defecto no), para su aviso. */
function describeWrittenUnits(input: ExportVoucherInput): string | undefined {
  const codes = new Set((input.items ?? []).map(({ unit }) => unit ?? DEFAULT_EXPORT_UNIT_CODE));

  codes.delete(DEFAULT_EXPORT_UNIT_CODE);

  return codes.size > 0 ? `${codes.size === 1 ? 'la unidad' : 'las unidades'} ${[...codes].join(', ')}` : undefined;
}

function describeAssociated(voucher: ExportIssuedVoucher): ExportDisplayInfo['associatedVoucher'] {
  return {
    currencyCode: voucher.currencyCode,
    date: voucher.date,
    displayName:
      getExportVoucherKindByArcaType(voucher.arcaType)?.displayName ?? `Comprobante tipo ${voucher.arcaType}`,
    total: voucher.total,
  };
}

export interface ExportServiceOptions {
  readonly clock: Clock;
}

export class ExportService {
  private readonly clock: Clock;

  public constructor(options: ExportServiceOptions) {
    this.clock = options.clock;
  }

  /**
   * Resuelve todo lo que pide WSFEX antes de emitir: tablas de paises, incoterms, idiomas y unidades,
   * numeracion y cotizacion. Son llamadas de lectura: no emiten nada.
   */
  public async resolve(
    rawInput: ExportVoucherInput,
    gateway: ExportPreviewGateway,
    runtime: ExportRuntime,
  ): Promise<ResolvedExportVoucher> {
    const now = this.clock.now();
    const today = formatDateAsArcaDate(now);
    const config = runtime.config;
    const voucherKind = rawInput.voucherKind ?? EXPORT_VOUCHER_KIND;

    assertLocalFields(rawInput, voucherKind);

    // La nota completa con su asociado lo que no vino por flag: cliente, destino, moneda, cotizacion, tipo.
    // Sin asociado (solo en notas de bienes y otros, 2047) la nota lleva todo por flag.
    const associated =
      isExportNote(voucherKind) && exportNoteHasAssociated(rawInput, voucherKind)
        ? await fetchAssociated(rawInput, gateway, runtime, voucherKind)
        : undefined;
    const input = associated ? applyExportAssociatedDefaults(rawInput, associated.voucher) : rawInput;
    const activityCode = input.activity ?? config.exportacion?.actividad;

    assertRequiredFields(input);

    const exportType = resolveExportType(input.exportType);
    const voucherDate = resolveExportVoucherDate(input.voucherDate, now);
    const paymentDate = input.paymentDate?.trim()
      ? parseArgentineDateInputAsArcaDate(input.paymentDate, now)
      : voucherDate;

    // 1500 y 1674, con las fechas ya resueltas: las mismas reglas que el asistente al preguntarlas.
    assertRules(
      EXPORT_DATE_RULES,
      {
        exportType,
        paymentDate: formatArcaDateAsArgentineDate(paymentDate),
        voucherDate: formatArcaDateAsArgentineDate(voucherDate),
        voucherKind,
      },
      { today },
    );
    assertExportIncoterm({
      exportType,
      incoterm: input.incoterm,
      incotermDescription: input.incotermDescription,
      isNote: isExportNote(voucherKind),
    });

    // La ultima de las locales, antes de consultar las tablas (ERR-11). En una nota con asociado ya se valido al buscarlo.
    const pointOfSale = resolveExportPointOfSale(input.pointOfSale, config);

    // Siempre hace falta, tambien con el pais por codigo: el CUIT del pais se compara con su nombre.
    const countryList = await gateway.getDestinationCountries();
    const destinationCountry = resolveExportDestinationCountry(input.destinationCountry, countryList);
    // El mismo destino que el asociado, escrito por nombre: recien con la tabla se sabe.
    const associatedCuit =
      associated?.voucher.destinationCountry === destinationCountry.code
        ? associated.voucher.clientCountryCuit
        : undefined;
    const givenCountryCuit = input.clientCountryCuit ?? associatedCuit;

    // Sin escribirlo, el CUIT del pais sale de la tabla.
    const countryCuitTable = await readExportTable(() => gateway.getDestinationCountryCuits(), {
      required: givenCountryCuit === undefined,
    });
    const countryCuits = countryCuitTable.rows;
    const clientCountryCuit = countryCuitTable.ok
      ? resolveExportClientCountryCuit({
          country: destinationCountry,
          countries: countryCuits,
          cuit: givenCountryCuit,
        })
      : givenCountryCuit;

    assertExportClientIdentification({
      clientCountryCuit,
      clientTaxId: input.clientTaxId,
      country: destinationCountry,
    });

    // Una unidad escrita por nombre sale de la tabla.
    const unitTable = await readExportTable(() => gateway.getUnits(), {
      required: input.items?.some(({ unit }) => typeof unit === 'string'),
    });
    const units = unitTable.rows;
    const items = buildExportItems(
      input.items,
      input.amount as number,
      units,
      input.description?.trim() || DEFAULT_EXPORT_ITEM_DESCRIPTION,
    );

    // Sin `--incoterms-desc`, la descripcion (`Incoterms_Ds`) sale de la tabla.
    const incotermTable = input.incoterm?.trim()
      ? await readExportTable(() => gateway.getIncoterms(), { required: !input.incotermDescription?.trim() })
      : undefined;
    const incoterm = resolveExportIncoterm(input.incoterm, incotermTable?.rows ?? []);
    // Se consulta siempre: la vista previa muestra el nombre del idioma, tambien el de por defecto.
    const languageTable = await readExportTable(() => gateway.getLanguages());
    const languageId = resolveExportLanguage(input.language, languageTable.rows);
    const currency = resolveExportCurrency(input);
    // Se consulta siempre: la vista previa muestra el nombre de la moneda. Una extranjera que no esta en la tabla es
    // error de entrada (1590), antes de buscar su cotizacion; los pesos no se controlan.
    const currencyTable = await readExportTable(() => gateway.getCurrencies());
    const isLocalCurrency = currency.fields.Moneda_Id === ARCA_LOCAL_CURRENCY_CODE;
    const requestedCurrency = input.currencyCode?.trim() || currency.fields.Moneda_Id;

    assertCurrencyInTable({
      arcaCode: currency.fields.Moneda_Id,
      requested: requestedCurrency,
      service: 'wsfex',
      table: isLocalCurrency ? [] : currencyTable.rows.map((entry) => entry.code),
    });
    const quotationDate = resolveExportQuotationDate({
      exportType,
      isNote: isExportNote(voucherKind),
      sameCurrency: currency.fields.CanMisMonExt === 'S',
      today,
      voucherDate,
    });
    const quotation = currency.needsQuotation
      ? resolveExportQuotation(
          currency.fields.Moneda_Id,
          await gateway.getQuotations(quotationDate.date),
          quotationDate.date,
        )
      : undefined;

    // `--cotizacion-moneda`: en servicios o con `--misma-moneda` tiene que ser la de ARCA (2053, 1604), y en bienes y
    // otros se avisa si esta fuera de rango (1667). Solo en la factura: la de una nota sale del asociado.
    const exchangeRateWarnings =
      currency.needsQuotation || isLocalCurrency || isExportNote(voucherKind)
        ? []
        : await checkWrittenExchangeRate({
            code: currency.fields.Moneda_Id,
            exportType,
            gateway,
            quotationDate,
            rate: currency.fields.Moneda_ctz,
          });
    const exchangeRate = quotation?.rate ?? currency.fields.Moneda_ctz;
    // WSFEX numera por punto de venta y tipo. Sin `--numero`, el siguiente al ultimo que tiene ARCA: es una lectura.
    const voucherNumber = resolveExportNumber({
      code: 1520,
      label: 'El número del comprobante',
      max: MAX_EXPORT_VOUCHER_NUMBER,
      last:
        input.voucherNumber === undefined
          ? await gateway.getLastVoucherNumber(voucherKind.arcaType, pointOfSale, 'emitir')
          : 0,
      provided: input.voucherNumber,
    });
    const requestId = resolveExportNumber({
      label: 'El ID de la solicitud',
      max: MAX_EXPORT_REQUEST_ID,
      last: input.requestId === undefined ? await gateway.getLastRequestId() : 0,
      provided: input.requestId,
    });

    // Sin `--actividad` ni `exportacion.actividad` la E va sin el bloque `Actividades`: ARCA no lo exige.
    const activityTable = activityCode === undefined ? undefined : await readExportTable(() => gateway.getActivities());
    const activity =
      activityCode === undefined ? undefined : resolveExportActivity(activityCode, activityTable?.rows ?? []);
    const payload = buildExportPayload(input, {
      activity,
      clientCountryCuit,
      currency: {
        ...currency.fields,
        Moneda_Id: quotation?.code ?? currency.fields.Moneda_Id,
        Moneda_ctz: exchangeRate,
      },
      destinationCountry,
      exportType,
      incoterm,
      items: items.items,
      languageId,
      paymentDate,
      pointOfSale,
      requestId,
      associatedVoucher: associated?.payload,
      voucherDate,
      voucherKind,
      voucherNumber,
    });

    if (associated) {
      assertExportNoteMatchesAssociated({
        associated: associated.voucher,
        kind: voucherKind,
        note: {
          amount: payload.Imp_total,
          currencyCode: payload.Moneda_Id,
          date: payload.Fecha_cbte,
          destinationCountry: payload.Dst_cmp,
          exchangeRate: payload.Moneda_ctz,
          exportType: payload.Tipo_expo,
        },
      });
    }

    // Ultima lectura antes de emitir: un permiso que ARCA no reconoce corta aca y no en el rechazo de `FEXAuthorize`.
    const permitChecks = await checkExportPermits(payload, gateway, destinationCountry.name);
    const currencyCode = payload.Moneda_Id.trim().toUpperCase();
    const display: ExportDisplayInfo = {
      ...(associated ? { associatedVoucher: describeAssociated(associated.voucher) } : {}),
      countryCuitName:
        clientCountryCuit === undefined
          ? undefined
          : countryCuits.find((entry) => entry.cuit === clientCountryCuit)?.countryName,
      countryName: destinationCountry.name,
      currencyName: currencyTable.rows.find((entry) => entry.code.trim().toUpperCase() === currencyCode)?.name,
      incotermName: incoterm?.name,
      languageName: languageTable.rows.find((language) => language.id === languageId)?.name,
      ...(permitChecks ? { permitChecks: permitChecks.checks } : {}),
      unitNames: Object.fromEntries(units.map((unit) => [unit.id, unit.name])),
    };
    // La cotizacion de aduana del dia se publica mas tarde: se emite con la ultima disponible, avisando de que dia es.
    const warnings = [
      // En las notas `--fecha-pago` es un error (ver `assertExportNoteFields`); en la factura de bienes se ignora.
      ...(!isExportNote(voucherKind) && input.paymentDate?.trim() && !exportTypeTakesPaymentDate(exportType, false)
        ? [
            'La factura E de bienes (`--tipo-expo 1`) no lleva fecha de pago: ARCA la rechaza (error 1673). `--fecha-pago` no se usa.',
          ]
        : []),
      ...(quotation
        ? exportQuotationWarnings({
            // El codigo como se escribio, como en A, B y C.
            currencyCode: requestedCurrency.toUpperCase(),
            exportType,
            quotation,
            quotationDate,
            voucherDate,
          })
        : []),
      ...exchangeRateWarnings,
      ...exportAssociatedVoucherWarnings(rawInput.associatedVoucher),
      ...futureDateWarnings({
        code: 1535,
        next: formatNextVouchers(voucherKind),
        pointOfSale,
        today,
        voucherDate,
      }),
      ...(permitChecks?.warnings ?? []),
      // "Sin validar" es solo lo que se escribio: lo heredado del asociado ya lo autorizo ARCA.
      ...unreadExportTableWarnings(
        countryCuitTable,
        'CUIT de países',
        rawInput.clientCountryCuit === undefined ? undefined : `el CUIT de país ${clientCountryCuit}`,
      ),
      ...unreadExportTableWarnings(unitTable, 'unidades de medida', describeWrittenUnits(input)),
      ...(incoterm && incotermTable
        ? unreadExportTableWarnings(
            incotermTable,
            'incoterms',
            rawInput.incoterm?.trim() ? `el incoterm ${incoterm.code}` : undefined,
          )
        : []),
      ...unreadExportTableWarnings(
        languageTable,
        'idiomas',
        rawInput.language === undefined ? undefined : `el idioma ${languageId}`,
      ),
      // Con la cotizacion de ARCA, la moneda ya se encontro en su tabla de cotizaciones.
      ...unreadExportTableWarnings(
        currencyTable,
        'monedas',
        isLocalCurrency || quotation || (associated && !rawInput.currencyCode?.trim())
          ? undefined
          : `la moneda ${requestedCurrency.toUpperCase()}`,
      ),
      ...(activity !== undefined && activityTable && input.activity === rawInput.activity
        ? unreadExportTableWarnings(activityTable, 'actividades', `la actividad ${activity}`)
        : []),
      ...(activity !== undefined && activityTable?.ok && activityTable.rows.length === 0
        ? [exportEmptyTableWarning('actividades', activity)]
        : []),
      ...(incoterm && incotermTable?.ok && incotermTable.rows.length === 0
        ? [exportEmptyTableWarning('incoterms', incoterm.code)]
        : []),
    ];

    return { display, payload, voucherKind, warnings };
  }
  /** Vista previa: el payload resuelto, sin llamar a `authorize`. */
  public preview(
    resolved: ResolvedExportVoucher,
    runtime: ExportRuntime,
    warnings?: readonly string[],
  ): ExportExecutionResult {
    return {
      display: resolved.display,
      dryRun: true,
      environment: runtime.environment,
      payload: resolved.payload,
      response: createDryRunExportResponse(),
      voucherKind: resolved.voucherKind,
      warnings,
    };
  }

  /** La llamada que emite. Un error aca puede haber dejado el comprobante autorizado en ARCA. */
  public async execute(options: {
    readonly gateway: ExportEmissionGateway;
    readonly resolved: ResolvedExportVoucher;
    readonly runtime: ExportRuntime;
    readonly warnings?: readonly string[];
  }): Promise<ExportExecutionResult> {
    const { payload } = options.resolved;
    let response: ExportResponseSummary;

    try {
      const answer = await options.gateway.authorize(payload);

      // Adentro del try: lo que no se puede leer es una emision sin confirmar (ERR-16).
      response = mapExportResponse(answer);
    } catch (error) {
      throw new EmissionUncertainError({
        arcaType: options.resolved.voucherKind.arcaType,
        cause: error,
        environment: options.runtime.environment,
        pointOfSale: payload.Punto_vta,
        requestId: payload.Id,
        shortcut: options.resolved.voucherKind.shortcut,
        voucherNumber: payload.Cbte_nro,
      });
    }

    return {
      display: options.resolved.display,
      dryRun: false,
      environment: options.runtime.environment,
      payload: options.resolved.payload,
      response,
      voucherKind: options.resolved.voucherKind,
      warnings: options.warnings,
    };
  }
}
