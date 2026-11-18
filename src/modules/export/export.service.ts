import {
  addDaysToArcaDate,
  formatArcaDateAsArgentineDate,
  formatDateAsArcaDate,
  parseArgentineDateInputAsArcaDate,
} from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { AMOUNT_DECIMALS, formatExchangeRate, hasAtMostDecimals } from '../../lib/numbers/argentine-amount';
import { EmissionUncertainError } from '../billing/billing.errors';
import { type ArcliConfig, MISSING_CUIT_MESSAGE } from '../config/config.schemas';

import { assertExportItemsTotal, buildExportItems, DEFAULT_EXPORT_ITEM_DESCRIPTION } from './export.items';
import {
  assertExportClientIdentification,
  assertExportVoucherDate,
  buildExportPayload,
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
  missingExportAssociatedVoucherError,
  resolveExportAssociatedQuery,
} from './export.notes';
import { checkExportPermits } from './export.permits';
import { createDryRunExportResponse, mapExportResponse } from './export.response';
import {
  EXPORT_VOUCHER_KIND,
  type ExportAssociatedVoucherPayload,
  type ExportDisplayInfo,
  type ExportExecutionResult,
  type ExportGateway,
  type ExportIssuedVoucher,
  type ExportQuotation,
  type ExportType,
  type ExportVoucherInput,
  type ExportVoucherKind,
  getExportVoucherKindByArcaType,
  isExportNote,
  type ResolvedExportVoucher,
} from './export.types';

export interface ExportRuntime {
  readonly config: ArcliConfig;
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

  assertExportItemsTotal(input.items, input.amount);
}

/** Lo que pide la factura (y la nota, ya completada con su asociado) antes de consultar las tablas. */
function assertRequiredFields(input: ExportVoucherInput, activity: number | undefined): void {
  if (!input.clientName?.trim()) {
    throw new InputValidationError('Falta el nombre del cliente. Usá `--cliente`.');
  }

  if (!input.clientAddress?.trim()) {
    throw new InputValidationError('Falta el domicilio del cliente. Usá `--domicilio-cliente`.');
  }

  if (!input.destinationCountry?.trim()) {
    throw new InputValidationError('Falta el país de destino. Usá `--pais-destino`.');
  }

  if (activity === undefined) {
    throw new InputValidationError(
      'Falta la actividad de exportación. Usá `--actividad` o guardala con `arcli config establecer exportacion.actividad <código>`: es el código de la tabla de actividades de WSFEX, por ejemplo 620100.',
    );
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
  const emitterCuit = runtime.config.cuit;

  if (!emitterCuit) {
    throw new InputValidationError(MISSING_CUIT_MESSAGE);
  }
  const query = resolveExportAssociatedQuery({
    emitterCuit,
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
      Cbte_cuit: Number(emitterCuit),
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
    const subject = exportType === 2 ? 'En servicios' : 'Con `--misma-moneda`';

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

export class ExportService {
  /**
   * Resuelve todo lo que pide WSFEX antes de emitir: tablas de paises, incoterms, idiomas y unidades,
   * numeracion y cotizacion. Son llamadas de lectura: no emiten nada.
   */
  public async resolve(
    rawInput: ExportVoucherInput,
    gateway: ExportGateway,
    runtime: ExportRuntime,
    now = new Date(),
  ): Promise<ResolvedExportVoucher> {
    const config = runtime.config;
    const voucherKind = rawInput.voucherKind ?? EXPORT_VOUCHER_KIND;

    assertLocalFields(rawInput, voucherKind);

    // La nota completa con su asociado lo que no vino por flag: cliente, destino, moneda, cotizacion, tipo.
    const associated = isExportNote(voucherKind)
      ? await fetchAssociated(rawInput, gateway, runtime, voucherKind)
      : undefined;
    const input = associated ? applyExportAssociatedDefaults(rawInput, associated.voucher) : rawInput;
    const activityCode = input.activity ?? config.exportacion?.actividad;

    assertRequiredFields(input, activityCode);

    const exportType = resolveExportType(input.exportType);
    const voucherDate = resolveExportVoucherDate(input.voucherDate, now);
    const paymentDate = input.paymentDate?.trim() ? parseArgentineDateInputAsArcaDate(input.paymentDate) : voucherDate;

    assertExportVoucherDate({ exportType, today: formatDateAsArcaDate(now), voucherDate });

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

    const incoterm = resolveExportIncoterm(input.incoterm, input.incoterm?.trim() ? await gateway.getIncoterms() : []);
    // Se consulta siempre: la vista previa muestra el nombre del idioma, tambien el de por defecto.
    const languages = await gateway.getLanguages();
    const languageId = resolveExportLanguage(input.language, languages);
    const currency = resolveExportCurrency(input);
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
    const exchangeRate = quotation?.rate ?? currency.fields.Moneda_ctz;
    const pointOfSale = resolveExportPointOfSale(input.pointOfSale, config);
    // WSFEX numera por punto de venta y tipo. Sin `--numero`, el siguiente al ultimo que tiene ARCA: es una lectura.
    const voucherNumber = resolveExportNumber({
      label: 'El número del comprobante',
      last:
        input.voucherNumber === undefined ? await gateway.getLastVoucherNumber(voucherKind.arcaType, pointOfSale) : 0,
      provided: input.voucherNumber,
    });
    const requestId = resolveExportNumber({
      label: 'El ID de la solicitud',
      last: input.requestId === undefined ? await gateway.getLastRequestId() : 0,
      provided: input.requestId,
    });

    const activity = resolveExportActivity(activityCode as number, await gateway.getActivities());
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
      currencyName: (await gateway.getCurrencies()).find((entry) => entry.code.trim().toUpperCase() === currencyCode)
        ?.name,
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
    let raw: Awaited<ReturnType<ExportGateway['authorize']>>;

    try {
      raw = await options.gateway.authorize(payload);
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
      response: mapExportResponse(raw),
      voucherKind: options.resolved.voucherKind,
      warnings: options.warnings,
    };
  }
}
