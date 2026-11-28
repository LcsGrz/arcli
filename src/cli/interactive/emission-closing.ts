import { AppError, InputIssuesError, InputValidationError } from '../../lib/errors/app-error';
import type { EmissionOutcome } from '../../modules/billing/billing.batch-run';
import type { EmissionInterruption } from '../../modules/billing/emission-interruption';
import { formatVoucherWithArticle } from '../../modules/billing/voucher-names';
import { isEquivalentCommandShown } from '../../modules/config/config.schemas';
import { isAuthorized } from '../../modules/interactive/steps/config-offer';
import { BACK, type Back, type WizardConfirmContext, type WizardEditable } from '../../modules/interactive/wizard';
import {
  type EmissionChoice,
  type EmissionConfirmationPlan,
  planEmissionConfirmation,
  resolvePdfAfterConfirmation,
} from '../../modules/pdf/pdf-decision';
import { VoucherQueryError } from '../../modules/vouchers/voucher-history';
import { colorize, noticePanel, renderPanel, writeTerminalOutput } from '../../ui';
import type { CliArcaRuntime } from '../arca-runtime';
import { formatEmissionQuestion, NOTHING_EMITTED_NOTICE } from '../emission-texts';
import type { DeliveryInterruption } from '../interruption';

import { emitWaitingForArca } from './arca-wait';
import { askEmission, EDIT_DATA, type EditData } from './emission-prompt';
import { assertOutputVisible } from './output-guard';
import { chooseManyStep } from './prompts';
import { showAssistantError } from './show-assistant-error';

/**
 * "¿Emitimos?", la unica confirmacion, tambien en produccion (la pregunta lo dice). Con "No" avisa que no se emitio
 * nada. Las opciones salen de `planEmissionConfirmation`: siempre se puede elegir emitir con o sin PDF, y lo elegido
 * decide (despues de emitir no se pregunta nada mas del PDF). Esc devuelve BACK, sin aviso: el asistente vuelve a su
 * ultima pregunta (TUI-15).
 */
async function confirmEmission(
  question: string,
  plan: EmissionConfirmationPlan,
  editable: boolean,
): Promise<Back | EditData | EmissionChoice | false> {
  const answer = await askEmission(question, plan, 'volver', { editable });

  if (answer === false) {
    writeTerminalOutput(noticePanel(NOTHING_EMITTED_NOTICE, 'muted'));
  }

  return answer;
}

/** Debajo de la lista de datos: lo que no se edita desde "¿Emitimos?". */
const EDIT_DATA_HINT =
  'El tipo de comprobante no se cambia acá: para otro, elegí "No, dejar sin emitir" y empezá de nuevo.';

/**
 * "¿Qué datos cambiamos?", con el valor actual de cada dato. Lo marcado, en el orden de la lista; Esc (BACK) o Enter
 * sin marcar nada, una lista vacia.
 */
async function chooseDataToEdit(
  editable: readonly WizardEditable[],
  marked: readonly string[],
): Promise<readonly string[]> {
  const answer = await chooseManyStep(
    '¿Qué datos cambiamos?',
    editable.map(({ id, label, value }) => ({
      description: colorize(EDIT_DATA_HINT, 'muted'),
      name: `${label} — ${value}`,
      short: label,
      value: id,
    })),
    marked,
  );

  return answer === BACK ? [] : answer;
}

/**
 * "¿Emitimos?" hasta que se decide algo que no es "No, editar datos": con eso se abre la lista de datos, y si no se
 * marca nada (o Esc) se vuelve a preguntar. Con `reopen`, arranca por la lista con lo que estaba marcado.
 */
async function decideEmission(
  question: string,
  plan: EmissionConfirmationPlan,
  context: WizardConfirmContext,
): Promise<Back | EmissionChoice | false | { readonly edit: readonly string[] }> {
  let marking = context.reopen?.marked;

  for (;;) {
    if (marking) {
      const marked = await chooseDataToEdit(context.editable, marking);

      if (marked.length > 0) {
        return { edit: marked };
      }
    }

    const choice = await confirmEmission(question, plan, context.editable.length > 0);

    if (choice !== EDIT_DATA) {
      return choice;
    }

    marking = [];
  }
}

