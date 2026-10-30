import type { IFEXAuthorizeOutput } from '@arcasdk/core/lib/application/dto/fex';

import type { PdfOutcome } from '../pdf/pdf.types';

/**
 * WSFEX solo emite comprobantes de exportacion, asi que la letra es siempre E y el tipo de comprobante
 * 19 (Factura E). Notas de credito y debito E quedan para mas adelante.
 */
export const EXPORT_VOUCHER_KIND = {
  arcaType: 19,
  displayName: 'Factura de exportación E',
  family: 'factura',
  letter: 'e',
  shortcut: 'fe',
} as const;

export type ExportVoucherKind = typeof EXPORT_VOUCHER_KIND;
export type ExportVoucherFamily = ExportVoucherKind['family'];
export type ExportVoucherLetter = ExportVoucherKind['letter'];

/** Tabla FEXGetPARAM_Tipo_Expo. */
export const EXPORT_TYPES = {
  1: 'Exportación definitiva de bienes',
  2: 'Servicios',
  4: 'Otros',
} as const;

export type ExportType = keyof typeof EXPORT_TYPES;

export const EXPORT_TYPE_VALUES: readonly ExportType[] = [1, 2, 4];

/**
 * Los tipos 2 (servicios) y 4 (otros) no llevan permisos de embarque: ARCA exige `Permiso_existente`
 * vacio en esos comprobantes (error 1550).
 */
export const EXPORT_TYPES_WITHOUT_PERMITS: readonly ExportType[] = [2, 4];

/**
 * Tipo de exportacion por defecto: la exportacion de servicios no lleva permisos de embarque ni bienes
 * fisicos, asi que es la que menos datos pide. Los bienes van con `--tipo-expo 1`.
 */
export const DEFAULT_EXPORT_TYPE: ExportType = 2;

/** Moneda por defecto de la factura de exportacion: en WSFEX el dolar es `DOL`. */
export const DEFAULT_EXPORT_CURRENCY_CODE = 'DOL';

/** Codigo de unidad de medida de ARCA que se usa cuando el item no indica otra. 7 = Unidad. */
export const DEFAULT_EXPORT_UNIT_CODE = 7;

/** Idioma por defecto del comprobante. 1 = Espanol. */
export const DEFAULT_EXPORT_LANGUAGE = 1;

/** Tope de numeracion de ARCA. */
export const MAX_EXPORT_VOUCHER_NUMBER = 99_999_999;

export interface ExportPermitPayload {
  readonly Dst_merc: number;
  readonly Id_permiso: string;
}

/** Cada entrada de `Actividades`: el codigo de la tabla de actividades de ARCA. */
export interface ExportActivityPayload {
  readonly Id: number;
}

/** Fila de `Cmps_asoc` (`ClsFEX_Cmp_asoc`): el comprobante asociado, con los nombres de ARCA. */
export interface ExportAssociatedVoucherPayload {
  readonly Cbte_cuit: number;
  readonly Cbte_nro: number;
  readonly Cbte_punto_vta: number;
  readonly Cbte_tipo: number;
}

/** Fila de `Opcionales` (`ClsFEX_Opcional`). */
export interface ExportOptionalPayload {
  readonly Id: string;
  readonly Valor: string;
}

export interface ExportItemPayload {
  readonly Pro_bonificacion: number;
  readonly Pro_codigo: string;
  readonly Pro_ds: string;
  readonly Pro_precio_uni: number;
  readonly Pro_qty: number;
  readonly Pro_total_item: number;
  readonly Pro_umed: number;
}

/**
 * El `Cmp` que recibe `FEXAuthorize`, con los mismos nombres que ARCA: es lo que sale en `solicitud` del JSON,
 * asi que no se traduce.
 */
