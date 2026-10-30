import {
  formatArcaDateAsArgentineDate,
  formatDateAsArcaDate,
  parseArgentineDateInputAsArcaDate,
} from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';
import type { ArcliConfig } from '../config/config.schemas';

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
import { createDryRunExportResponse, mapExportResponse } from './export.response';
import {
  EXPORT_VOUCHER_KIND,
  type ExportDisplayInfo,
  type ExportExecutionResult,
  type ExportGateway,
  type ExportVoucherInput,
  type ResolvedExportVoucher,
} from './export.types';

export interface ExportRuntime {
  readonly config: ArcliConfig;
  readonly environment: 'produccion' | 'testing';
}

/** Se valida antes de tocar la red: un flag que falta no tiene por que autenticar en WSAA. */
function assertRequiredFields(input: ExportVoucherInput, activity: number | undefined): void {
  if (typeof input.amount !== 'number' || !(input.amount > 0)) {
    throw new InputValidationError('Falta el importe total o no es válido. Usá --monto.');
  }

  if (!input.clientName?.trim()) {
    throw new InputValidationError('Falta el nombre del cliente. Usá --cliente.');
  }

  if (!input.clientAddress?.trim()) {
    throw new InputValidationError('Falta el domicilio del cliente. Usá --domicilio-cliente.');
  }

  if (!input.destinationCountry?.trim()) {
    throw new InputValidationError('Falta el país de destino. Usá --pais-destino.');
  }

  // WSFEX numera por punto de venta y tipo, pero @arcasdk/core no deja consultar el ultimo (FEXGetLast_CMP lleva
  // Pto_venta y Cbte_Tipo dentro de Auth y el SDK pisa ese bloque). Hasta que se arregle, el numero lo indica el usuario.
  if (input.voucherNumber === undefined) {
    throw new InputValidationError(
      'Falta el número del comprobante. Usá --numero: arcli todavía no puede consultar en WSFEX el último emitido. Si es la primera Factura E de este punto de venta, es 1; si no, el siguiente al último que emitiste.',
    );
  }

  if (activity === undefined) {
    throw new InputValidationError(
      'Falta la actividad de exportación. Usá --actividad o guardala con "arcli config establecer exportacion.actividad <código>": es el código de la tabla de actividades de WSFEX, por ejemplo 620100.',
    );
  }

  assertExportItemsTotal(input.items, input.amount);
}

/** WSFEX no acepta comprobantes con fecha futura. Las fechas pasadas si son validas. */
function assertNotFuture(voucherDate: string, now: Date): void {
  const today = formatDateAsArcaDate(now);

  if (voucherDate > today) {
    throw new InputValidationError(
      `La fecha del comprobante (${voucherDate.slice(6, 8)}/${voucherDate.slice(4, 6)}/${voucherDate.slice(0, 4)}) no puede ser futura.`,
    );
  }
}

export class ExportService {
  /**
   * Resuelve todo lo que pide WSFEX antes de emitir: tablas de paises, incoterms, idiomas y unidades,
   * numeracion y cotizacion. Son llamadas de lectura: no emiten nada.
   */
  public async resolve(
    input: ExportVoucherInput,
    gateway: ExportGateway,
    runtime: ExportRuntime,
    now = new Date(),
  ): Promise<ResolvedExportVoucher> {
    const config = runtime.config;
    const activityCode = input.activity ?? config.exportacion?.actividad;

    assertRequiredFields(input, activityCode);

    const exportType = resolveExportType(input.exportType);
    const voucherDate = resolveExportVoucherDate(input.voucherDate, now);
    const paymentDate = input.paymentDate?.trim() ? parseArgentineDateInputAsArcaDate(input.paymentDate) : voucherDate;

    assertNotFuture(voucherDate, now);

    const countryList = await gateway.getDestinationCountries();
    const destinationCountry = resolveExportDestinationCountry(input.destinationCountry, countryList);
    const clientCountryCuit = resolveExportClientCountryCuit({
      country: destinationCountry,
      countries: await gateway.getDestinationCountryCuits(),
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
    const languages = input.language === undefined ? [] : await gateway.getLanguages();
    const languageId = resolveExportLanguage(input.language, languages);
    const currency = resolveExportCurrency(input);
    const quotation = currency.needsQuotation
      ? resolveExportQuotation(currency.fields.Moneda_Id, await gateway.getQuotations(voucherDate), voucherDate)
      : undefined;
    const exchangeRate = quotation?.rate ?? currency.fields.Moneda_ctz;
    const pointOfSale = resolveExportPointOfSale(input.pointOfSale, config);
    const voucherNumber = resolveExportNumber({
      label: 'El número del comprobante',
      last: 0,
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
      voucherDate,
      voucherNumber,
    });
    const currencyCode = payload.Moneda_Id.trim().toUpperCase();
    const display: ExportDisplayInfo = {
      countryName: destinationCountry.name,
      currencyName: (await gateway.getCurrencies()).find((entry) => entry.code.trim().toUpperCase() === currencyCode)
        ?.name,
      incotermName: incoterm?.name,
      languageName: languages.find((language) => language.id === languageId)?.name,
      unitNames: Object.fromEntries(units.map((unit) => [unit.id, unit.name])),
    };
    // La cotizacion de aduana del dia se publica mas tarde: se emite con la ultima disponible, avisando de que dia es.
    const warnings = [
      ...(quotation?.date && quotation.date !== voucherDate
        ? [
            `ARCA no publicó la cotización de ${quotation.code} del ${formatArcaDateAsArgentineDate(
              voucherDate,
            )}: se usa la del ${formatArcaDateAsArgentineDate(quotation.date)} (${quotation.rate}). Para usar otra, --cotizacion-moneda.`,
          ]
        : []),
    ];

    return { display, payload, warnings };
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
      voucherKind: EXPORT_VOUCHER_KIND,
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
    const raw = await options.gateway.authorize(options.resolved.payload);

    return {
      display: options.resolved.display,
      dryRun: false,
      environment: options.runtime.environment,
      payload: options.resolved.payload,
      response: mapExportResponse(raw),
      voucherKind: EXPORT_VOUCHER_KIND,
      warnings: options.warnings,
    };
  }
}
