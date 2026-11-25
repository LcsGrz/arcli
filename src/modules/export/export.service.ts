import type { Clock } from '../../lib/time/clock';
import { EmissionUncertainError, type SentVoucher } from '../billing/billing.errors';
import type { BeforeSending } from '../billing/emission-interruption';
import type { ArcliConfig } from '../config/config.schemas';

import { resolveExportDestinationCountry } from './export.catalogs';
import type { ExportEmissionGateway, ExportPreviewGateway } from './export.gateway';
import { EXPORT_VOUCHER_KIND } from './export.kinds';
import { assertExportNoteMatchesAssociated } from './export.notes';
import { resolveExportNumber } from './export.numbering';
import { buildExportPayload } from './export.payload';
import { checkExportPermits } from './export.permits';
import { resolveExportAssociated } from './export.resolve.associated';
import { resolveExportMoney } from './export.resolve.currency';
import { assertExportLocalFields, type ExportRequest, resolveExportRequest } from './export.resolve.local';
import { buildExportDisplay, buildExportWarnings } from './export.resolve.result';
import {
  resolveExportActivityCode,
  resolveExportCatalogs,
  type StartedExportTables,
  startExportTables,
} from './export.resolve.tables';
import { createDryRunExportResponse, mapExportResponse } from './export.response';
import { createExportTableReader } from './export.tables';
import {
  type ExportCountry,
  type ExportExecutionResult,
  type ExportIssuedVoucher,
  type ExportResponseSummary,
  type ExportVoucherInput,
  type ExportVoucherPayload,
  MAX_EXPORT_REQUEST_ID,
  MAX_EXPORT_VOUCHER_NUMBER,
  type ResolvedExportVoucher,
} from './export.types';

export interface ExportRuntime {
  readonly config: ArcliConfig;
  /** El CUIT emisor del perfil. */
  readonly cuit: number;
  readonly environment: 'produccion' | 'testing';
}

/** El numero del comprobante y el ID de la solicitud: los escritos o los siguientes a los ultimos que tiene ARCA. */
async function resolveExportNumbers({ input, pointOfSale, voucherKind }: ExportRequest, gateway: ExportPreviewGateway) {
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

  return { requestId, voucherNumber };
}

/** La nota contra su asociado (2049 a 2053), con el payload armado. */
function assertMatchesAssociated({ associated, voucherKind }: ExportRequest, payload: ExportVoucherPayload): void {
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
   * numeracion y cotizacion. Son llamadas de lectura: no emiten nada. `read` es el asociado que quien llama ya consulto:
   * si es el de la entrada, no se consulta de nuevo.
   */
  public async resolve(
    rawInput: ExportVoucherInput,
    gateway: ExportPreviewGateway,
    runtime: ExportRuntime,
    read?: ExportIssuedVoucher,
  ): Promise<ResolvedExportVoucher> {
    const now = this.clock.now();
    const voucherKind = rawInput.voucherKind ?? EXPORT_VOUCHER_KIND;

    assertExportLocalFields(rawInput, voucherKind);

    // La nota completa con su asociado lo que no vino por flag: cliente, destino, moneda, cotizacion, tipo.
    // Sin asociado (solo en notas de bienes y otros, 2047) la nota lleva todo por flag.
    const associated = await resolveExportAssociated(rawInput, gateway, runtime, voucherKind, read);
    const request = resolveExportRequest({ associated, config: runtime.config, now, rawInput, voucherKind });
    // Siempre hace falta, tambien con el pais por codigo: el CUIT del pais se compara con su nombre.
    const countryList = await gateway.getDestinationCountries();
    const destinationCountry = resolveExportDestinationCountry(request.input.destinationCountry, countryList);

    const started = startExportTables(request, gateway);

    try {
      return await this.resolveWithTables(request, destinationCountry, started, gateway);
    } finally {
      started.stop();
    }
  }

  /** Despues de los paises: las tablas, que ya arrancaron y se esperan en el orden en que se usan, los numeros, el payload y los permisos. */
  private async resolveWithTables(
    request: ExportRequest,
    destinationCountry: ExportCountry,
    started: StartedExportTables,
    gateway: ExportPreviewGateway,
  ): Promise<ResolvedExportVoucher> {
    const { associated, input, voucherKind } = request;
    const tables = createExportTableReader();
    const catalogs = await resolveExportCatalogs({ destinationCountry, request, started, tables });
    const money = await resolveExportMoney({ gateway, request, started, tables });
    const numbers = await resolveExportNumbers(request, gateway);
    const activities = await resolveExportActivityCode(request.activityCode, started.activities, tables);
    const payload = buildExportPayload(input, {
      activity: activities.activity,
      associatedVoucher: associated?.payload,
      clientCountryCuit: catalogs.clientCountryCuit,
      currency: money.currency,
      destinationCountry,
      exportType: request.exportType,
      incoterm: catalogs.incoterm,
      items: catalogs.items.items,
      languageId: catalogs.languageId,
      paymentDate: request.paymentDate,
      pointOfSale: request.pointOfSale,
      requestId: numbers.requestId,
      voucherDate: request.voucherDate,
      voucherKind,
      voucherNumber: numbers.voucherNumber,
    });

    assertMatchesAssociated(request, payload);

    // Ultima lectura antes de emitir: un permiso que ARCA no reconoce corta aca y no en el rechazo de `FEXAuthorize`.
    const permitChecks = await checkExportPermits(
      payload,
      { checkPermit: (permit, country) => tables.observe(() => gateway.checkPermit(permit, country)) },
      destinationCountry.name,
    );

    tables.assertConnected();

    const resolution = { activities, catalogs, destinationCountry, money, payload, permitChecks, request };

    return {
      display: buildExportDisplay(resolution),
      payload,
      voucherKind,
      warnings: buildExportWarnings(resolution),
    };
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
    readonly beforeSending?: BeforeSending;
    readonly gateway: ExportEmissionGateway;
    readonly resolved: ResolvedExportVoucher;
    readonly runtime: ExportRuntime;
    readonly warnings?: readonly string[];
  }): Promise<ExportExecutionResult> {
    const { payload } = options.resolved;
    const sent: SentVoucher = {
      arcaType: options.resolved.voucherKind.arcaType,
      environment: options.runtime.environment,
      pointOfSale: payload.Punto_vta,
      requestId: payload.Id,
      shortcut: options.resolved.voucherKind.shortcut,
      voucherNumber: payload.Cbte_nro,
    };
    let response: ExportResponseSummary;

    // Fuera del try: si frena, no se envio. Sin `await` entre esto y la llamada que emite.
    options.beforeSending?.(sent);

    try {
      const answer = await options.gateway.authorize(payload);

      // Adentro del try: lo que no se puede leer es una emision sin confirmar (ERR-16).
      response = mapExportResponse(answer);
    } catch (error) {
      throw new EmissionUncertainError({ ...sent, cause: error });
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