export interface ExportVoucherPayload {
  readonly Actividades: { Actividad: ExportActivityPayload[] };
  readonly CanMisMonExt: 'N' | 'S';
  readonly Cbte_nro: number;
  readonly Cbte_Tipo: number;
  readonly Cliente: string;
  /**
   * ARCA rechaza el bloque vacio (error 1820: "Si envia Cmps_asoc, Cmp_asoc es obligatorio"), asi que solo va en el
   * `Cmp` cuando el comprobante informa comprobantes asociados: hoy nunca.
   */
  readonly Cmps_asoc?: { Cmp_asoc: ExportAssociatedVoucherPayload[] };
  readonly Cuit_pais_cliente: number;
  readonly Domicilio_cliente: string;
  readonly Dst_cmp: number;
  readonly Fecha_cbte: string;
  readonly Fecha_pago: string;
  readonly Forma_pago: string;
  readonly Id: number;
  readonly Id_impositivo: string;
  readonly Idioma_cbte: number;
  readonly Imp_total: number;
  readonly Incoterms: string;
  readonly Incoterms_Ds: string;
  readonly Items: { Item: ExportItemPayload[] };
  readonly Moneda_ctz: number;
  readonly Moneda_Id: string;
  readonly Obs: string;
  readonly Obs_comerciales: string;
  readonly Opcionales?: { Opcional: ExportOptionalPayload[] };
  /**
   * Vacio en los tipos de exportacion 2 y 4: ARCA pide el campo asi (error 1550). En el resto va `N` sin
   * permisos de embarque y `S` cuando el comprobante los informa.
   */
  readonly Permiso_existente: '' | 'N' | 'S';
  /**
   * ARCA rechaza el campo (error 1720) cuando `Permiso_existente` es `N` y tampoco lo acepta en los tipos 2 y 4
   * (error 1550), asi que solo va en el `Cmp` cuando el comprobante informa permisos de embarque.
   */
  readonly Permisos?: { Permiso: ExportPermitPayload[] };
  readonly Punto_vta: number;
  readonly Tipo_expo: ExportType;
}

export interface ExportCountry {
  readonly code: number;
  readonly name: string;
}

export interface ExportCountryCuit {
  readonly countryName: string;
  readonly cuit: number;
}

/** Una fila de `FEXGetPARAM_MON`: codigo de moneda de WSFEX (`DOL`, `060`) y su nombre. */
export interface ExportCurrency {
  readonly code: string;
  readonly name: string;
}

export interface ExportIncoterm {
  readonly code: string;
  readonly name: string;
}

export interface ExportLanguage {
  readonly id: number;
  readonly name: string;
}

export interface ExportUnit {
  readonly id: number;
  readonly name: string;
}

/** Una fila de `FEXGetPARAM_Actividades`: la tabla de actividades de WSFEX, que no es la del padron. */
export interface ExportActivity {
  readonly id: number;
  readonly name: string;
}

/**
 * Una fila de `FEXGetPARAM_MON_CON_COTIZACION`: la cotizacion de aduana que WSFEX tiene publicada para una moneda
 * a una fecha. La de la fecha pedida aparece cuando ARCA la publica, asi que hasta entonces viene la anterior.
 */
export interface ExportQuotation {
  readonly code: string;
  /** Fecha de la cotizacion en formato ARCA (`yyyymmdd`), anterior a la pedida si ese dia no hubo. */
  readonly date?: string;
  readonly rate: number;
}

/** `Moneda_Id`, `Moneda_ctz` y `CanMisMonExt` ya resueltos. */
export interface ExportCurrencyFields {
  readonly CanMisMonExt: 'N' | 'S';
  readonly Moneda_ctz: number;
  readonly Moneda_Id: string;
}

export interface ExportCurrencyResolution {
  readonly fields: ExportCurrencyFields;
  /** `true` si hay que pedir la cotizacion del dia a ARCA: no vino por flag ni por config. */
  readonly needsQuotation: boolean;
}

/** Nombres de las tablas de ARCA que se muestran en texto, PDF y JSON. */
export interface ExportDisplayInfo {
  readonly countryName?: string;
  /** Nombre de la moneda en la tabla de WSFEX ("Dólar Estadounidense"): el PDF lo muestra como divisa. */
  readonly currencyName?: string;
  readonly incotermName?: string;
  readonly languageName?: string;
  readonly unitNames: Readonly<Record<number, string>>;
}

