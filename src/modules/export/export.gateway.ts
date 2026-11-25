import type { LastNumberPurpose } from '../../lib/errors/query-error';
import type { AuthorizationAnswer } from '../billing/authorization-answer';

import type {
  ExportActivity,
  ExportCountry,
  ExportCountryCuit,
  ExportCurrency,
  ExportIncoterm,
  ExportIssuedVoucher,
  ExportLanguage,
  ExportQuotation,
  ExportUnit,
  ExportVoucherPayload,
  ExportVoucherQuery,
} from './export.types';

/** Lo que el modulo necesita de ARCA. `authorize` es la unica llamada que emite. */
export interface ExportGateway {
  authorize(payload: ExportVoucherPayload): Promise<AuthorizationAnswer>;
  /** Tabla de actividades de WSFEX: el `Cmp` solo acepta estos codigos, no los del padron. */
  getActivities(): Promise<readonly ExportActivity[]>;
  /**
   * `FEXCheck_Permiso`: el `Status` que ARCA devuelve para un permiso de embarque y su pais de destino (`OK` o
   * `NO`), tal cual. Es una lectura: no emite nada.
   */
  checkPermit(permit: string, destinationCountry: number): Promise<string>;
  /** Un comprobante E ya emitido (`FEXGetCMP`), o `null` solo si ARCA dice que no existe; si no, `VoucherQueryError`. */
  getVoucher(query: ExportVoucherQuery): Promise<ExportIssuedVoucher | null>;
  getCurrencies(): Promise<readonly ExportCurrency[]>;
  getDestinationCountries(): Promise<readonly ExportCountry[]>;
  getDestinationCountryCuits(): Promise<readonly ExportCountryCuit[]>;
  getIncoterms(): Promise<readonly ExportIncoterm[]>;
  getLanguages(): Promise<readonly ExportLanguage[]>;
  getLastRequestId(): Promise<number>;
  /**
   * El ultimo numero autorizado de ese tipo en el punto de venta (`FEXGetLast_CMP`); 0 si no hay ninguno. `purpose`
   * (por defecto, consultar) decide la sugerencia si ARCA contesta con un error.
   */
  getLastVoucherNumber(arcaType: number, pointOfSale: number, purpose?: LastNumberPurpose): Promise<number>;
  /**
   * Cotizaciones de aduana que WSFEX tiene publicadas para `arcaDate` (`yyyymmdd`). Devuelve solo las monedas con
   * cotizacion y, en `date`, el dia al que corresponde: si la del dia pedido todavia no salio, es la anterior.
   */
  getQuotations(arcaDate: string): Promise<readonly ExportQuotation[]>;
  getUnits(): Promise<readonly ExportUnit[]>;
}

/** Las lecturas de WSFEX: lo que consulta la vista previa, sin la llamada que emite. */
export type ExportPreviewGateway = Omit<ExportGateway, 'authorize'>;

/** La llamada que emite. */
export type ExportEmissionGateway = Pick<ExportGateway, 'authorize'>;
