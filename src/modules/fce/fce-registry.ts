/** Estados de un comprobante en el Registro de Facturas de Credito Electronica (wsfecred). */
export type FceRegistryState = 'Aceptado' | 'InformadaAgDpto' | 'PendienteRecepcion' | 'Recepcionado' | 'Rechazado';

export interface FceRegistryStateEntry {
  readonly estado: FceRegistryState;
  readonly fechaHoraEstado: string;
}

/** Un comprobante en el Registro: se identifica por emisor, tipo, punto de venta y numero. */
export interface FceRegistryVoucherId {
  readonly arcaType: number;
  readonly cuit: number;
  readonly number: number;
  readonly pointOfSale: number;
}

export interface FceRegistryGateway {
  /** El estado actual del comprobante en el Registro, o `undefined` si el Registro no lo tiene. */
  getVoucherState(id: FceRegistryVoucherId): Promise<FceRegistryState | undefined>;
}

/** Como se lee cada estado en una frase: `(estado: aceptado)`. */
export const FCE_REGISTRY_STATE_LABELS: Readonly<Record<FceRegistryState, string>> = {
  Aceptado: 'aceptado',
  InformadaAgDpto: 'informado al agente de depósito',
  PendienteRecepcion: 'pendiente de recepción',
  Recepcionado: 'recibido',
  Rechazado: 'rechazado',
};

/** El historial de wsfecred no viene ordenado: el estado actual es el de fecha mas reciente. */
export function latestFceRegistryState(history: readonly FceRegistryStateEntry[]): FceRegistryState | undefined {
  let latest: FceRegistryStateEntry | undefined;

  for (const entry of history) {
    if (!latest || Date.parse(entry.fechaHoraEstado) >= Date.parse(latest.fechaHoraEstado)) {
      latest = entry;
    }
  }

  return latest?.estado;
}
