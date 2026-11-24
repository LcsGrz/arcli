import { InputIssuesError, InputValidationError } from '../../lib/errors/app-error';
import { checkFceCancellationInRegistry } from '../../modules/billing/billing.associated-lookup';
import {
  formatEmissionQuestion,
  formatVoucherWithArticle,
  NOTHING_EMITTED_NOTICE,
} from '../../modules/billing/billing.mappers';
import { prepareBillingInput, resolveFceWarningsInOrder } from '../../modules/billing/billing.prepare';
import type { BillingCommandInput } from '../../modules/billing/billing.schemas';
import { BillingService } from '../../modules/billing/billing.service';
import type { BillingGateway } from '../../modules/billing/billing.types.internal';
import { buildEquivalentCommand } from '../../modules/interactive/equivalent-command';
import { isAuthorized } from '../../modules/interactive/steps/config-offer';
import { validatePointOfSale } from '../../modules/interactive/validators';
import { BACK, type Back } from '../../modules/interactive/wizard';
import {
  type EmissionChoice,
  type EmissionConfirmationPlan,
  planEmissionConfirmation,
  resolvePdfAfterConfirmation,
} from '../../modules/pdf/pdf-decision';
import type { VoucherHistoryGateway } from '../../modules/vouchers/voucher-history';
import { ArcaBillingGateway } from '../../services/arca/arca-billing.gateway';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { ArcaFceObligationGateway } from '../../services/arca/arca-fce-obligation.gateway';
import { ArcaFceRegistryGateway } from '../../services/arca/arca-fce-registry.gateway';
import { ArcaPadronGateway } from '../../services/arca/arca-padron.gateway';
import type { Arca } from '../../services/arca/arca-sdk.types';
import { ArcaVoucherHistoryGateway } from '../../services/arca/arca-voucher-history.gateway';
import { systemClock } from '../../services/time/system-clock';
import { colorize, noticePanel, renderPanel, uiSymbol, writeTerminalOutput } from '../../ui';
import { type CliArcaRuntime, loadArcaRuntime } from '../arca-runtime';
import { formatBillingOutputs } from '../commands/billing.command.output';
import { recordEmission } from '../emitted-vouchers';
import { startSpinner } from '../spinner';
import type { GlobalCliOptions } from '../types';

import { askEmission, DO_NOT_EMIT_LABEL } from './emission-prompt';
import { assertOutputVisible, showAssistantError } from './output-guard';
import { offerPdf } from './pdf.flow';
import { askTextStep, confirm } from './prompts';

export interface InteractiveSession {
  readonly arca: Arca;
  readonly billingGateway: BillingGateway;
  readonly historyGateway: VoucherHistoryGateway;
  readonly runtime: CliArcaRuntime;
  readonly service: BillingService;
  /**
   * El punto de venta se escribio en el asistente porque la config no tiene uno: la entrada y el comando equivalente
   * lo llevan explicito, porque el comando pegado no lo encontraria en la config.
   */
  readonly typedPointOfSale?: number;
}

const PREVIEW_GATEWAY: BillingGateway = {
  createVoucher: async () => {
    throw new Error('La vista previa no emite comprobantes.');
  },
  getNextVoucherNumber: async () => {
    throw new Error('La vista previa no emite comprobantes.');
  },
  getQuotation: async () => {
    throw new Error('La vista previa no consulta cotizaciones.');
  },
};

/** Resuelve config y credenciales; si falta algo, el error explica que configurar. */
export function createInteractiveSession(options: GlobalCliOptions): InteractiveSession {
  const runtime = loadArcaRuntime(options);
  const arca = new ArcaClientFactory().create(runtime);

  return {
    arca,
    billingGateway: new ArcaBillingGateway(arca),
    historyGateway: new ArcaVoucherHistoryGateway(arca),
    runtime,
    service: new BillingService({ clock: systemClock }),
  };
}

export interface SessionWithPointOfSale {
  readonly pointOfSale: number;
  /** La misma sesion, con el punto de venta elegido en `runtime`: emitir y consultar usan ese. */
  readonly session: InteractiveSession;
}

/**
 * El punto de venta del flujo, antes del primer paso. El de la config, sin preguntar; si no hay, lo pide (Esc vuelve
 * al menu) y sugiere guardarlo para no escribirlo cada vez.
 */
