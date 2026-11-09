import type { Arca, IFEXGetLast_CMPInput } from '@arcasdk/core';
import type { IFEXAuthorizeInput, IFEXAuthorizeOutput } from '@arcasdk/core/lib/application/dto/fex';

import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { AppError } from '../../lib/errors/app-error';
import type {
  ExportActivity,
  ExportCountry,
  ExportCountryCuit,
  ExportCurrency,
  ExportGateway,
  ExportIncoterm,
  ExportIssuedVoucher,
  ExportLanguage,
  ExportQuotation,
  ExportType,
  ExportUnit,
  ExportVoucherPayload,
  ExportVoucherQuery,
} from '../../modules/export/export.types';

const NOT_AUTHORIZED_MESSAGE =
  'El certificado no está autorizado para el servicio wsfex (factura de exportación). Autorizalo igual que wsfe: en testing desde WSASS ("Crear autorización a servicio") y en producción desde el Administrador de Relaciones.';

/** `FEXGetCMP`: "Comprobante inexistente". */
const VOUCHER_NOT_FOUND_ERROR = 1020;

interface FexError {
  readonly ErrCode?: number;
  readonly ErrMsg?: string;
}

interface FexEvent {
  readonly EventCode?: number;
  readonly EventMsg?: string;
}

interface FexResult {
  readonly FEXErr?: FexError;
  readonly FEXEvents?: FexEvent;
}

/** El XML de ARCA a veces trae un solo elemento donde el WSDL promete un array. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * La fecha de la cotizacion viene como `dd/mm/yyyy`; el resto del modulo trabaja con fechas ARCA (`yyyymmdd`).
 * Si ARCA no la informa se descarta: la cotizacion igual sirve.
 */
function parseWsfexQuotationDate(value: string): string | undefined {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);

  return match ? `${match[3]}${match[2].padStart(2, '0')}${match[1].padStart(2, '0')}` : undefined;
}

function readNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;

  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}

function readOptionalText(value: unknown): string | undefined {
  return readText(value) || undefined;
}

/** Los arrays de `FEXGetCMP` vienen envueltos (`Actividades.Actividad`, `Cmps_asoc.Cmp_asoc`). */
function readRows(value: unknown, key: string): Array<Record<string, unknown>> {
  const wrapper = value as Record<string, unknown> | undefined;

  return asArray(wrapper?.[key] as Record<string, unknown> | Array<Record<string, unknown>> | undefined);
}

function isExportType(value: number | undefined): value is ExportType {
  return value === 1 || value === 2 || value === 4;
}

function mapAssociatedVoucher(row: Record<string, unknown> | undefined): ExportVoucherQuery | undefined {
  const arcaType = readNumber(row?.Cbte_tipo);
  const number = readNumber(row?.Cbte_nro);
  const pointOfSale = readNumber(row?.Cbte_punto_vta);

  return arcaType && number && pointOfSale ? { arcaType, number, pointOfSale } : undefined;
}

/** Sin numero, tipo de exportacion o moneda no sirve como asociado: se trata como que no existe. */
function mapIssuedVoucher(row: Record<string, unknown> | undefined): ExportIssuedVoucher | null {
  const number = readNumber(row?.Cbte_nro);
  const exportType = readNumber(row?.Tipo_expo);
  const currencyCode = readText(row?.Moneda_Id);

  if (!row || !number || !isExportType(exportType) || !currencyCode) {
    return null;
  }

  // Sin incoterm ARCA devuelve `Incoterms_Ds` en "0": copiado a la nota, seria el error 1641.
  const incoterm = readOptionalText(row.Incoterms);

  return {
    activities: readRows(row.Actividades, 'Actividad').flatMap((activity) => readNumber(activity.Id) ?? []),
    arcaType: readNumber(row.Cbte_tipo) ?? 0,
    associatedVoucher: mapAssociatedVoucher(readRows(row.Cmps_asoc, 'Cmp_asoc')[0]),
    cae: readOptionalText(row.Cae),
    caeExpiration: readOptionalText(row.Fch_venc_Cae),
    clientAddress: readText(row.Domicilio_cliente),
    clientCountryCuit: readNumber(row.Cuit_pais_cliente),
    clientName: readText(row.Cliente),
    clientTaxId: readOptionalText(row.Id_impositivo),
    currencyCode,
    date: readText(row.Fecha_cbte),
    destinationCountry: readNumber(row.Dst_cmp) ?? 0,
    exchangeRate: readNumber(row.Moneda_ctz) ?? 0,
    exportType,
    incoterm,
    incotermDescription: incoterm ? readOptionalText(row.Incoterms_Ds) : undefined,
    language: readNumber(row.Idioma_cbte),
    number,
    paymentTerms: readOptionalText(row.Forma_pago),
    pointOfSale: readNumber(row.Punto_vta) ?? 0,
    result: readOptionalText(row.Resultado),
    total: readNumber(row.Imp_total) ?? 0,
  };
}

