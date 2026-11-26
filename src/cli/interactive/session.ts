import type { ReadAssociated } from '../../modules/billing/billing.associated-lookup';
import { emitBilling, planBillingEmission } from '../../modules/billing/billing.emission';
import { type BillingPreviewItem, previewBilling } from '../../modules/billing/billing.preview';
import type { BillingCommandInput } from '../../modules/billing/billing.schemas';
import { BillingService } from '../../modules/billing/billing.service';
import type { BillingExecutionResult, BillingGateway } from '../../modules/billing/billing.types.internal';
import { buildEquivalentCommand } from '../../modules/interactive/equivalent-command';
import { validatePointOfSale } from '../../modules/interactive/validators';
import { BACK, type Back } from '../../modules/interactive/wizard';
import type { VoucherHistoryGateway } from '../../modules/vouchers/voucher-history';
import { ArcaBillingGateway } from '../../services/arca/arca-billing.gateway';
import { type ArcaClient, ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { ArcaVoucherHistoryGateway } from '../../services/arca/arca-voucher-history.gateway';
import { systemClock } from '../../services/time/system-clock';
import { noticePanel, uiSymbol, writeTerminalOutput } from '../../ui';
import { type CliArcaRuntime, loadArcaRuntime } from '../arca-runtime';
import { createBillingGateways } from '../billing-gateways';
import { formatBillingOutputs } from '../commands/billing.command.output';
import { recordEmission } from '../emitted-vouchers';
import type { GlobalCliOptions } from '../types';

import { waitForArca } from './arca-wait';
import { closeWithEmission } from './emission-closing';
import { offerPdf } from './pdf.flow';
import { askTextStep } from './prompts';

export interface InteractiveSession {
  readonly arca: ArcaClient;
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

/** Un comprobante suelto, como el del comando sin `--cargar`. */
const SINGLE = { inputIndexes: [1], invalidItems: [], isBatch: false, total: 1 } as const;

/**
 * El cierre de los flujos de A, B, C, FCE y recibos (`closeWithEmission`), con los casos de uso de los comandos con
 * flags: valida, avisa y emite exactamente lo mismo. Lo confirmado sale con lo que mostro la vista previa, sin armarlo
 * de nuevo (ARQ-21). `associated` es el asociado de una nota que el flujo ya leyo: no se consulta otra vez.
 */
export async function previewAndEmit(
  session: InteractiveSession,
  rawInput: BillingCommandInput,
  associated?: ReadAssociated,
): Promise<Back | boolean> {
  const { runtime } = session;
  const entry: BillingCommandInput = {
    ...rawInput,
    pointOfSale: rawInput.pointOfSale ?? session.typedPointOfSale,
  };

  return closeWithEmission<BillingExecutionResult, BillingPreviewItem>({
    emit: (item, interruption) =>
      emitBilling({
        ...interruption,
        clock: systemClock,
        gateway: session.billingGateway,
        items: planBillingEmission([{ ...item, confirmed: true, input: { ...item.input, dryRun: false, emit: true } }]),
        onEmitted: (result) => {
          recordEmission(result);
        },
        runtime,
        scope: SINGLE,
      }),
    // De la entrada y no de la preparada: sin lo que la vista previa completa (la cotizacion oficial, que pegado otro dia
    // seria vieja). Lo que se emite sale de preparar esa misma entrada (REV-72).
    equivalentCommand: () =>
      buildEquivalentCommand(entry, {
        defaultCurrency: runtime.config.monedaPorDefecto,
        environment: runtime.environment,
        issuerCuit: runtime.cuit,
        platform: process.platform,
      }),
    format: (result, { previewShown }) =>
      formatBillingOutputs([result], { environment: runtime.environment, previewShown, raw: false }),
    generatePdf: (result, { input }, pdf, delivery) => offerPdf(runtime.config, { ...input, pdf }, result, delivery),
    pdf: entry.pdf,
    preview: async () => {
      const [item] = await waitForArca(
        'Consultando ARCA...',
        () =>
          previewBilling({
            associated,
            clock: systemClock,
            gateways: {
              ...createBillingGateways(session.arca),
              billing: session.billingGateway,
              history: session.historyGateway,
            },
            plan: { ...SINGLE, inputs: [entry] },
            runtime,
          }),
        { pending: true },
      );

      return item;
    },
    runtime,
  });
}
