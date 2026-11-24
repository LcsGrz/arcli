import { formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { errorText } from '../../lib/files/file-error';
import { assertRules } from '../../lib/rules/rules';
import type { Clock } from '../../lib/time/clock';
import { MISSING_POINT_OF_SALE_MESSAGE } from '../config/config.schemas';
import { evaluateFceObligation, type FceObligationGateway, shouldCheckFceObligation } from '../fce/fce-obligation';
import type { PadronGateway } from '../padron/padron';

import { conceptCode, documentTypeCode, ivaConditionCode } from './arca-codes';
import { resolveTaxAmounts, sumTaxAmounts } from './billing.amounts';
import { resolveAssociatedPeriod } from './billing.associated-period';
import { resolveAssociatedVouchers } from './billing.associated-vouchers';
import {
  assertCurrencyInTable,
  isForeignCurrency,
  needsOfficialExchangeRate,
  resolveBillingCurrencyFields,
  resolveSameCurrencyQuotationDate,
  validateExchangeRateRange,
} from './billing.currency';
import { resolveBillingDateRange } from './billing.date-range';
import { resolveBillingDate } from './billing.dates';
import { shouldEmit } from './billing.emit-decision';
import { EmissionUncertainError } from './billing.errors';
import { resolveElectronicCreditOptionals } from './billing.fce';
import { missingIvaReceiverMessage, validateIvaConditionForVoucher } from './billing.iva-receptor';
import { type PadronResolution, resolveIvaConditionFromPadron } from './billing.padron';
import { CONSUMER_IDENTIFICATION_THRESHOLD_RULE } from './billing.rules';
import { type BillingCommandInput, describePointOfSaleOutOfRange, MAX_WSFE_POINT_OF_SALE } from './billing.schemas';
import type { VoucherKindDefinition } from './billing.types';
import type {
  BillingExecutionResult,
  BillingGateway,
  BillingResponseSummary,
  BillingRuntime,
} from './billing.types.internal';
import { validateDocumentIdentity, validateUncategorizedReceiver } from './billing.validation';
import { createDryRunResponse, mapBillingResponse } from './billing-response';
import { findArcaCurrency, resolveBillingCurrencyCode } from './currency-codes';
import { getVoucherKindByShortcut } from './voucher-kind-map';
import { formatVoucherSubject } from './voucher-names';
import type { UnnumberedVoucherRequest } from './voucher-request';

export interface BillingPreviewOptions {
  readonly input: BillingCommandInput;
  readonly runtime: BillingRuntime;
  readonly warnings?: readonly string[];
}

/** Las llamadas que emiten. */
export type BillingEmissionGateway = Pick<BillingGateway, 'createVoucher' | 'getNextVoucherNumber'>;

export interface BillingEmitOptions extends BillingPreviewOptions {
  readonly gateway: BillingEmissionGateway;
  /**
   * La vista previa que se confirmo: se emite su payload tal cual, sin armarlo de nuevo con la fecha de ahora (ARQ-21),
   * y solo se pide el numero. Sin ella (`--emitir`, `--json`), se arma al emitir.
   */
  readonly preview?: Pick<BillingExecutionResult, 'payload'>;
}

type ExchangeRateInput = Pick<
  BillingCommandInput,
  'billingDate' | 'currencyCode' | 'exchangeRate' | 'exchangeRateSource' | 'sameCurrency'
>;

function describeReceiver(input: BillingCommandInput): BillingExecutionResult['receiver'] {
  return { ivaConditionFromPadron: input.ivaConditionSource === 'padron', name: input.receiverName };
}

export interface BillingServiceOptions {
  readonly clock: Clock;
}

export class BillingService {
  private readonly clock: Clock;

  public constructor(options: BillingServiceOptions) {
    this.clock = options.clock;
  }

  /**
   * Completa la cotizacion oficial en moneda extranjera sin --cm: con --misma-moneda es obligatoria y sin ella es el
   * default. Se resuelve antes de la vista previa para que el preview muestre el valor que se va a enviar.
   */
  /**
   * Una moneda que ARCLI no conoce se busca en la tabla de WSFEv1 antes de pedir su cotizacion: si no esta, es error
   * de entrada (10037). Las de `ARCA_CURRENCIES` no se consultan. Si la tabla no se puede leer, sigue: decide ARCA.
   */
  public async assertKnownCurrency(
    input: BillingCommandInput,
    gateway: Pick<BillingGateway, 'getCurrencyCodes'>,
  ): Promise<void> {
    const arcaCode = resolveBillingCurrencyCode(input.currencyCode);

    if (!gateway.getCurrencyCodes || !isForeignCurrency(input) || findArcaCurrency(arcaCode)) {
      return;
    }

    let table: readonly string[];

    try {
      table = await gateway.getCurrencyCodes();
    } catch {
      return;
    }

    assertCurrencyInTable({ arcaCode, requested: input.currencyCode, service: 'wsfe', table });
  }

  /** Completa la cotizacion oficial de ARCA si hace falta. Tambien la usa el asistente, con solo los datos de moneda. */
  public async resolveExchangeRate<I extends ExchangeRateInput>(
    input: I,
    gateway: Pick<BillingGateway, 'getQuotation'>,
  ): Promise<I> {
    if (!needsOfficialExchangeRate(input)) {
      return input;
    }

    const today = this.today();
    // Con --misma-moneda y una fecha pasada, ARCA exige la del dia habil anterior a esa fecha (10038).
    const quotationDate = input.sameCurrency
      ? resolveSameCurrencyQuotationDate(resolveBillingDate(input, today), today)
      : undefined;
    const currencyCode = resolveBillingCurrencyCode(input.currencyCode);

    return {
      ...input,
      exchangeRate: quotationDate
        ? await gateway.getQuotation(currencyCode, quotationDate)
        : await gateway.getQuotation(currencyCode),
      // Con --misma-moneda la oficial es obligatoria, no un default: no hace falta avisar.
      exchangeRateSource: input.sameCurrency ? undefined : 'arca',
    };
  }

  /**
   * Compara la cotizacion que paso el usuario (`--cm`, el JSON o la config) con la oficial de ARCA y frena si esta
   * fuera del rango de la 10119. Si la consulta falla devuelve el aviso y sigue: ARCA decide al emitir.
   */
  public async checkExchangeRateRange(
    input: BillingCommandInput,
    gateway: Pick<BillingGateway, 'getQuotation'>,
  ): Promise<string[]> {
    if (
      !isForeignCurrency(input) ||
      input.sameCurrency ||
      input.exchangeRateSource === 'arca' ||
      typeof input.exchangeRate !== 'number'
    ) {
      return [];
    }

    let official: number;

    try {
      official = await gateway.getQuotation(resolveBillingCurrencyCode(input.currencyCode));
    } catch (error) {
      const reason = error instanceof Error ? errorText(error).replace(/\.$/, '') : 'error desconocido';

      return [
        `No se pudo comparar la cotización con la oficial de ARCA: ${reason}. ARCA la rechaza si no está entre el 2 % y el 500 % de la oficial (error 10119).`,
      ];
    }

    validateExchangeRateRange(input, official);

    return [];
  }

  public async resolveIvaConditionFromPadron(
    input: BillingCommandInput,
    gateway: PadronGateway,
  ): Promise<PadronResolution> {
    return resolveIvaConditionFromPadron(input, gateway);
  }

  /** La vista previa, sin hablar con ARCA: no recibe un gateway. */
  public preview(options: BillingPreviewOptions): BillingExecutionResult {
    const voucherKind = this.requireVoucherKind(options.input.shortcut);

    return {
      dryRun: true,
      environment: options.runtime.environment,
      payload: this.buildVoucherPayload(options.input, options.runtime, voucherKind),
      receiver: describeReceiver(options.input),
      response: createDryRunResponse(),
      voucherKind,
      warnings: options.warnings ?? [],
    };
  }

  /**
   * Emite siempre: si corresponde lo decide antes quien llama. Una entrada que no pide emitir es un error de programacion
   * de quien llama, no de quien factura: se frena aca, antes de pedir el numero.
   */
  public async emit(options: BillingEmitOptions): Promise<BillingExecutionResult> {
    if (!shouldEmit(options.input)) {
      throw new Error('BillingService.emit recibió una entrada que no pide emitir.');
    }

    const voucherKind = this.requireVoucherKind(options.input.shortcut);
    const payload = options.preview?.payload ?? this.buildVoucherPayload(options.input, options.runtime, voucherKind);

    // Resguardo: una nota FCE no llega a ARCA sin la fecha del asociado (10158). Sin `--afecha` la completa
    // checkAssociatedInArca antes de la vista previa; si quien llama no la consulto, se frena aca.
    if (voucherKind.isElectronicCredit && payload.CbtesAsoc?.some((associated) => !associated.CbteFch)) {
      throw new InputValidationError(
        `${formatVoucherSubject(voucherKind)} requiere la fecha del comprobante asociado. Usá \`--afecha <fecha>\`.`,
      );
    }

    // Fuera del try: si falla la autenticacion o el pedido del ultimo numero, no se envio nada a ARCA
    // y el error sale tal cual (certificado, ARCA no disponible), sin sugerir que pudo emitirse.
    const voucherNumber = await options.gateway.getNextVoucherNumber(payload.PtoVta, payload.CbteTipo);
    let response: BillingResponseSummary;

    try {
      const answer = await options.gateway.createVoucher({
        ...payload,
        CbteDesde: voucherNumber,
        CbteHasta: voucherNumber,
      });

      // Adentro del try: lo que no se puede leer es una emision sin confirmar (ERR-16).
      response = mapBillingResponse(answer);
    } catch (error) {
      throw new EmissionUncertainError({
        arcaType: voucherKind.arcaType,
        cause: error,
        environment: options.runtime.environment,
        pointOfSale: payload.PtoVta,
        shortcut: voucherKind.shortcut,
      });
    }

    return {
      dryRun: false,
      environment: options.runtime.environment,
      payload,
      receiver: describeReceiver(options.input),
      response,
      voucherNumber,
      voucherKind,
      warnings: options.warnings ?? [],
    };
  }

  /**
   * Avisa si el comprobante elegido no coincide con el regimen FCE del receptor.
   * Es informativo: si ARCA no responde, devuelve el motivo como aviso y no frena la emision.
   */
  public async resolveFceWarnings(input: BillingCommandInput, gateway: FceObligationGateway): Promise<string[]> {
    const voucherKind = this.requireVoucherKind(input.shortcut);

    if (!shouldCheckFceObligation(input, voucherKind)) {
      return [];
    }

    const issueDate = resolveBillingDate(input, this.today());
    const amountInPesos = input.totalAmount * (isForeignCurrency(input) ? (input.exchangeRate ?? 1) : 1);

    try {
      const obligation = await gateway.getObligation(input.documentNumber, issueDate);

      return evaluateFceObligation(obligation, voucherKind, amountInPesos);
    } catch (error) {
      const reason = error instanceof Error ? errorText(error) : 'error desconocido';

      return [`No se pudo verificar el régimen FCE del receptor: ${reason}`];
    }
  }

  /**
   * Lo que se puede validar sin ARCA: el punto de venta y el documento del receptor. Va antes de WSAA, del padron y de
   * la cotizacion (`prepareBillingInput`), asi un dato mal escrito no se ve como un error de red (ERR-11). El padron y
   * el asociado no los completan. `buildVoucherPayload` los vuelve a controlar, por si quien llama no preparo la entrada.
   */
  public assertLocalFields(input: BillingCommandInput, runtime: BillingRuntime): void {
    this.requirePointOfSale(input, runtime);
    validateDocumentIdentity(input, this.requireVoucherKind(input.shortcut), {
      emitterCuit: runtime.cuit,
      today: this.today(),
    });
  }

  public buildVoucherPayload(
    input: BillingCommandInput,
    runtime: BillingRuntime,
    voucherKind = this.requireVoucherKind(input.shortcut),
  ): UnnumberedVoucherRequest {
    // Resguardo: un IVA receptor que esperaba al padron nunca llega a ARCA con el valor provisorio.
    if (input.ivaConditionSource === 'missing') {
      throw new InputValidationError(missingIvaReceiverMessage());
    }

    const pointOfSale = this.requirePointOfSale(input, runtime);
    const today = this.today();
    const dateRange = resolveBillingDateRange(input, voucherKind, today);
    const concept = conceptCode(input.concept);
    const documentType = documentTypeCode(input.documentType);
    const ivaCondition = ivaConditionCode(input.ivaCondition);
    const associatedVouchers = resolveAssociatedVouchers({
      billingDate: dateRange.billingDate,
      emitterCuit: runtime.cuit,
      input,
      requireVoucherKind: (shortcut) => this.requireVoucherKind(shortcut),
      today,
      voucherKind,
    });
    const currencyFields = resolveBillingCurrencyFields(input);
    const taxAmounts = resolveTaxAmounts(input, voucherKind, today);

    const documentNumber = validateDocumentIdentity(input, voucherKind, { emitterCuit: runtime.cuit, today });

    validateUncategorizedReceiver(input, voucherKind, taxAmounts.netAmount + taxAmounts.ivaAmount);
    validateIvaConditionForVoucher(input.ivaCondition, voucherKind);
    // RG 5700/2025, con la cotizacion ya resuelta: la misma regla que el asistente.
    assertRules([CONSUMER_IDENTIFICATION_THRESHOLD_RULE], input, {
      exchangeRate: currencyFields.MonCotiz,
      today,
      voucherKind,
    });

    const associatedPeriod = resolveAssociatedPeriod(input, voucherKind, dateRange.billingDate, today);
    const optionals = resolveElectronicCreditOptionals(input, voucherKind);

    return {
      CantReg: 1,
      CbteFch: dateRange.billingDate,
      CbteTipo: voucherKind.arcaType,
      Concepto: concept,
      CondicionIVAReceptorId: ivaCondition,
      DocTipo: documentType,
      FchServDesde: dateRange.serviceStartDate,
      FchServHasta: dateRange.serviceEndDate,
      FchVtoPago: dateRange.paymentDueDate,
      ImpIVA: taxAmounts.ivaAmount,
      ImpNeto: taxAmounts.netAmount,
      ImpOpEx: taxAmounts.exemptAmount,
      ImpTotConc: taxAmounts.untaxedAmount,
      ImpTotal: sumTaxAmounts(taxAmounts),
      ImpTrib: 0,
      MonCotiz: currencyFields.MonCotiz,
      MonId: currencyFields.MonId,
      PtoVta: pointOfSale,
      // El orden de las claves es el de `solicitud` en el JSON.
      ...(currencyFields.CanMisMonExt ? { CanMisMonExt: currencyFields.CanMisMonExt } : {}),
      ...(taxAmounts.iva ? { Iva: taxAmounts.iva } : {}),
      DocNro: documentNumber,
      ...(associatedVouchers ? { CbtesAsoc: associatedVouchers } : {}),
      ...(associatedPeriod ? { PeriodoAsoc: associatedPeriod } : {}),
      ...(optionals ? { Opcionales: optionals } : {}),
    };
  }

  /** Hoy en Argentina (yyyymmdd), leido en cada operacion. */
  private today(): string {
    return formatDateAsArcaDate(this.clock.now());
  }

  private requirePointOfSale(input: BillingCommandInput, runtime: BillingRuntime): number {
    const pointOfSale = input.pointOfSale ?? runtime.pointOfSale;

    if (!pointOfSale) {
      throw new InputValidationError(MISSING_POINT_OF_SALE_MESSAGE);
    }

    // El de `--pv` lo frena la entrada; el de la config, aca.
    if (pointOfSale > MAX_WSFE_POINT_OF_SALE) {
      throw new InputValidationError(describePointOfSaleOutOfRange('El punto de venta', pointOfSale, 10004));
    }

    return pointOfSale;
  }

  private requireVoucherKind(shortcut: string): VoucherKindDefinition {
    const definition = getVoucherKindByShortcut(shortcut);

    if (!definition) {
      throw new InputValidationError(`El atajo "${shortcut}" no corresponde a un comprobante soportado.`);
    }

    return definition;
  }
}
