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
import { BACK } from '../../modules/interactive/wizard';
import {
  type EmissionChoice,
  type EmissionConfirmationPlan,
  planEmissionConfirmation,
  resolvePdfAfterConfirmation,
} from '../../modules/pdf/pdf-decision';
import type { VoucherHistoryGateway } from '../../modules/vouchers/voucher-history';
import { ArcaBillingGateway } from '../../services/arca/arca-billing.gateway';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { ArcaContextResolver, type ResolvedArcaRuntime } from '../../services/arca/arca-context.resolver';
import { ArcaFceObligationGateway } from '../../services/arca/arca-fce-obligation.gateway';
import { ArcaFceRegistryGateway } from '../../services/arca/arca-fce-registry.gateway';
import { ArcaPadronGateway } from '../../services/arca/arca-padron.gateway';
import type { Arca } from '../../services/arca/arca-sdk.types';
import { ArcaVoucherHistoryGateway } from '../../services/arca/arca-voucher-history.gateway';
import { colorize, noticePanel, renderPanel, uiSymbol, writeTerminalOutput } from '../../ui';
import { formatBillingOutputs } from '../commands/billing.command.output';
import { startSpinner } from '../spinner';
import type { GlobalCliOptions } from '../types';

import { askEmission, DO_NOT_EMIT_LABEL } from './emission-prompt';
import { offerPdf } from './pdf.flow';
import { askTextStep, confirm } from './prompts';
import { validatePointOfSale } from './validators';

export interface InteractiveSession {
  readonly arca: Arca;
  readonly billingGateway: BillingGateway;
  readonly historyGateway: VoucherHistoryGateway;
  readonly runtime: ResolvedArcaRuntime;
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
  const runtime = new ArcaContextResolver({ options }).resolve();
  const arca = new ArcaClientFactory().create(runtime);

  return {
    arca,
    billingGateway: new ArcaBillingGateway(arca),
    historyGateway: new ArcaVoucherHistoryGateway(arca),
    runtime,
    service: new BillingService(),
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

/** La segunda confirmacion, en produccion. Los botones de "¿Emitimos?" estan en `emission-prompt`. */
export const EMIT_IN_PRODUCTION_LABEL = 'Sí, emitir en producción';
const PRODUCTION_CONFIRMATION = 'Vas a emitir un comprobante real en PRODUCCIÓN. ¿Confirmás?';

/** La respuesta a "¿Emitimos?": no emitir, emitir, o emitir y generar el PDF. */
export type EmissionAnswer = EmissionChoice | false;

/**
 * "¿Emitimos?" y, en produccion, la segunda confirmacion. Si no, avisa que no se emitio nada. Las opciones salen de
 * `planEmissionConfirmation`: siempre se puede elegir emitir con o sin PDF, y lo elegido decide (despues de emitir no
 * se pregunta nada mas del PDF). Esc cuenta como no.
 */
export async function confirmEmission(
  question: string,
  environment: ResolvedArcaRuntime['environment'],
  plan: EmissionConfirmationPlan,
): Promise<EmissionAnswer> {
  const answer = await askEmission(question, plan);
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

export function formatEquivalentCommand(command: string): string {
  return renderPanel({
    borderType: 'command',
    content: [colorize('Esto equivale a:', 'muted'), '', colorize(command, 'info')],
    contentAlign: 'left',
    width: 'wide',
  });
}

/**
 * Paso final comun a todos los flujos: vista previa, comando equivalente, confirmacion y emision.
 * Usa BillingService igual que los comandos con flags, asi que valida y emite exactamente lo mismo.
 * `flowWarnings` son avisos que solo sabe el flujo, como el de un asociado de otro sistema en una nota. Devuelve si se
 * emitio: lo que se ofrece guardar en la config (el CBU de la FCE) solo se ofrece si llego a ARCA.
 */
export async function previewAndEmit(
  session: InteractiveSession,
  rawInput: BillingCommandInput,
  flowWarnings: readonly string[] = [],
): Promise<boolean> {
  const { runtime, service } = session;
  const entry: BillingCommandInput = {
    ...rawInput,
    pointOfSale: rawInput.pointOfSale ?? session.typedPointOfSale,
  };
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

  writeTerminalOutput(formatBillingOutputs([preview], { environment: runtime.environment, raw: false }));
  // El comando equivalente sale de la entrada, como la escribiria quien usa el CLI, y no de la preparada: sin lo que la
  // vista previa completa (la cotizacion oficial, que pegado otro dia seria vieja). Lo que se emite sale de preparar
  // esa misma entrada (REV-72).
  writeTerminalOutput(
    formatEquivalentCommand(
      buildEquivalentCommand(entry, {
        defaultCurrency: runtime.config.monedaPorDefecto,
        environment: runtime.environment,
        issuerCuit: runtime.context.cuit,
      }),
    ),
  );

  const label = formatVoucherWithArticle(preview.voucherKind);

  const emission = await confirmEmission(
    formatEmissionQuestion(label, runtime.environment),
    runtime.environment,
    planEmissionConfirmation({ flags: [input.pdf], mode: runtime.config.pdf }),
  );

  if (!emission) {
    return false;
  }

  const spinner = startSpinner(`Emitiendo ${label} en ARCA...`);

  try {
    const result = await service.execute({
      gateway: session.billingGateway,
      input: { ...input, dryRun: false, emit: true },
      runtime,
      warnings,
    });

    spinner?.stop();
    writeTerminalOutput(
      formatBillingOutputs([result], { environment: runtime.environment, previewShown: true, raw: false }),
    );
    await offerPdf(runtime.config, { ...input, pdf: resolvePdfAfterConfirmation(input.pdf, emission) }, result);
  } catch (error) {
    spinner?.stop();
    throw error;
  }

  return true;
}
