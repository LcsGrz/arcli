import {
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
  buildExportPayload,
  resolveExportActivity,
  resolveExportClientCountryCuit,
  resolveExportCurrency,
  resolveExportDestinationCountry,
  resolveExportIncoterm,
  resolveExportLanguage,
  resolveExportNumber,
  resolveExportPointOfSale,
  resolveExportQuotation,
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
import { createDryRunExportResponse, mapExportResponse } from './export.response';
import {
  EXPORT_VOUCHER_KIND,
  type ExportAssociatedVoucherPayload,
  type ExportDisplayInfo,
  type ExportExecutionResult,
  type ExportGateway,
  type ExportIssuedVoucher,
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

/** WSFEX no acepta comprobantes con fecha futura. Las fechas pasadas si son validas. */
function assertNotFuture(voucherDate: string, now: Date): void {
  const today = formatDateAsArcaDate(now);

  if (voucherDate > today) {
    throw new InputValidationError(
      `La fecha del comprobante (${formatArcaDateAsArgentineDate(voucherDate)}) no puede ser futura.`,
    );
  }
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

    assertNotFuture(voucherDate, now);

    const countryList = await gateway.getDestinationCountries();
    const destinationCountry = resolveExportDestinationCountry(input.destinationCountry, countryList);
    const countryCuits = await gateway.getDestinationCountryCuits();
    const clientCountryCuit = resolveExportClientCountryCuit({
      country: destinationCountry,
      countries: countryCuits,
      cuit: input.clientCountryCuit,
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
    const quotation = currency.needsQuotation
      ? resolveExportQuotation(currency.fields.Moneda_Id, await gateway.getQuotations(voucherDate), voucherDate)
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

    const currencyCode = payload.Moneda_Id.trim().toUpperCase();
    const display: ExportDisplayInfo = {
      ...(associated ? { associatedVoucher: describeAssociated(associated.voucher) } : {}),
      countryCuitName: countryCuits.find((entry) => entry.cuit === clientCountryCuit)?.countryName,
      countryName: destinationCountry.name,
      currencyName: (await gateway.getCurrencies()).find((entry) => entry.code.trim().toUpperCase() === currencyCode)
        ?.name,
      incotermName: incoterm?.name,
      languageName: languages.find((language) => language.id === languageId)?.name,
      unitNames: Object.fromEntries(units.map((unit) => [unit.id, unit.name])),
    };
    // La cotizacion de aduana del dia se publica mas tarde: se emite con la ultima disponible, avisando de que dia es.
    const warnings = [
      ...exportAssociatedVoucherWarnings(rawInput.associatedVoucher),
      ...(quotation?.date && quotation.date !== voucherDate
        ? [
            `ARCA no publicó la cotización de ${quotation.code} del ${formatArcaDateAsArgentineDate(
              voucherDate,
            )}: se usa la del ${formatArcaDateAsArgentineDate(quotation.date)} (${formatExchangeRate(quotation.rate)}). Para usar otra, \`--cotizacion-moneda\`.`,
          ]
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
