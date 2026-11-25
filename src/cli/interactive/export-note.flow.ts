import { formatArcaDateAsArgentineDate, formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { asQuery } from '../../lib/errors/query-error';
import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import { creditNoteOverTotalHint, isCreditNoteOverTotal } from '../../modules/billing/billing.associated-lookup';
import { formatMoneyLabel } from '../../modules/billing/billing.labels';
import { formatVoucherWithArticle } from '../../modules/billing/voucher-names';
import { assertExportNoteMatchesAssociated, fetchExportAssociatedVoucher } from '../../modules/export/export.notes';
import {
  BILLS_EXPORT_TYPE,
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
  type ExportGateway,
  type ExportIssuedVoucher,
  type ExportVoucherKind,
  getExportVoucherKindByArcaType,
} from '../../modules/export/export.types';
import { copyExportItems } from '../../modules/interactive/export-copy';
import {
  buildExportNoteInput,
  exportNoteCurrencyCode,
  exportNoteFinalize,
  exportNoteRuleScope,
  type ExportNoteState,
} from '../../modules/interactive/export-note-input';
import { canChooseNoteCurrency, noteCurrencyChoices } from '../../modules/interactive/note-currency';
import { exportAsksExchangeRate } from '../../modules/interactive/steps/currency';
import { fieldLens } from '../../modules/interactive/steps/lens';
import { validatePositiveInteger } from '../../modules/interactive/validators';
import { BACK, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';
import { formatVoucherNumber } from '../../modules/vouchers/voucher-number';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { withSpinner } from '../spinner';

import { askPermitsStep, emitExportVoucher } from './export.flow';
import { exportOptionalsStep } from './export-options';
import { withFinalizeNotice } from './finalize-notice';
import { orShowQueryError } from './invoice-picker';
import { askTextStep, chooseStep } from './prompts';
import { emissionStep, type InteractiveSession, requirePointOfSale } from './session';
import { exportExchangeRateStep } from './steps/export';
import { exportItemsStep } from './steps/export-items';

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
 * una NC no ajusta otra NC...), con las mismas reglas que el CLI, antes de pedir los items. Con `date` (la fecha elegida
 * en los opcionales; por defecto hoy) controla tambien que la nota no sea anterior al asociado. El tope de la NC se
 * controla en el total de los items.
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

/** Como en "Repetir" E: por que los items arrancan con un renglon por el total. */
function showItemsLimitation(invoice: ExportIssuedVoucher): void {
  const { limitation } = copyExportItems(invoice);

  if (limitation) {
    writeTerminalOutput(noticePanel(limitation, 'warning'));
  }
}

/** Lo que las reglas de la nota E toman de la sesion, con hoy leido cada vez que se pide (ARQ-19). */
const noteRuleEnv = (kind: 'credito' | 'debito') => () => ({ kind, today: formatDateAsArcaDate(new Date()) });

/**
 * Pasos de la nota E sobre `associatedKind` (la factura E u otra nota E, elegido en el selector de comprobantes): el
 * comprobante que ajusta (se busca en ARCA y de ahi salen cliente y destino), la moneda si la suya no es pesos (esa
 * o pesos), los items (arrancan con los del asociado, salvo en pesos), en bienes los permisos de embarque, y los opcionales. Cada uno se puede deshacer con "Volver".
 *
 * @internal Exportado para los tests.
 */
export function exportNoteSteps(
  kind: 'credito' | 'debito',
  gateway: Pick<ExportGateway, 'getLanguages' | 'getUnits' | 'getVoucher'>,
  pointOfSale: number,
): Array<WizardStep<ExportNoteState>> {
  const voucherKind = kind === 'credito' ? EXPORT_CREDIT_NOTE_KIND : EXPORT_DEBIT_NOTE_KIND;
  const ruleEnv = noteRuleEnv(kind);

  return withFinalizeNotice([
    {
      name: 'punto-venta-factura',
      run: async (state, { previous }) => {
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
      run: async (state, { previous }) => {
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
          const invoice = await orShowQueryError(() =>
            withSpinner(`Buscando ${name} en ARCA...`, () =>
              asQuery(() =>
                fetchExportAssociatedVoucher(gateway, {
                  arcaType: associatedKind.arcaType,
                  number,
                  pointOfSale: invoicePointOfSale,
                }),
              ),
            ),
          );

          // Ya se mostro el error: no se sabe si existe.
          if (invoice === undefined) {
            continue;
          }

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
            // Si se puede elegir la moneda, recien ahi se sabe si se copian.
            if (!canChooseNoteCurrency({ currency: invoice.currencyCode })) {
              showItemsLimitation(invoice);
            }

            return { currency: undefined, invoice };
          }

          writeTerminalOutput(noticePanel(valid, 'warning'));
        }
      },
    },
    {
      // Las opciones son la moneda del asociado y pesos, como en las notas A, B y C.
      dependsOn: ['factura'],
      name: 'moneda',
      run: async (state, { previous }) => {
        const invoice = requireStepValue(state.invoice, 'invoice');
        const currency = await chooseStep(
          '¿En qué moneda va la nota?',
          noteCurrencyChoices(
            { currency: invoice.currencyCode },
            {
              asksExchangeRate: exportAsksExchangeRate({
                currencyCode: invoice.currencyCode,
                exportType: invoice.exportType,
              }),
            },
          ),
          previous?.currency ?? state.currency,
        );

        if (currency === BACK) {
          return BACK;
        }

        // En pesos no se copian: se cargan.
        if (currency === 'asociado') {
          showItemsLimitation(invoice);
        }

        return { currency };
      },
      skip: (state) => !canChooseNoteCurrency({ currency: state.invoice?.currencyCode }),
    },
    // Despues del asociado y de la moneda: en la suya, sin tocarla va la suya, como el CLI sin `--cm` (NAV-9).
    exportExchangeRateStep<ExportNoteState>({
      dependsOn: ['factura', 'moneda'],
      exchangeRate: fieldLens('exchangeRate'),
      rules: (state) => exportNoteRuleScope(state, ruleEnv),
      suggestion: async (state) => {
        const invoice = requireStepValue(state.invoice, 'invoice');

        return invoice.exchangeRate > 0
          ? { associated: associatedName(state.associatedKind), rate: invoice.exchangeRate, source: 'associated' }
          : undefined;
      },
      voucher: (state) => {
        const invoice = requireStepValue(state.invoice, 'invoice');

        return { currencyCode: exportNoteCurrencyCode(state), exportType: invoice.exportType };
      },
    }),
    // Arranca en el editor con los items del asociado; el total de la nota es su suma (NAV-10), y en la NC con el
    // total del asociado como tope. Con otro asociado, arranca con los de ese. En pesos sobre un comprobante en otra
    // moneda los importes no son los suyos: se cargan, y no hay tope.
    exportItemsStep<ExportNoteState>({
      // Como en "Repetir" E, la moneda por su ISO (REV-74, #12).
      currency: exportNoteCurrencyCode,
      dependsOn: ['factura', 'moneda'],
      initial: (state) =>
        state.currency === 'pesos' ? [] : copyExportItems(requireStepValue(state.invoice, 'invoice')).items,
      items: fieldLens('items'),
      units: () => gateway.getUnits(),
      validateTotal: (state) => (total) => {
        const invoice = requireStepValue(state.invoice, 'invoice');

        // Como el CLI: el tope solo vale si la NC no ajusta otra NC.
        if (
          kind !== 'credito' ||
          state.currency === 'pesos' ||
          invoice.arcaType === EXPORT_CREDIT_NOTE_KIND.arcaType ||
          !isCreditNoteOverTotal(total, invoice.total)
        ) {
          return true;
        }

        return creditNoteOverTotalHint(
          `${associatedName(state.associatedKind)} ${formatVoucherNumber(invoice.pointOfSale, invoice.number)}`,
          invoice.total,
          invoice.currencyCode,
        );
      },
      voucher: formatVoucherWithArticle(voucherKind),
    }),
    {
      // Solo en bienes: los permisos son opcionales en la nota y van sin `--permiso-existente` (tabla de la 1720).
      name: 'permisos',
      run: askPermitsStep,
      skip: (state) => state.invoice?.exportType !== BILLS_EXPORT_TYPE,
    },
    exportOptionalsStep<ExportNoteState>({
      context: (state) => {
        const invoice = requireStepValue(state.invoice, 'invoice');
        const name = associatedName(state.associatedKind);

        return {
          // El incoterm es el del asociado: con otro, su descripcion arranca como la primera vez. El idioma elegido no
          // depende del asociado.
          associated: `${invoice.arcaType}:${invoice.pointOfSale}:${invoice.number}`,
          currencyCode: exportNoteCurrencyCode(state),
          defaultLanguage: `el de ${name}`,
          exportType: invoice.exportType,
          incoterm: invoice.incoterm ? { code: invoice.incoterm, description: invoice.incotermDescription } : undefined,
          languages: () => gateway.getLanguages(),
          // Las mismas reglas que con flags: por ejemplo, la fecha no antes de la del asociado.
          rules: exportNoteRuleScope(state, ruleEnv),
        };
      },
      name: 'opcionales',
      read: (state) => state.options ?? {},
      write: (options) => ({ options }),
    }),
  ]);
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
    // Esc en "¿Emitimos?" vuelve a la ultima pregunta (TUI-15).
    confirm: emissionStep<ExportNoteState>((answered) =>
      emitExportVoucher(session, gateway, buildExportNoteInput(answered, { kind }), { associated: answered.invoice }),
    ).confirm,
    // Las reglas sobre la nota final: si una falla, vuelve a la pregunta que escribe el campo.
    finalize: exportNoteFinalize(noteRuleEnv(kind)),
  });

  return state ? undefined : BACK;
}