function formatEquivalentCommand(command: string): string {
  return renderPanel({
    borderType: 'command',
    content: [colorize('Esto equivale a:', 'muted'), '', colorize(command, 'info')],
    contentAlign: 'left',
    width: 'wide',
  });
}

/**
 * Un error de validacion de la vista previa (`InputValidationError` o `InputIssuesError`: lo que el CLI rechazaria
 * con `INPUT_VALIDATION_ERROR`), o una moneda sin cotizacion de ARCA (`ARCA_QUOTATION_ERROR`), se muestra y devuelve
 * BACK: como `confirm` de `runWizard`, el asistente vuelve a la ultima pregunta con todo lo respondido, en vez de volver
 * al menu y perderlo (TUI-15). Los demas errores de ARCA o de red siguen de largo, como antes. Con `queryErrors` (la E,
 * que en una nota consulta el asociado si ARCA lo contesto sin su tipo) tambien vuelve si no se sabe si un comprobante
 * existe (`VoucherQueryError`), como al elegirlo (ARQ-22).
 */
async function rejectedAsBack<T>(
  preview: () => Promise<T>,
  options: { readonly queryErrors: boolean },
): Promise<Back | T> {
  try {
    return await preview();
  } catch (error) {
    const queryError = options.queryErrors && error instanceof VoucherQueryError;
    const missingQuotation = error instanceof AppError && error.code === 'ARCA_QUOTATION_ERROR';

    if (!(
      queryError ||
      missingQuotation ||
      error instanceof InputValidationError ||
      error instanceof InputIssuesError
    )) {
      throw error;
    }

    await showAssistantError(error);
    writeTerminalOutput(
      noticePanel(
        `No se emitió nada. Volvemos a la última pregunta con lo que respondiste: ${queryError ? 'seguí desde ahí para volver a consultar.' : 'corregí el dato ahí o volvé con Esc hasta la pregunta que lo pide.'}`,
        'muted',
      ),
    );

    return BACK;
  }
}

/** Lo que el cierre usa de un resultado, en cualquier familia. */
interface ClosingResult {
  readonly dryRun: boolean;
  readonly response: Parameters<typeof isAuthorized>[0];
  readonly voucherKind: Parameters<typeof formatVoucherWithArticle>[0];
}

/**
 * El contexto de `confirm` de `runWizard` (`WizardConfirmContext`), con la vista previa que ya se mostro para ese mismo
 * estado. Lo arma `emissionStep`, que la guarda entre llamadas: con `reopen`, el cierre reabre la lista sin consultar
 * ARCA de nuevo (TUI-29).
 */
export interface EmissionContext extends WizardConfirmContext {
  /** Con `reopen`, la vista previa de la llamada anterior, si fue para el mismo estado. */
  readonly previewed?: unknown;
  /** Guarda la vista previa recien hecha, para reusarla si se vuelve con `reopen`. */
  readonly keepPreview?: (previewed: unknown) => void;
}

/** Sin datos editables ni vista previa guardada: el cierre de siempre, sin "No, editar datos". */
export const WITHOUT_EDIT: EmissionContext = { editable: [] };

/** Lo propio de cada familia en el cierre de un flujo. `P` es la vista previa, con lo que se va a emitir. */
export interface EmissionClosing<R extends ClosingResult, P extends { readonly preview: R }> {
  /**
   * El caso de uso de `modules`, con la entrada confirmada y lo que lo corta con Ctrl+C. Anota lo emitido apenas ARCA
   * responde.
   */
  readonly emit: (previewed: P, interruption: EmissionInterruption) => Promise<EmissionOutcome<R>>;
  /** Sale de la entrada, como la escribiria quien usa el CLI. */
  readonly equivalentCommand: () => string;
  readonly format: (result: R, options: { readonly previewShown: boolean }) => string;
  /**
   * Con lo elegido en "¿Emitimos?": despues de emitir no se pregunta nada mas del PDF. Las preguntas van en
   * `delivery.whileAsking`, y con Ctrl+C se deja de generar.
   */
  readonly generatePdf: (result: R, previewed: P, pdf: boolean, delivery: DeliveryInterruption) => Promise<void>;
  /** El PDF de la entrada, si ya viene decidido. */
  readonly pdf?: boolean;
  /** Con su spinner. Sin avisos de certificado: en el asistente van en el menu. */
  readonly preview: () => Promise<P>;
  /** Ver `rejectedAsBack`. */
  readonly queryErrors?: boolean;
  readonly runtime: Pick<CliArcaRuntime, 'config' | 'environment'>;
}

