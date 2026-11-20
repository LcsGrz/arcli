import { formatArcaDateAsArgentineDate, formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { formatExchangeRate } from '../../lib/numbers/argentine-amount';
import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import { creditNoteOverTotalHint } from '../../modules/billing/billing.associated-lookup';
import { formatMoneyLabel } from '../../modules/billing/billing.labels';
import { formatVoucherLabel } from '../../modules/billing/billing.mappers';
import {
  applyExportAssociatedDefaults,
  assertExportNoteMatchesAssociated,
  exportAssociatedRuleContext,
} from '../../modules/export/export.notes';
import { EXPORT_RULES, type ExportRuleContext } from '../../modules/export/export.rules';
import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
  type ExportGateway,
  type ExportIssuedVoucher,
  type ExportVoucherInput,
  type ExportVoucherKind,
  getExportVoucherKindByArcaType,
} from '../../modules/export/export.types';
import { amountInputText, parseAmountInput } from '../../modules/interactive/amount-input';
import { buildExportNoteInput, type ExportNoteState } from '../../modules/interactive/export-note-input';
import type { ExportRuleScope } from '../../modules/interactive/export-optionals';
import { rulesFinalize } from '../../modules/interactive/rule-validator';
import { BACK, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';
import { formatVoucherNumber } from '../../modules/vouchers/voucher-history.presenter';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { withSpinner } from '../spinner';

import { askPermitsStep, emitExportVoucher } from './export.flow';
import { exportOptionalsStep, validateExportText } from './export-options';
import { withFinalizeNotice } from './finalize-notice';
import { askTextStep } from './prompts';
import { type InteractiveSession, requirePointOfSale } from './session';
import { validateAmount, validatePositiveInteger } from './validators';

/** Como se nombra el asociado en las preguntas: "la factura E", "la nota de débito E". */
const ASSOCIATED_NAMES: Record<ExportVoucherKind['shortcut'], string> = {
  fe: 'la factura E',
  nce: 'la nota de crédito E',
  nde: 'la nota de débito E',
};

function associatedName(kind: ExportVoucherKind | undefined): string {
  return ASSOCIATED_NAMES[(kind ?? EXPORT_VOUCHER_KIND).shortcut];
}

/** "Factura de exportación E 00004-00000001 del 30/10/2026 a ACME LLC, por 1.500 USD". */
function describeInvoice(invoice: ExportIssuedVoucher): string {
  const kind = getExportVoucherKindByArcaType(invoice.arcaType) ?? EXPORT_VOUCHER_KIND;

  return `${kind.displayName} ${formatVoucherNumber(invoice.pointOfSale, invoice.number)} del ${formatArcaDateAsArgentineDate(invoice.date)} a ${invoice.clientName}, por ${formatMoneyLabel(invoice.total, invoice.currencyCode)}.`;
}

/**
 * Lo que ARCA controla entre el tipo de la nota y el de su asociado (una ND de servicios solo ajusta una factura,
 * una NC no ajusta otra NC...), con las mismas reglas que el CLI, antes de pedir el monto. Con `date` (la fecha elegida
 * en los opcionales; por defecto hoy) controla tambien que la nota no sea anterior al asociado. El monto se valida
 * despues, en la vista previa.
 */
function validateAssociated(
  voucherKind: ExportVoucherKind,
  associated: ExportIssuedVoucher,
  date = formatDateAsArcaDate(new Date()),
): string | true {
  try {
    assertExportNoteMatchesAssociated({
      associated,
      kind: voucherKind,
      note: {
        amount: 0,
        currencyCode: associated.currencyCode,
        date,
        destinationCountry: associated.destinationCountry,
        exchangeRate: associated.exchangeRate,
        exportType: associated.exportType,
      },
    });

    return true;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Pasos de la nota E sobre `associatedKind` (la factura E u otra nota E, elegido en el selector de comprobantes): el
 * comprobante que ajusta (se busca en ARCA y de ahi salen cliente, destino y moneda), el monto, el detalle, en bienes
 * los permisos de embarque, y los opcionales. Cada uno se puede deshacer con "Volver".
 */
export function exportNoteSteps(
  kind: 'credito' | 'debito',
  gateway: Pick<ExportGateway, 'getLanguages' | 'getUnits' | 'getVoucher'>,
  pointOfSale: number,
): Array<WizardStep<ExportNoteState>> {
  const voucherKind = kind === 'credito' ? EXPORT_CREDIT_NOTE_KIND : EXPORT_DEBIT_NOTE_KIND;

  return withFinalizeNotice([
    {
      name: 'punto-venta-factura',
      run: async (state, previous) => {
        const answer = await askTextStep(`Punto de venta de ${associatedName(state.associatedKind)}:`, {
          defaultValue: String(pointOfSale),
          previousAnswer: previous?.invoicePointOfSale === undefined ? undefined : String(previous.invoicePointOfSale),
          validate: validatePositiveInteger('El punto de venta'),
        });

        return answer === BACK ? BACK : { invoicePointOfSale: parseStrictInteger(answer) };
      },
    },
    {
      // Se busca en ARCA en ese punto de venta.
      dependsOn: ['punto-venta-factura'],
      name: 'factura',
      run: async (state, previous) => {
        const invoicePointOfSale = requireStepValue(state.invoicePointOfSale, 'invoicePointOfSale');
        const associatedKind = state.associatedKind ?? EXPORT_VOUCHER_KIND;
        const name = associatedName(associatedKind);

        // Se vuelve a preguntar hasta que ARCA tenga el comprobante y la nota pueda ajustarlo, o hasta "Volver".
        for (;;) {
          const answer = await askTextStep(`Número de ${name}:`, {
            previousAnswer: previous?.invoice ? String(previous.invoice.number) : undefined,
            validate: validatePositiveInteger('El número'),
          });

          if (answer === BACK) {
            return BACK;
          }

          const number = parseStrictInteger(answer) as number;
          const invoice = await withSpinner(`Buscando ${name} en ARCA...`, () =>
            gateway.getVoucher({ arcaType: associatedKind.arcaType, number, pointOfSale: invoicePointOfSale }),
          );

          if (!invoice) {
            writeTerminalOutput(
              noticePanel(
                `ARCA no tiene ${name} ${formatVoucherNumber(invoicePointOfSale, number)}. Revisá el número o el punto de venta.`,
                'warning',
              ),
            );
            continue;
          }

          writeTerminalOutput(noticePanel(describeInvoice(invoice), 'info'));

          const valid = validateAssociated(voucherKind, invoice);

          if (valid === true) {
            return { invoice };
          }

          writeTerminalOutput(noticePanel(valid, 'warning'));
        }
      },
    },
    {
      // Va en la moneda de la factura, y en la NC con su total como tope.
      dependsOn: ['factura'],
      name: 'monto',
      run: async (state, previous) => {
        const invoice = requireStepValue(state.invoice, 'invoice');
        const answer = await askTextStep(`Monto de la ${formatVoucherLabel(voucherKind)} (${invoice.currencyCode}):`, {
          previousAnswer: amountInputText(previous?.amount),
          validate: (value) => {
            const valid = validateAmount(value);

            // Como el CLI: el tope solo vale si la NC no ajusta otra NC.
            if (valid !== true || kind !== 'credito' || invoice.arcaType === EXPORT_CREDIT_NOTE_KIND.arcaType) {
              return valid;
            }

            return (parseAmountInput(value) ?? 0) <= invoice.total
              ? true
              : creditNoteOverTotalHint(
                  `${associatedName(state.associatedKind)} ${formatVoucherNumber(invoice.pointOfSale, invoice.number)}`,
                  invoice.total,
                  invoice.currencyCode,
                );
          },
        });

        return answer === BACK ? BACK : { amount: parseAmountInput(answer) };
      },
    },
    {
      name: 'descripcion',
      run: async (_state, previous) => {
        const answer = await askTextStep('Detalle de la nota (Enter para "Según detalle"):', {
          previousAnswer: previous?.description,
          validate: validateExportText('description'),
        });

        return answer === BACK ? BACK : { description: answer.trim() || undefined };
      },
    },
    {
      // Solo en bienes: los permisos son opcionales en la nota y van sin `--permiso-existente` (tabla de la 1720).
      name: 'permisos',
      run: askPermitsStep,
      skip: (state) => state.invoice?.exportType !== 1,
    },
    exportOptionalsStep<ExportNoteState>({
      context: (state) => {
        const invoice = requireStepValue(state.invoice, 'invoice');
        const name = associatedName(state.associatedKind);
        // En servicios ARCA exige la cotizacion del asociado (error 2053), y en pesos es 1: no se ofrece.
        const offersExchangeRate = invoice.currencyCode.trim().toUpperCase() !== 'PES' && invoice.exportType !== 2;

        return {
          amount: requireStepValue(state.amount, 'amount'),
          // El incoterm es el del asociado: con otro, su descripcion arranca como la primera vez. El idioma y los items
          // elegidos no dependen del asociado.
          associated: `${invoice.arcaType}:${invoice.pointOfSale}:${invoice.number}`,
          currencyCode: invoice.currencyCode,
          defaultExchangeRate: offersExchangeRate
            ? `la de ${name} (${formatExchangeRate(invoice.exchangeRate)})`
            : undefined,
          defaultLanguage: `el de ${name}`,
          exportType: invoice.exportType,
          incoterm: invoice.incoterm ? { code: invoice.incoterm, description: invoice.incotermDescription } : undefined,
          languages: () => gateway.getLanguages(),
          // Las mismas reglas que con flags: por ejemplo, la fecha no antes de la del asociado.
          rules: exportNoteRuleScope(state, kind),
          units: () => gateway.getUnits(),
        };
      },
      name: 'opcionales',
      read: (state) => state.options ?? {},
      write: (options) => ({ options }),
    }),
  ]);
}

/**
 * La nota como la ve `ExportService`: con lo respondido y, lo que no se pregunta (tipo de exportacion, moneda,
 * cotizacion), del asociado. Sin eso la ventana de la fecha seria la de servicios en una nota de bienes.
 */
function exportNoteRuleInput(state: ExportNoteState, kind: 'credito' | 'debito'): ExportVoucherInput {
  return applyExportAssociatedDefaults(
    buildExportNoteInput(state, { kind }),
    requireStepValue(state.invoice, 'invoice'),
  );
}

/** Las reglas de la E desde una pregunta de la nota: la nota con lo respondido, y la fecha de su asociado. */
function exportNoteRuleScope(state: ExportNoteState, kind: 'credito' | 'debito'): ExportRuleScope {
  return {
    context: {
      associated: exportAssociatedRuleContext(requireStepValue(state.invoice, 'invoice')),
      today: formatDateAsArcaDate(new Date()),
    },
    draft: (patch) => ({ ...exportNoteRuleInput(state, kind), ...patch }),
  };
}

/**
 * Nota de credito o debito E paso a paso sobre `associatedKind`. Usa ExportService igual que `arcli nce` y `arcli nde`.
 * Devuelve BACK si se vuelve desde el primer paso, para volver al selector de comprobantes.
 */
export async function runExportNoteFlow(
  baseSession: InteractiveSession,
  kind: 'credito' | 'debito',
  associatedKind: ExportVoucherKind = EXPORT_VOUCHER_KIND,
): Promise<typeof BACK | void> {
  const ready = await requirePointOfSale(baseSession);

  if (!ready) {
    return;
  }

  const { pointOfSale, session } = ready;

  const gateway = new ArcaClientFactory().createExportGateway(session.runtime);
  const state = await runWizard(exportNoteSteps(kind, gateway, pointOfSale), { associatedKind }, undefined, {
    // Las reglas sobre la nota final: si una falla, vuelve a la pregunta que escribe el campo.
    finalize: rulesFinalize<ExportNoteState, ExportVoucherInput, ExportRuleContext>({
      context: (current) => exportNoteRuleScope(current, kind).context,
      draft: (current) => (current.invoice ? exportNoteRuleInput(current, kind) : undefined),
      rules: EXPORT_RULES,
    }),
  });

  if (!state) {
    return BACK;
  }

  await emitExportVoucher(session, gateway, buildExportNoteInput(state, { kind }));
}