/** Lo que el modulo necesita de ARCA. `authorize` es la unica llamada que emite. */
export interface ExportGateway {
  authorize(payload: ExportVoucherPayload): Promise<IFEXAuthorizeOutput>;
  /** Tabla de actividades de WSFEX: el `Cmp` solo acepta estos codigos, no los del padron. */
  getActivities(): Promise<readonly ExportActivity[]>;
  getCurrencies(): Promise<readonly ExportCurrency[]>;
  getDestinationCountries(): Promise<readonly ExportCountry[]>;
  getDestinationCountryCuits(): Promise<readonly ExportCountryCuit[]>;
  getIncoterms(): Promise<readonly ExportIncoterm[]>;
  getLanguages(): Promise<readonly ExportLanguage[]>;
  getLastRequestId(): Promise<number>;
  /**
   * Cotizaciones de aduana que WSFEX tiene publicadas para `arcaDate` (`yyyymmdd`). Devuelve solo las monedas con
   * cotizacion y, en `date`, el dia al que corresponde: si la del dia pedido todavia no salio, es la anterior.
   */
  getQuotations(arcaDate: string): Promise<readonly ExportQuotation[]>;
  getUnits(): Promise<readonly ExportUnit[]>;
}

export interface ExportItemInput {
  readonly code?: string;
  readonly description: string;
  readonly quantity: number;
  /** Codigo numerico de ARCA o nombre de la tabla de unidades ("unidades", "kilogramos"). */
  readonly unit?: number | string;
  readonly unitPrice: number;
}

export type ExportModeSource = 'default' | 'file' | 'flags';

/** Lo que llega de los flags o del JSON de `--cargar`; sin defaults de config todavia. */
export interface ExportVoucherInput {
  /** Codigo de la tabla de actividades de WSFEX; sin flag sale de `exportacion.actividad`. */
  readonly activity?: number;
  readonly amount?: number;
  readonly clientAddress?: string;
  readonly clientCountryCuit?: number;
  readonly clientName?: string;
  readonly clientTaxId?: string;
  readonly commercialObservations?: string;
  readonly currencyCode?: string;
  readonly description?: string;
  readonly destinationCountry?: string;
  readonly emit: boolean;
  readonly exchangeRate?: number;
  readonly exportType?: ExportType;
  readonly incoterm?: string;
  readonly incotermDescription?: string;
  readonly items?: readonly ExportItemInput[];
  readonly language?: number;
  readonly modeSource?: ExportModeSource;
  readonly observations?: string;
  readonly paymentDate?: string;
  readonly paymentTerms?: string;
  readonly pdf?: boolean;
  readonly permits?: readonly string[];
  readonly permitsExisting?: boolean;
  readonly pointOfSale?: number;
  readonly requestId?: number;
  readonly sameCurrency?: boolean;
  readonly voucherDate?: string;
  readonly voucherNumber?: number;
}

export interface ExportResponseError {
  readonly code?: number;
  readonly message: string;
}
export interface ExportResponseSummary {
  readonly cae: string | null;
  readonly caeVencimiento: string | null;
  readonly errors: readonly ExportResponseError[];
  readonly events: readonly ExportResponseError[];
  readonly observacion: string | null;
  readonly observaciones: readonly string[];
  readonly raw: IFEXAuthorizeOutput | null;
  readonly resultado: string | null;
  readonly status: 'aprobado' | 'observado' | 'rechazado';
  readonly suggestions: readonly string[];
}

export interface ExportExecutionResult {
  readonly display: ExportDisplayInfo;
  readonly dryRun: boolean;
  readonly environment: 'produccion' | 'testing';
  readonly payload: ExportVoucherPayload;
  /** Solo si se intento generar el PDF. */
  readonly pdf?: PdfOutcome;
  readonly response: ExportResponseSummary;
  readonly voucherKind: ExportVoucherKind;
  readonly warnings?: readonly string[];
}

/** Lo que se manda a `authorize`, con los nombres de las tablas resueltos para mostrar. */
export interface ResolvedExportVoucher {
  readonly display: ExportDisplayInfo;
  readonly payload: ExportVoucherPayload;
  /** Avisos de la resolucion, como la cotizacion tomada de un dia anterior. */
  readonly warnings?: readonly string[];
}
