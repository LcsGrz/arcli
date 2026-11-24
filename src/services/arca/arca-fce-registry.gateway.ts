import type { Arca } from '@arcasdk/core';

import { AppError } from '../../lib/errors/app-error';
import {
  type FceRegistryGateway,
  type FceRegistryState,
  type FceRegistryStateEntry,
  type FceRegistryVoucherId,
  latestFceRegistryState,
} from '../../modules/fce/fce-registry';

import { FCE_NOT_AUTHORIZED_MESSAGE } from './arca-fce-obligation.gateway';
import { isNotAuthorized } from './not-authorized';

/** wsfecred `consultarHistorialEstadosComprobante`: "No existe el comprobante indicado". */
const VOUCHER_NOT_FOUND = 1105;

/** SOAP devuelve un objeto suelto cuando la lista tiene un solo elemento. */
function asList<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value as T];
}

export class ArcaFceRegistryGateway implements FceRegistryGateway {
  public constructor(private readonly arca: Arca) {}

  public async getVoucherState(id: FceRegistryVoucherId): Promise<FceRegistryState | undefined> {
    let output: Awaited<ReturnType<Arca['wsfecredService']['consultarHistorialEstadosComprobante']>>;

    try {
      output = await this.arca.wsfecredService.consultarHistorialEstadosComprobante({
        idComprobante: { CUITEmisor: id.cuit, codTipoCmp: id.arcaType, nroCmp: id.number, ptoVta: id.pointOfSale },
      });
    } catch (error) {
      if (isNotAuthorized(error)) {
        throw new AppError(FCE_NOT_AUTHORIZED_MESSAGE, { code: 'FCE_SERVICE_NOT_AUTHORIZED' });
      }

      throw error;
    }

    const result = output.consultarHistorialEstadosComprobanteReturn;
    const errors = asList(result.arrayErrores?.codigoDescripcion);

    if (errors.some((item) => Number(item.codigo) === VOUCHER_NOT_FOUND)) {
      return undefined;
    }

    // Sin codigo propio: quien consulta lo convierte en un aviso, nunca sale como error del comando.
    if (errors.length > 0) {
      throw new Error(
        `ARCA no informó el estado en el Registro de FCE: ${errors.map((item) => `${item.codigo} ${item.descripcion}`).join('; ')}`,
      );
    }

    return latestFceRegistryState(
      asList<FceRegistryStateEntry>(result.arrayHistorialEstados?.estadoHistorico as FceRegistryStateEntry[]),
    );
  }
}
