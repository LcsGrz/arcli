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
import type { VoucherHistoryGateway } from '../../modules/vouchers/voucher-history';
import { ArcaBillingGateway } from '../../services/arca/arca-billing.gateway';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { ArcaContextResolver, type ResolvedArcaRuntime } from '../../services/arca/arca-context.resolver';
import { ArcaFceObligationGateway } from '../../services/arca/arca-fce-obligation.gateway';
import { ArcaPadronGateway } from '../../services/arca/arca-padron.gateway';
import type { Arca } from '../../services/arca/arca-sdk.types';
import { ArcaVoucherHistoryGateway } from '../../services/arca/arca-voucher-history.gateway';
import { colorize, noticePanel, renderPanel, uiSymbol, writeTerminalOutput } from '../../ui';
import { formatBillingOutputs } from '../commands/billing.command.output';
import { startSpinner } from '../spinner';
import type { GlobalCliOptions } from '../types';

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

/** Los botones de "¿Emitimos?": los mismos que la pregunta de los comandos con flags. */
export const EMIT_NOW_LABEL = 'Sí, emitir ahora';
export const EMIT_IN_PRODUCTION_LABEL = 'Sí, emitir en producción';
export const DO_NOT_EMIT_LABEL = 'No, dejar sin emitir';
export const PRODUCTION_CONFIRMATION = 'Vas a emitir un comprobante real en PRODUCCIÓN. ¿Confirmás?';

/** "¿Emitimos?" y, en produccion, la segunda confirmacion. Si no, avisa que no se emitio nada. */
export async function confirmEmission(
  question: string,
  environment: ResolvedArcaRuntime['environment'],
): Promise<boolean> {
  const confirmed =
    (await confirm(question, EMIT_NOW_LABEL, DO_NOT_EMIT_LABEL)) &&
    (environment !== 'produccion' ||
      (await confirm(PRODUCTION_CONFIRMATION, EMIT_IN_PRODUCTION_LABEL, DO_NOT_EMIT_LABEL)));

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
 */
export async function previewAndEmit(session: InteractiveSession, rawInput: BillingCommandInput): Promise<void> {
  const { runtime, service } = session;
  // Lo mismo que con flags: padron, cotizacion oficial ("me pagan en dolares") y sus avisos, antes de la vista previa.
  const pointOfSale = rawInput.pointOfSale ?? session.typedPointOfSale;
  const prepared = await prepareBillingInput(
    service,
    { ...rawInput, pointOfSale },
    {
      billing: session.billingGateway,
      padron: new ArcaPadronGateway(session.arca),
    },
  );
  const input: BillingCommandInput = { ...prepared.input, dryRun: true, emit: false };
  const fceWarnings = runtime.config.verificarFce
    ? await resolveFceWarningsInOrder(service, [input], new ArcaFceObligationGateway(session.arca))
    : [];
  const warnings = [...prepared.warnings, ...(fceWarnings[0] ?? [])];
  const preview = await service.execute({ gateway: PREVIEW_GATEWAY, input, runtime, warnings });

  writeTerminalOutput(formatBillingOutputs([preview], { environment: runtime.environment, raw: false }));
  writeTerminalOutput(
    formatEquivalentCommand(
      buildEquivalentCommand(input, {
        defaultCurrency: runtime.config.monedaPorDefecto,
        environment: runtime.environment,
      }),
    ),
  );

  const label = formatVoucherWithArticle(preview.voucherKind);

  if (!(await confirmEmission(formatEmissionQuestion(label, runtime.environment), runtime.environment))) {
    return;
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
    await offerPdf(runtime.config, input, result);
  } catch (error) {
    spinner?.stop();
    throw error;
  }
}