/** WSFEX no lanza: devuelve `FEXErr` con codigo 0 cuando salio todo bien. */
function assertNoError(result: FexResult | undefined, operation: string): void {
  const error = result?.FEXErr;

  if (error?.ErrCode) {
    throw new AppError(`ARCA devolvió un error al consultar ${operation}: ${readText(error.ErrMsg) || error.ErrCode}`, {
      code: 'ARCA_EXPORT_ERROR',
      details: { errores: [{ codigo: error.ErrCode, mensaje: readText(error.ErrMsg) }] },
    });
  }
}

/** El bloque `Auth` de WSFEX (token, firma y CUIT), recien pedido a WSAA o tomado del ticket guardado. */
export type WsfexAuthenticator = () => Promise<{
  readonly Cuit: number;
  readonly Sign: string;
  readonly Token: string;
}>;

export class ArcaExportGateway implements ExportGateway {
  /** Sin `authenticate` no se puede consultar el ultimo numero: ver `getLastVoucherNumber`. */
  public constructor(
    private readonly arca: Arca,
    private readonly authenticate?: WsfexAuthenticator,
  ) {}

  /** Todas las llamadas autentican en WSAA: si el certificado no esta autorizado a wsfex, el error lo dice. */
  private async call<T>(request: (service: Arca['wsfexService']) => Promise<T>): Promise<T> {
    try {
      return await request(this.arca.wsfexService);
    } catch (error) {
      if (error instanceof Error && error.message.includes('notAuthorized')) {
        throw new AppError(NOT_AUTHORIZED_MESSAGE, { code: 'WSFEX_SERVICE_NOT_AUTHORIZED' });
      }

      throw error;
    }
  }

  /**
   * La unica llamada que emite. Un rechazo viene en `FEXResultAuth`, no como excepcion.
   *
   * El WSDL tipa `Permisos` como obligatorio, pero ARCA lo rechaza cuando `Permiso_existente` es `N` (error
   * 1720) y en los tipos de exportacion 2 y 4 pide ese campo vacio (error 1550): sin permisos el `Cmp` no trae la
   * clave y el serializador de SOAP omite los campos ausentes.
   */
  public async authorize(payload: ExportVoucherPayload): Promise<IFEXAuthorizeOutput> {
    return this.call((service) => service.authorize({ Cmp: payload } as IFEXAuthorizeInput));
  }

  /**
   * La tabla de actividades de WSFEX es propia: tiene menos codigos que la del padron y el `Cmp` solo acepta los
   * suyos. El WSDL no la tipa (devuelve `ClsFEXResponse_ActividadTipo`), asi que se lee como array tolerante.
   */
  public async getActivities(): Promise<ExportActivity[]> {
    const data = (await this.call((service) => service.getParamActividades({}))).FEXGetPARAM_ActividadesResult;

    assertNoError(data, 'las actividades');

    const rows = (data?.FEXResultGet as { ClsFEXResponse_ActividadTipo?: unknown } | undefined)
      ?.ClsFEXResponse_ActividadTipo;

    return asArray(
      rows as Array<{ Desc?: unknown; Id?: unknown }> | { Desc?: unknown; Id?: unknown } | undefined,
    ).flatMap((row) => {
      const id = Number(row?.Id);
      const name = readText(row?.Desc);

      return Number.isInteger(id) && id > 0 ? [{ id, name }] : [];
    });
  }

  /**
   * `FEXGetCMP` devuelve el comprobante completo, aunque el tipo del SDK solo declare la numeracion: se lee como
   * registro tolerante. A diferencia de `FEXGetLast_CMP`, lleva el `Cmp` fuera de `Auth`, asi que el SDK no lo pisa.
   * Un comprobante que no existe vuelve con el error 1020 y un `FEXResultGet` en ceros (probado en testing).
   */
  public async getVoucher(query: ExportVoucherQuery): Promise<ExportIssuedVoucher | null> {
    const data = (
      await this.call((service) =>
        service.getCmp({ Cmp: { Cbte_nro: query.number, Cbte_tipo: query.arcaType, Punto_vta: query.pointOfSale } }),
      )
    ).FEXGetCMPResult;

    if (data?.FEXErr?.ErrCode === VOUCHER_NOT_FOUND_ERROR) {
      return null;
    }

    assertNoError(data, 'el comprobante asociado');

    return mapIssuedVoucher(data?.FEXResultGet as Record<string, unknown> | undefined);
  }

  public async getCurrencies(): Promise<ExportCurrency[]> {
    const data = (await this.call((service) => service.getParamMon({}))).FEXGetPARAM_MONResult;

    assertNoError(data, 'las monedas');

    return asArray(data?.FEXResultGet?.ClsFEXResponse_Mon).flatMap((row) => {
      const code = readText(row.Mon_Id);

      return code ? [{ code, name: readText(row.Mon_Ds) }] : [];
    });
  }