export async function requirePointOfSale(session: InteractiveSession): Promise<SessionWithPointOfSale | undefined> {
  const configured = session.runtime.pointOfSale;

  if (configured) {
    return { pointOfSale: configured, session };
  }

  writeTerminalOutput(
    noticePanel(
      `No hay un punto de venta en la configuración. Para no escribirlo cada vez, cargalo en Configuración ${uiSymbol('arrow')} Modificar configuración ${uiSymbol('arrow')} Punto de venta.`,
      'muted',
    ),
  );

  const answer = await askTextStep('Punto de venta:', { validate: validatePointOfSale });

  if (answer === BACK) {
    return undefined;
  }

  const pointOfSale = Number(answer);

  return {
    pointOfSale,
    session: { ...session, runtime: { ...session.runtime, pointOfSale }, typedPointOfSale: pointOfSale },
  };
}

/**
 * La segunda confirmacion, en produccion. Los botones de "¿Emitimos?" estan en `emission-prompt`.
 *
 * @internal Exportado para los tests.
 */
export const EMIT_IN_PRODUCTION_LABEL = 'Sí, emitir en producción';
const PRODUCTION_CONFIRMATION = 'Vas a emitir un comprobante real en PRODUCCIÓN. ¿Confirmás?';

/** La respuesta a "¿Emitimos?": no emitir, emitir, o emitir y generar el PDF. */
export type EmissionAnswer = EmissionChoice | false;

/**
 * "¿Emitimos?" y, en produccion, la segunda confirmacion. Si no, avisa que no se emitio nada. Las opciones salen de
 * `planEmissionConfirmation`: siempre se puede elegir emitir con o sin PDF, y lo elegido decide (despues de emitir no
 * se pregunta nada mas del PDF). Esc en "¿Emitimos?" devuelve BACK, sin aviso: el asistente vuelve a su ultima pregunta
 * (TUI-15). En la segunda confirmacion, Esc sigue contando como no.
 */
export async function confirmEmission(
  question: string,
  environment: CliArcaRuntime['environment'],
  plan: EmissionConfirmationPlan,
): Promise<Back | EmissionAnswer> {
  const answer = await askEmission(question, plan, 'volver');

  if (answer === BACK) {
    return BACK;
  }

  const confirmed =
    answer &&
    (environment !== 'produccion' ||
      (await confirm(PRODUCTION_CONFIRMATION, EMIT_IN_PRODUCTION_LABEL, DO_NOT_EMIT_LABEL)))
      ? answer
      : false;

  if (!confirmed) {
    writeTerminalOutput(noticePanel(NOTHING_EMITTED_NOTICE, 'muted'));
  }

  return confirmed;
}

/** La vista previa y la emision como `confirm` de `runWizard`, y si ARCA lo autorizo. */
export interface EmissionStep<S> {
  /** Si ARCA autorizo lo emitido: aprobado u observado con CAE (`isAuthorized`). Antes de emitir o sin emitir, false. */
  readonly authorized: () => boolean;
  readonly confirm: (state: S) => Promise<Back | void>;
}

/**
 * El cierre de un flujo del asistente: `emit` hace la vista previa, pregunta "¿Emitimos?" y emite (`previewAndEmit` o
 * `emitExportVoucher`). Si devuelve BACK (Esc en "¿Emitimos?"), `runWizard` vuelve a la ultima pregunta con todo lo
 * respondido (TUI-15). Sin nada que emitir, `emit` devuelve `undefined`.
 */
export function emissionStep<S>(emit: (state: S) => Promise<Back | boolean> | undefined): EmissionStep<S> {
  let authorized = false;

  return {
    authorized: () => authorized,
    confirm: async (state) => {
      const result = await emit(state);

      if (result === BACK) {
        return BACK;
      }

      authorized = result ?? false;
    },
  };
}

export function formatEquivalentCommand(command: string): string {
  return renderPanel({
    borderType: 'command',
    content: [colorize('Esto equivale a:', 'muted'), '', colorize(command, 'info')],
    contentAlign: 'left',
    width: 'wide',
  });
}

/**
 * Un error de validacion de la vista previa (`InputValidationError` o `InputIssuesError`: lo que el CLI rechazaria
 * con `INPUT_VALIDATION_ERROR`) se muestra y devuelve BACK: como `confirm` de `runWizard`, el asistente vuelve a la
 * ultima pregunta con todo lo respondido, en vez de volver al menu y perderlo (TUI-15). Los errores de ARCA o de red
 * siguen de largo, como antes.
 */
export async function rejectedAsBack<T>(preview: () => Promise<T>): Promise<Back | T> {
  try {
    return await preview();
  } catch (error) {
    if (!(error instanceof InputValidationError || error instanceof InputIssuesError)) {
      throw error;
    }

    await showAssistantError(error);
    writeTerminalOutput(
      noticePanel(
        'No se emitió nada. Volvemos a la última pregunta con lo que respondiste: corregí el dato ahí o volvé con Esc hasta la pregunta que lo pide.',
        'muted',
      ),
    );

    return BACK;
  }
}

