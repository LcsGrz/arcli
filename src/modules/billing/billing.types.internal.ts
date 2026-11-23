import type { CreateVoucherResultDto, INextVoucher, IVoucher } from '../../services/arca/arca-sdk.types';
import type { ArcliEnvironment } from '../config/config.schemas';
import type { PdfOutcome } from '../pdf/pdf.types';

import type { VoucherKindDefinition } from './billing.types';

/** Quien emite y donde: lo que facturar necesita del perfil de ARCA. */
export interface BillingRuntime {
  readonly cuit: number;
  readonly environment: ArcliEnvironment;
  readonly pointOfSale?: number;
}

export interface BillingGateway {
  /** Emite en ARCA. Un error aca puede haber dejado el comprobante autorizado. */
  createVoucher(voucher: IVoucher): Promise<CreateVoucherResultDto>;
  /** Autentica y pide el ultimo numero autorizado. Un error aca no emitio nada. */
  getNextVoucherNumber(pointOfSale: number, voucherType: number): Promise<number>;
  /**
   * La cotizacion oficial de ARCA. Sin `arcaDate`, la vigente (la del dia habil anterior a hoy); con `arcaDate`
   * (`yyyymmdd`), la ultima publicada hasta ese dia.
   */
  getQuotation(currencyCode: string, arcaDate?: string): Promise<number>;
  /**
   * Los codigos de la tabla de monedas de WSFEv1 (`FEParamGetTiposMonedas`). Opcional: un gateway sin ella (los
   * dobles de los tests, la sesion sin ARCA) no controla la moneda y decide ARCA.
   */
  getCurrencyCodes?(): Promise<readonly string[]>;
}

export interface BillingResponseSummary {
  readonly cae: string | null;
  readonly caeVencimiento: string | null;
  readonly errors: unknown[];
  readonly events: unknown[];
  readonly observaciones: string[];
  readonly observacion: string | null;
  readonly raw: CreateVoucherResultDto | null;
  readonly resultado: string | null;
  readonly suggestions: string[];
  readonly status: 'aprobado' | 'observado' | 'previsualizacion' | 'rechazado';
}

export interface BillingExecutionResult {
  readonly dryRun: boolean;
  readonly environment: 'produccion' | 'testing';
  readonly payload: INextVoucher;
  /** Solo si se intento generar el PDF. */
  readonly pdf?: PdfOutcome;
  /** Solo para mostrar: ARCA no recibe el nombre del receptor. */
  readonly receiver?: {
    readonly ivaConditionFromPadron: boolean;
    readonly name?: string;
  };
  readonly response: BillingResponseSummary;
  /** El numero con que se envio a ARCA; no esta en `payload` porque el SDK lo asigna al emitir. Solo si se emitio. */
  readonly voucherNumber?: number;
  readonly voucherKind: VoucherKindDefinition;
  readonly warnings?: readonly string[];
}
