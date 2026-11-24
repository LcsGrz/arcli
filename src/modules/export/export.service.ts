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
import { assertCurrencyInTable } from '../billing/billing.currency';
import { EmissionUncertainError, readEmissionResponse } from '../billing/billing.errors';
import { ARCA_LOCAL_CURRENCY_CODE } from '../billing/currency-codes';
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
  missingExportAssociatedVoucherError,
  resolveExportAssociatedQuery,
} from './export.notes';
import { checkExportPermits } from './export.permits';
import { createDryRunExportResponse, mapExportResponse } from './export.response';
import { EXPORT_DATE_RULES } from './export.rules';
import {
  EXPORT_VOUCHER_KIND,
  type ExportAssociatedVoucherPayload,
  type ExportDisplayInfo,
  type ExportExecutionResult,
  type ExportGateway,
  type ExportIssuedVoucher,
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

/** Como se nombran en plural los comprobantes del mismo tipo, para el aviso de la fecha futura. */
const PLURAL_NAMES: Record<ExportVoucherKind['shortcut'], string> = {
  fe: 'facturas E',
  nce: 'notas de crédito E',
  nde: 'notas de débito E',
};

/**
 * ARCA 1535 (WSFEX v3.1.0) controla la secuencia por punto de venta, tipo, numero y fecha: despues de una E con fecha
 * futura, una del mismo punto de venta y tipo con fecha anterior sale rechazada. Se avisa en la vista previa.
 */
function exportFutureDateWarnings(options: {
  readonly kind: ExportVoucherKind;
  readonly pointOfSale: number;
  readonly today: string;
  readonly voucherDate: string;
}): string[] {
  if (options.voucherDate <= options.today) {
    return [];
  }

  return [
    `La fecha del comprobante (${formatArcaDateAsArgentineDate(options.voucherDate)}) es futura: las próximas ${PLURAL_NAMES[options.kind.shortcut]} del punto de venta ${options.pointOfSale} van a tener que llevar esa fecha o una posterior, porque ARCA rechaza una anterior (error 1535).`,
  ];
}

interface ResolvedAssociatedVoucher {
  readonly payload: ExportAssociatedVoucherPayload;
  readonly voucher: ExportIssuedVoucher;
}

/** Consulta en ARCA el comprobante que ajusta la nota. Es una lectura: no emite nada. */
async function fetchAssociated(
  input: ExportVoucherInput,
  gateway: ExportGateway,
  runtime: ExportRuntime,
  kind: ExportVoucherKind,
): Promise<ResolvedAssociatedVoucher> {
  const query = resolveExportAssociatedQuery({
    emitterCuit: runtime.cuit,
    input: input.associatedVoucher,
    kind,
    pointOfSale: resolveExportPointOfSale(input.pointOfSale, runtime.config),
  });
  const voucher = await gateway.getVoucher(query);

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
 * Aviso de que dia es la cotizacion, solo si no es la del dia que se pidio. En servicios y con el pago en la misma
 * moneda se pide el dia anterior al comprobante: sale el aviso cuando ese dia no hubo (un fin de semana o un feriado)
 * y ARCA devolvio la del ultimo dia habil. En el resto, cuando ARCA todavia no publico la de la fecha del comprobante.
 */
function exportQuotationWarnings(
  quotation: ExportQuotation,
  quotationDate: ExportQuotationDate,
  exportType: ExportType,
  voucherDate: string,
): string[] {
  if (!quotation.date || quotation.date === quotationDate.date) {
    return [];
  }

  const used = `la del ${formatArcaDateAsArgentineDate(quotation.date)} (${formatExchangeRate(quotation.rate)})`;

  if (quotationDate.rule === 'previous-business-day') {
    const subject = exportType === SERVICES_EXPORT_TYPE ? 'En servicios' : 'Con `--misma-moneda`';

    return [
      `${subject} ARCA exige la cotización de ${quotation.code} del día hábil anterior a ${quotationDate.date < addDaysToArcaDate(voucherDate, -1) ? 'hoy, porque la fecha del comprobante es futura' : 'la fecha del comprobante'} (error 2053): se usa ${used}, la última que publicó hasta el ${formatArcaDateAsArgentineDate(quotationDate.date)}.`,
    ];
  }

  return [
    `ARCA no publicó la cotización de ${quotation.code} del ${formatArcaDateAsArgentineDate(
      quotationDate.date,
    )}: se usa ${used}. Para usar otra, \`--cotizacion-moneda\`.`,
  ];
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
    gateway: ExportGateway,
    runtime: ExportRuntime,
  ): Promise<ResolvedExportVoucher> {
    const now = this.clock.now();
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
      { today: formatDateAsArcaDate(now) },
    );
    assertExportIncoterm({
      exportType,
      incoterm: input.incoterm,
      incotermDescription: input.incotermDescription,
      isNote: isExportNote(voucherKind),
    });

    const countryList = await gateway.getDestinationCountries();
    const destinationCountry = resolveExportDestinationCountry(input.destinationCountry, countryList);
    const countryCuits = await gateway.getDestinationCountryCuits();
    const clientCountryCuit = resolveExportClientCountryCuit({
      country: destinationCountry,
      countries: countryCuits,
      cuit: input.clientCountryCuit,
    });

    assertExportClientIdentification({
      clientCountryCuit,
      clientTaxId: input.clientTaxId,
      country: destinationCountry,
    });

    const units = await gateway.getUnits();
    const items = buildExportItems(
      input.items,
      input.amount as number,
      units,
      input.description?.trim() || DEFAULT_EXPORT_ITEM_DESCRIPTION,
    );

    const incotermTable = input.incoterm?.trim() ? await gateway.getIncoterms() : undefined;
    const incoterm = resolveExportIncoterm(input.incoterm, incotermTable ?? []);
    // Se consulta siempre: la vista previa muestra el nombre del idioma, tambien el de por defecto.
    const languages = await gateway.getLanguages();
    const languageId = resolveExportLanguage(input.language, languages);
    const currency = resolveExportCurrency(input);
    // Se consulta siempre: la vista previa muestra el nombre de la moneda. Una extranjera que no esta en la tabla es
    // error de entrada (1590), antes de buscar su cotizacion; los pesos no se controlan.
    const currencies = await gateway.getCurrencies();

    assertCurrencyInTable({
      arcaCode: currency.fields.Moneda_Id,
      requested: input.currencyCode?.trim() || currency.fields.Moneda_Id,
      service: 'wsfex',
      table: currency.fields.Moneda_Id === ARCA_LOCAL_CURRENCY_CODE ? [] : currencies.map((entry) => entry.code),
    });
    const quotationDate = resolveExportQuotationDate({
      exportType,
      isNote: isExportNote(voucherKind),
      sameCurrency: currency.fields.CanMisMonExt === 'S',
      today: formatDateAsArcaDate(now),
      voucherDate,
    });
    const quotation = currency.needsQuotation
      ? resolveExportQuotation(
          currency.fields.Moneda_Id,
          await gateway.getQuotations(quotationDate.date),
          quotationDate.date,
        )
      : undefined;

    // `--cotizacion-moneda` en la factura de servicios o con `--misma-moneda`: tiene que ser la de ARCA (2053, 1604).
    if (
      !currency.needsQuotation &&
      currency.fields.Moneda_Id !== ARCA_LOCAL_CURRENCY_CODE &&
      quotationDate.rule === 'previous-business-day'
    ) {
      const code = currency.fields.Moneda_Id.trim().toUpperCase();

      assertExportExchangeRateMatches({
        exportType,
        given: currency.fields.Moneda_ctz,
        official: (await gateway.getQuotations(quotationDate.date)).find(
          (entry) => entry.code.trim().toUpperCase() === code,
        ),
      });
    }
    const exchangeRate = quotation?.rate ?? currency.fields.Moneda_ctz;
    const pointOfSale = resolveExportPointOfSale(input.pointOfSale, config);
    // WSFEX numera por punto de venta y tipo. Sin `--numero`, el siguiente al ultimo que tiene ARCA: es una lectura.
    const voucherNumber = resolveExportNumber({
      code: 1520,
      label: 'El número del comprobante',
      max: MAX_EXPORT_VOUCHER_NUMBER,
      last:
        input.voucherNumber === undefined ? await gateway.getLastVoucherNumber(voucherKind.arcaType, pointOfSale) : 0,
      provided: input.voucherNumber,
    });
    const requestId = resolveExportNumber({
      label: 'El ID de la solicitud',
      max: MAX_EXPORT_REQUEST_ID,
      last: input.requestId === undefined ? await gateway.getLastRequestId() : 0,
      provided: input.requestId,
    });

    // Sin `--actividad` ni `exportacion.actividad` la E va sin el bloque `Actividades`: ARCA no lo exige.
    const activityTable = activityCode === undefined ? undefined : await gateway.getActivities();
    const activity = activityCode === undefined ? undefined : resolveExportActivity(activityCode, activityTable ?? []);
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
      currencyName: currencies.find((entry) => entry.code.trim().toUpperCase() === currencyCode)?.name,
      incotermName: incoterm?.name,
      languageName: languages.find((language) => language.id === languageId)?.name,
      ...(permitChecks ? { permitChecks: permitChecks.checks } : {}),
      unitNames: Object.fromEntries(units.map((unit) => [unit.id, unit.name])),
    };
    // La cotizacion de aduana del dia se publica mas tarde: se emite con la ultima disponible, avisando de que dia es.
    const warnings = [
      ...exportAssociatedVoucherWarnings(rawInput.associatedVoucher),
      ...exportFutureDateWarnings({ kind: voucherKind, pointOfSale, today: formatDateAsArcaDate(now), voucherDate }),
      // En las notas `--fecha-pago` es un error (ver `assertExportNoteFields`); en la factura de bienes se ignora.
      ...(!isExportNote(voucherKind) && input.paymentDate?.trim() && !exportTypeTakesPaymentDate(exportType, false)
        ? [
            'La factura E de bienes (`--tipo-expo 1`) no lleva fecha de pago: ARCA la rechaza (error 1673). `--fecha-pago` no se usa.',
          ]
        : []),
      ...(quotation ? exportQuotationWarnings(quotation, quotationDate, exportType, voucherDate) : []),
      ...(permitChecks?.warnings ?? []),
      ...(activity !== undefined && activityTable?.length === 0
        ? [exportEmptyTableWarning('actividades', activity)]
        : []),
      ...(incoterm && incotermTable?.length === 0 ? [exportEmptyTableWarning('incoterms', incoterm.code)] : []),
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
    readonly gateway: ExportGateway;
    readonly resolved: ResolvedExportVoucher;
    readonly runtime: ExportRuntime;
    readonly warnings?: readonly string[];
  }): Promise<ExportExecutionResult> {
    const { payload } = options.resolved;
    let response: ExportResponseSummary;

    try {
      const raw = await options.gateway.authorize(payload);

      response = readEmissionResponse(() => mapExportResponse(raw));
    } catch (error) {
      throw new EmissionUncertainError({
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