/**
 * El cierre de todos los flujos, tambien los de la E: vista previa, comando equivalente, "¿Emitimos?", emision y PDF.
 * Ctrl+C emitiendo, como en los comandos (`emitWaitingForArca`). Devuelve si ARCA lo autorizo (`isAuthorized`): lo
 * que se ofrece guardar en la config solo se ofrece entonces. Con Esc en "¿Emitimos?", o si la vista previa rechaza
 * la entrada (`rejectedAsBack`), devuelve BACK sin emitir: el flujo lo corre como `confirm` de `runWizard`, que vuelve
 * a la ultima pregunta (TUI-15).
 *
 * Con datos editables (`context.editable`), "¿Emitimos?" ofrece "No, editar datos": lo marcado en la lista vuelve como
 * `{ edit }`, para que `runWizard` pregunte solo eso. Esc o Enter sin marcar nada vuelven a "¿Emitimos?" con la misma
 * vista previa. Con `context.reopen` (Esc en la primera pregunta editada), la lista se abre de nuevo con lo marcado y
 * la vista previa de antes (`context.previewed`), sin consultar ARCA (TUI-29).
 */
export async function closeWithEmission<R extends ClosingResult, P extends { readonly preview: R }>(
  closing: EmissionClosing<R, P>,
  context: EmissionContext = WITHOUT_EDIT,
): Promise<Back | boolean | { readonly edit: readonly string[] }> {
  const { pdf, queryErrors = false, runtime } = closing;
  // Lo guarda `emissionStep` solo si el estado es el mismo objeto: es la vista previa de esta misma entrada.
  const kept = context.reopen ? (context.previewed as P | undefined) : undefined;
  const previewed = kept ?? (await rejectedAsBack(closing.preview, { queryErrors }));

  if (previewed === BACK) {
    return BACK;
  }

  if (!kept) {
    context.keepPreview?.(previewed);
    writeTerminalOutput(closing.format(previewed.preview, { previewShown: false }));

    if (isEquivalentCommandShown(runtime.config)) {
      writeTerminalOutput(formatEquivalentCommand(closing.equivalentCommand()));
    }
  }

  const label = formatVoucherWithArticle(previewed.preview.voucherKind);
  const choice = await decideEmission(
    formatEmissionQuestion(label, runtime.environment),
    planEmissionConfirmation({ flags: [pdf], mode: runtime.config.pdf }),
    context,
  );

  if (choice === BACK || typeof choice === 'object' || !choice) {
    return choice;
  }

  await assertOutputVisible();

  let authorized = false;

  await emitWaitingForArca(
    `Emitiendo ${label} en ARCA...`,
    (interruption) => closing.emit(previewed, interruption),
    async (outcome, delivery) => {
      // Lo muestra el menu, como cualquier error de un flujo.
      if ('error' in outcome) {
        throw outcome.error;
      }

      const [result] = outcome.results;

      // Error de quien llama: una vista previa nunca se muestra como emitida ni lleva PDF.
      if (result.dryRun) {
        throw new Error('El cierre del asistente recibió una entrada que no pide emitir.');
      }

      writeTerminalOutput(closing.format(result, { previewShown: true }));
      await closing.generatePdf(result, previewed, resolvePdfAfterConfirmation(pdf, choice), delivery);
      authorized = isAuthorized(result.response);
    },
  );

  return authorized;
}
