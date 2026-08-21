import type { ICbtesAsoc, IIva, INextVoucher } from '@arcasdk/core/lib/domain/types/voucher.types';

import { InputValidationError } from '../../lib/errors/app-error';
import type { ResolvedArcaRuntime } from '../../services/arca/arca-context.resolver';

import { resolveTaxAmounts } from './billing.amounts';
import { resolveAssociatedVouchers } from './billing.associated-vouchers';
import { DEFAULT_EXCHANGE_RATE } from './billing.constants';
import { resolveBillingDateRange } from './billing.date-range';
import {
  resolveBillingConceptCode,
  resolveBillingCurrencyCode,
  resolveBillingDocumentTypeCode,
  resolveBillingIvaConditionCode,
} from './billing.mappers';
import type { BillingCommandInput } from './billing.schemas';
import type { VoucherKindDefinition } from './billing.types';
import type { BillingExecutionResult, BillingGateway } from './billing.types.internal';
import { validateDocumentIdentity } from './billing.validation';
import { createDryRunResponse, mapBillingResponse } from './billing-response';
import { getVoucherKindByShortcut } from './voucher-kind-map';

export interface BillingExecutionOptions {
  readonly gateway: BillingGateway;
  readonly input: BillingCommandInput;
  readonly runtime: ResolvedArcaRuntime;
}

interface CliVoucherPayload extends Omit<INextVoucher, 'CbtesAsoc' | 'DocNro'> {
  CbtesAsoc?: ICbtesAsoc[];
  DocNro?: number;
  Iva?: IIva[];
}

export class BillingService {
  public async execute(options: BillingExecutionOptions): Promise<BillingExecutionResult> {
    const voucherKind = this.requireVoucherKind(options.input.shortcut);
    const payload = this.buildVoucherPayload(options.input, options.runtime, voucherKind);

    if (options.input.dryRun || !options.input.emit) {
      return {
        dryRun: true,
        environment: options.runtime.environment,
        payload,
        response: createDryRunResponse(),
        voucherKind,
      };
    }

    const response = await options.gateway.createNextVoucher(payload);

    return {
      dryRun: false,
      environment: options.runtime.environment,
      payload,
      response: mapBillingResponse(response),
      voucherKind,
    };
  }

  public buildVoucherPayload(
    input: BillingCommandInput,
    runtime: ResolvedArcaRuntime,
    voucherKind = this.requireVoucherKind(input.shortcut),
  ): INextVoucher {
    const pointOfSale = input.pointOfSale ?? runtime.pointOfSale;

    if (!pointOfSale) {
      throw new InputValidationError(
        'Falta el punto de venta. Use --punto-venta o --pv, o configurelo con "arcli config establecer puntoVenta <valor>".',
      );
    }

    const dateRange = resolveBillingDateRange(input);
    const concept = resolveBillingConceptCode(input.concept);
    const documentType = resolveBillingDocumentTypeCode(input.documentType);
    const ivaCondition = resolveBillingIvaConditionCode(input.ivaCondition);
    const associatedVouchers = resolveAssociatedVouchers({
      input,
      requireVoucherKind: (shortcut) => this.requireVoucherKind(shortcut),
      voucherKind,
    });
    const taxAmounts = resolveTaxAmounts(input.totalAmount, input.ivaCondition, voucherKind);

    validateDocumentIdentity(input, voucherKind);

    const payload: CliVoucherPayload = {
      CantReg: 1,
      CbteFch: dateRange.billingDate,
      CbteTipo: voucherKind.arcaType,
      Concepto: concept,
      CondicionIVAReceptorId: ivaCondition,
      DocTipo: documentType,
      FchServDesde: concept === 1 ? undefined : dateRange.serviceStartDate,
      FchServHasta: concept === 1 ? undefined : dateRange.serviceEndDate,
      FchVtoPago: concept === 1 ? undefined : dateRange.paymentDueDate,
      ImpIVA: taxAmounts.ivaAmount,
      ImpNeto: taxAmounts.netAmount,
      ImpOpEx: 0,
      ImpTotConc: 0,
      ImpTotal: input.totalAmount,
      ImpTrib: 0,
      MonCotiz: input.exchangeRate ?? DEFAULT_EXCHANGE_RATE,
      MonId: resolveBillingCurrencyCode(input.currencyCode),
      PtoVta: pointOfSale,
    };

    if (taxAmounts.iva) {
      payload.Iva = taxAmounts.iva;
    }

    if (typeof input.documentNumber === 'number') {
      payload.DocNro = input.documentNumber;
    }

    if (associatedVouchers) {
      payload.CbtesAsoc = associatedVouchers;
    }

    // El SDK tipa DocNro como obligatorio, pero el CLI permite omitirlo cuando el usuario no lo informa.
    return payload as INextVoucher;
  }

  private requireVoucherKind(shortcut: string): VoucherKindDefinition {
    const definition = getVoucherKindByShortcut(shortcut);

    if (!definition) {
      throw new InputValidationError(`El atajo "${shortcut}" no corresponde a un comprobante soportado.`);
    }

    return definition;
  }
}
