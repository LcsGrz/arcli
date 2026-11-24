/*
 * La solicitud de A, B y C, con los nombres de WSFE: es lo que sale en `solicitud` del JSON, asi que no se traduce.
 * Solo los campos que ARCLI manda. `services/arca` la pasa al SDK y comprueba que cada campo exista en el suyo.
 */

/** Fila de `Iva` (`AlicIva`): una alicuota. */
export interface VoucherRequestIva {
  readonly BaseImp: number;
  readonly Id: number;
  readonly Importe: number;
}

/** Fila de `CbtesAsoc`: el comprobante asociado a una nota. */
export interface VoucherRequestAssociated {
  readonly CbteFch?: string;
  readonly Cuit: string;
  readonly Nro: number;
  readonly PtoVta: number;
  readonly Tipo: number;
}

/** El periodo asociado a una nota, en lugar del comprobante (fechas `yyyymmdd`). */
export interface VoucherRequestPeriod {
  readonly FchDesde: string;
  readonly FchHasta: string;
}

/** Fila de `Opcionales`: en ARCLI, los datos de la FCE. */
export interface VoucherRequestOptional {
  readonly Id: string;
  readonly Valor: string;
}

/** El comprobante completo, con el numero que le toca. */
export interface VoucherRequest {
  readonly CanMisMonExt?: string;
  readonly CantReg: number;
  readonly CbteDesde: number;
  readonly CbteFch: string;
  readonly CbteHasta: number;
  readonly CbteTipo: number;
  readonly CbtesAsoc?: VoucherRequestAssociated[];
  readonly Concepto: number;
  readonly CondicionIVAReceptorId: number;
  readonly DocNro: number;
  readonly DocTipo: number;
  readonly FchServDesde?: string;
  readonly FchServHasta?: string;
  readonly FchVtoPago?: string;
  readonly ImpIVA: number;
  readonly ImpNeto: number;
  readonly ImpOpEx: number;
  readonly ImpTotConc: number;
  readonly ImpTotal: number;
  readonly ImpTrib: number;
  readonly Iva?: VoucherRequestIva[];
  readonly MonCotiz: number;
  readonly MonId: string;
  readonly Opcionales?: VoucherRequestOptional[];
  readonly PeriodoAsoc?: VoucherRequestPeriod;
  readonly PtoVta: number;
}

/** El comprobante sin numero: el de la vista previa. El numero se pide al emitir. */
export type UnnumberedVoucherRequest = Omit<VoucherRequest, 'CbteDesde' | 'CbteHasta'>;
