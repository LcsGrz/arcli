import { AppError, InputIssuesError, InputValidationError } from '../../lib/errors/app-error';
import type { EmissionOutcome } from '../../modules/billing/billing.batch-run';
import type { EmissionInterruption } from '../../modules/billing/emission-interruption';
import { formatVoucherWithArticle } from '../../modules/billing/voucher-names';
import { isAuthorized } from '../../modules/interactive/steps/config-offer';
import { BACK, type Back } from '../../modules/interactive/wizard';
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
import { askEmission } from './emission-prompt';
import { assertOutputVisible } from './output-guard';
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
): Promise<Back | EmissionChoice | false> {
  const answer = await askEmission(question, plan, 'volver');

  if (answer === false) {
    writeTerminalOutput(noticePanel(NOTHING_EMITTED_NOTICE, 'muted'));
  }

  return answer;
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
 * que se ofrece guardar en la config solo se ofrece entonces. Con Esc en "¿Emitimos?", o si la vista previa rechaza la entrada (`rejectedAsBack`), devuelve BACK sin emitir: el flujo lo
 * corre como `confirm` de `runWizard`, que vuelve a la ultima pregunta (TUI-15).
 */
export async function closeWithEmission<R extends ClosingResult, P extends { readonly preview: R }>(
  closing: EmissionClosing<R, P>,
): Promise<Back | boolean> {
  const { pdf, queryErrors = false, runtime } = closing;
  const previewed = await rejectedAsBack(closing.preview, { queryErrors });

  if (previewed === BACK) {
    return BACK;
  }

  writeTerminalOutput(closing.format(previewed.preview, { previewShown: false }));
  writeTerminalOutput(formatEquivalentCommand(closing.equivalentCommand()));

  const label = formatVoucherWithArticle(previewed.preview.voucherKind);
  const choice = await confirmEmission(
    formatEmissionQuestion(label, runtime.environment),
    planEmissionConfirmation({ flags: [pdf], mode: runtime.config.pdf }),
  );

  if (choice === BACK || !choice) {
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