/** Lo mismo que con flags antes de la vista previa: padron, cotizacion oficial y avisos, y la vista previa. */
async function previewBilling(
  session: InteractiveSession,
  entry: BillingCommandInput,
  flowWarnings: readonly string[],
) {
  const { runtime, service } = session;
  // Lo mismo que con flags: padron, cotizacion oficial ("me pagan en dolares") y sus avisos, antes de la vista previa.
  const prepared = await prepareBillingInput(service, entry, {
    billing: session.billingGateway,
    padron: new ArcaPadronGateway(session.arca),
  });
  const input: BillingCommandInput = { ...prepared.input, dryRun: true, emit: false };
  const fceWarnings = runtime.config.verificarFce
    ? await resolveFceWarningsInOrder(service, [input], new ArcaFceObligationGateway(session.arca))
    : [];
  // Como con flags: una nota FCE de anulacion avisa si el comprador no rechazo el asociado en el Registro.
  const registryWarnings = await checkFceCancellationInRegistry({
    gateway: new ArcaFceRegistryGateway(session.arca),
    input,
    runtime,
    service,
  });
  const warnings = [...flowWarnings, ...prepared.warnings, ...(fceWarnings[0] ?? []), ...registryWarnings];
  const preview = await service.execute({ gateway: PREVIEW_GATEWAY, input, runtime, warnings });

  return { input, preview, warnings };
}

/**
 * Paso final comun a todos los flujos: vista previa, comando equivalente, confirmacion y emision.
 * Usa BillingService igual que los comandos con flags, asi que valida y emite exactamente lo mismo.
 * `flowWarnings` son avisos que solo sabe el flujo, como el de un asociado de otro sistema en una nota. Devuelve si ARCA
 * lo autorizo (`isAuthorized`): lo que se ofrece guardar en la config (el CBU de la FCE) solo se ofrece entonces. Con
 * Esc en "¿Emitimos?", o si la vista previa rechaza la entrada (`rejectedAsBack`), devuelve BACK sin emitir: el flujo lo corre como `confirm` de `runWizard`, que vuelve a la ultima
 * pregunta (TUI-15).
 */
export async function previewAndEmit(
  session: InteractiveSession,
  rawInput: BillingCommandInput,
  flowWarnings: readonly string[] = [],
): Promise<Back | boolean> {
  const { runtime, service } = session;
  const entry: BillingCommandInput = {
    ...rawInput,
    pointOfSale: rawInput.pointOfSale ?? session.typedPointOfSale,
  };
  const previewed = await rejectedAsBack(() => previewBilling(session, entry, flowWarnings));

  if (previewed === BACK) {
    return BACK;
  }

  const { input, preview, warnings } = previewed;

  writeTerminalOutput(formatBillingOutputs([preview], { environment: runtime.environment, raw: false }));
  // El comando equivalente sale de la entrada, como la escribiria quien usa el CLI, y no de la preparada: sin lo que la
  // vista previa completa (la cotizacion oficial, que pegado otro dia seria vieja). Lo que se emite sale de preparar
  // esa misma entrada (REV-72).
  writeTerminalOutput(
    formatEquivalentCommand(
      buildEquivalentCommand(entry, {
        defaultCurrency: runtime.config.monedaPorDefecto,
        environment: runtime.environment,
        issuerCuit: runtime.cuit,
        platform: process.platform,
      }),
    ),
  );

  const label = formatVoucherWithArticle(preview.voucherKind);

  const emission = await confirmEmission(
    formatEmissionQuestion(label, runtime.environment),
    runtime.environment,
    planEmissionConfirmation({ flags: [input.pdf], mode: runtime.config.pdf }),
  );

  if (emission === BACK || !emission) {
    return emission;
  }

  await assertOutputVisible();

  const spinner = startSpinner(`Emitiendo ${label} en ARCA...`);

  try {
    const result = recordEmission(
      await service.execute({
        gateway: session.billingGateway,
        input: { ...input, dryRun: false, emit: true },
        runtime,
        warnings,
      }),
    );

    spinner?.stop();
    writeTerminalOutput(
      formatBillingOutputs([result], { environment: runtime.environment, previewShown: true, raw: false }),
    );
    await offerPdf(runtime.config, { ...input, pdf: resolvePdfAfterConfirmation(input.pdf, emission) }, result);

    return isAuthorized(result.response);
  } catch (error) {
    spinner?.stop();
    throw error;
  }
}