  public async getDestinationCountries(): Promise<ExportCountry[]> {
    const data = (await this.call((service) => service.getParamDstPais({}))).FEXGetPARAM_DST_paisResult;

    assertNoError(data, 'los países de destino');

    return asArray(data?.FEXResultGet?.ClsFEXResponse_DST_pais).flatMap((row) => {
      const code = Number(row.DST_Codigo);
      const name = readText(row.DST_Ds);

      return Number.isInteger(code) && name ? [{ code, name }] : [];
    });
  }

  public async getDestinationCountryCuits(): Promise<ExportCountryCuit[]> {
    const data = (await this.call((service) => service.getParamDstCuit({}))).FEXGetPARAM_DST_CUITResult;

    assertNoError(data, 'los CUIT de países');

    return asArray(data?.FEXResultGet?.ClsFEXResponse_DST_cuit).flatMap((row) => {
      const cuit = Number(row.DST_CUIT);
      const countryName = readText(row.DST_Ds);

      return Number.isInteger(cuit) && countryName ? [{ countryName, cuit }] : [];
    });
  }

  public async getIncoterms(): Promise<ExportIncoterm[]> {
    const data = (await this.call((service) => service.getParamIncoterms({}))).FEXGetPARAM_IncotermsResult;

    assertNoError(data, 'los incoterms');

    return asArray(data?.FEXResultGet?.ClsFEXResponse_Inc).flatMap((row) => {
      const code = readText(row.Inc_Id);

      return code ? [{ code, name: readText(row.Inc_Ds) }] : [];
    });
  }

  public async getLanguages(): Promise<ExportLanguage[]> {
    const data = (await this.call((service) => service.getParamIdiomas({}))).FEXGetPARAM_IdiomasResult;

    assertNoError(data, 'los idiomas');

    return asArray(data?.FEXResultGet?.ClsFEXResponse_Idi).flatMap((row) => {
      const id = Number(row.Idi_Id);

      return Number.isInteger(id) ? [{ id, name: readText(row.Idi_Ds) }] : [];
    });
  }

  public async getUnits(): Promise<ExportUnit[]> {
    const data = (await this.call((service) => service.getParamUMed({}))).FEXGetPARAM_UMedResult;

    assertNoError(data, 'las unidades de medida');

    return asArray(data?.FEXResultGet?.ClsFEXResponse_UMed).flatMap((row) => {
      const id = Number(row.Umed_Id);

      return Number.isInteger(id) ? [{ id, name: readText(row.Umed_Ds) }] : [];
    });
  }

  /**
   * `FEXGetLast_CMP` lleva `Pto_venta` y `Cbte_Tipo` dentro de `Auth`, pero `@arcasdk/core` arma
   * `{ Auth: {Token, Sign, Cuit}, ...params }`: si los mandamos en un `Auth` propio, el suyo se pierde, y sin ellos ARCA
   * contesta 1606 (ralcorta/arcasdk#238 lo arregla y sigue abierto). Con el `Auth` completo, token y firma incluidos,
   * el nuestro gana y llega entero.
   */
  public async getLastVoucherNumber(arcaType: number, pointOfSale: number): Promise<number> {
    if (!this.authenticate) {
      throw new AppError('El gateway de WSFEX se creó sin autenticador: no puede consultar el último número.', {
        code: 'UNEXPECTED_ERROR',
      });
    }

    const auth = await this.authenticate();
    const data = (
      await this.call((service) =>
        service.getLastCmp({ Auth: { ...auth, Cbte_Tipo: arcaType, Pto_venta: pointOfSale } } as IFEXGetLast_CMPInput),
      )
    ).FEXGetLast_CMPResult;

    assertNoError(data, 'el último número');

    return Number(data?.FEXResult_LastCMP?.Cbte_nro) || 0;
  }

  public async getLastRequestId(): Promise<number> {
    const data = (await this.call((service) => service.getLastId({}))).FEXGetLast_IDResult;

    assertNoError(data, 'el último ID de solicitud');

    return Number(data?.FEXResultGet?.Id) || 0;
  }

  /**
   * La cotizacion de la `E` es la de aduana, que WSFEX publica una vez por dia: `FEXGetPARAM_MON_CON_COTIZACION`
   * devuelve por moneda la ultima publicada hasta `arcaDate`, con el dia al que corresponde. `Fecha_CTZ` va en
   * `yyyymmdd`: con guiones ARCA contesta el error 2054.
   */
  public async getQuotations(arcaDate: string): Promise<ExportQuotation[]> {
    const data = (await this.call((service) => service.getParamMonConCotizacion({ Fecha_CTZ: arcaDate })))
      .FEXGetPARAM_MON_CON_COTIZACIONResult;

    assertNoError(data, `las cotizaciones al ${formatArcaDateAsArgentineDate(arcaDate)}`);

    return asArray(data?.FEXResultGet?.ClsFEXResponse_Mon_CON_Cotizacion).flatMap((row) => {
      const code = readText(row.Mon_Id);
      const rate = Number(row.Mon_ctz);

      return code && Number.isFinite(rate) && rate > 0
        ? [{ code, date: parseWsfexQuotationDate(readText(row.Fecha_ctz)), rate }]
        : [];
    });
  }
}
