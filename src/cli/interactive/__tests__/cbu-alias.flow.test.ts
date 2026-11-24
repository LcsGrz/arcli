import type { Command } from 'commander';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BillingCommandInput } from '../../../modules/billing/billing.schemas';
import { BillingService } from '../../../modules/billing/billing.service';
import type { VoucherShortcut } from '../../../modules/billing/billing.types';
import { type ArcliConfig, arcliConfigSchema } from '../../../modules/config/config.schemas';
import { buildEquivalentCommand } from '../../../modules/interactive/equivalent-command';
import { buildInvoiceInput } from '../../../modules/interactive/invoice-input';
import { runWizard } from '../../../modules/interactive/wizard';
import type { IssuedVoucher } from '../../../modules/vouchers/voucher-history';
import { systemClock } from '../../../services/time/system-clock';
import type { CliArcaRuntime } from '../../arca-runtime';
import { parseBillingCommandPlan } from '../../commands/billing.command.parser';
import { resolveBillingCommandDefaults } from '../../commands/billing.command.shared';
import { invoiceSteps } from '../invoice.flow';
import { repeatSteps } from '../repeat.flow';
import type { InteractiveSession } from '../session';

import { captured, comparableInput, parseWithProgram } from './equivalent-command.parse';
import { createScript, type ScriptedAnswer } from './script';

/**
 * REV-52, cruce 2 en el asistente: el CBU escrito a mano con un alias guardado en la config sin CBU. Va dos veces: como
 * está hoy (esa caracterización se borra en la tanda 4) y, en `it.fails`, como quedó aprobado.
 */

let script = createScript([]);

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  chooseStepWhileLoading: (...args: Parameters<typeof script.chooseStepWhileLoading>) =>
    script.chooseStepWhileLoading(...args),
  eraseLastAnswer: () => undefined,
  fitPageSize: () => 12,
}));

vi.mock('../../commands/billing.command.shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../commands/billing.command.shared')>()),
  executeBillingCommand: async (command: Command, shortcut: VoucherShortcut) => {
    captured.push({ command, shortcut });
  },
}));

type Steps = ReadonlyArray<readonly [RegExp, ScriptedAnswer]>;

const NOW = new Date('2026-11-18T15:00:00-03:00');
const EMITTER = 20111111112;
const CBU = '0110599520000012345678';
const ALIAS_QUESTION = 'Alias del CBU:';

const configWith = (extra: Partial<ArcliConfig> = {}) =>
  arcliConfigSchema.parse({ consultarPadron: false, cuit: String(EMITTER), ...extra });

const ONLY_ALIAS = configWith({ aliasCbu: 'alias.config' });

function createSession(config: ArcliConfig): InteractiveSession {
  const original: IssuedVoucher = {
    cae: '86400940834693',
    concept: 1,
    date: '20261101',
    documentNumber: 30709965812,
    documentTypeCode: 80,
    ivaAmount: 210_000,
    netAmount: 1_000_000,
    number: 14,
    total: 1_210_000,
  };

  return {
    arca: {} as never,
    billingGateway: { createVoucher: vi.fn(), getNextVoucherNumber: vi.fn(), getQuotation: vi.fn() },
    historyGateway: {
      getLastNumber: async () => original.number,
      getVoucher: async (number: number) => (number === original.number ? original : undefined),
    },
    runtime: {
      config,
      context: { cuit: EMITTER },
      cuit: EMITTER,
      environment: 'testing',
      outputJson: false,
      outputRaw: false,
      pointOfSale: 3,
    } as unknown as CliArcaRuntime,
    service: new BillingService({ clock: systemClock }),
  };
}

const PESOS = { advanced: { currencyCode: 'ARS', sameCurrency: false } } as const;

/** Los dos asistentes que preguntan el CBU, hasta el alias y desde ahí. */
const FLOWS = [
  {
    before: [
      [/comprobante/, 'Factura de crédito electrónica A'],
      [/A quién/, 'Con CUIT'],
      [/CUIT del receptor/, '30-70996581-2'],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/Qué estás facturando/, 'Productos'],
      [/Monto total/, '5.000.000'],
    ] as Steps,
    name: 'Emitir factura',
    run: (session: InteractiveSession) => runWizard(invoiceSteps(session), PESOS),
  },
  {
    before: [
      [/comprobante querés repetir/, 'Factura de crédito electrónica A'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/Mismo monto/, 'Sí'],
    ] as Steps,
    name: 'Repetir',
    run: (session: InteractiveSession) => runWizard(repeatSteps(session, 3, NOW), PESOS),
  },
];

/** El asistente entero, con lo que se responde en el CBU y el alias. */
async function answer(flow: (typeof FLOWS)[number], config: ArcliConfig, bankSteps: Steps) {
  script = createScript([...flow.before, ...bankSteps, [/Agregamos/, []]]);

  const session = createSession(config);
  const state = await flow.run(session);

  return buildInvoiceInput(state as NonNullable<typeof state>, session.runtime);
}

/**
 * El mismo asistente sin cortar si la pregunta del alias no aparece, para que el `it.fails` falle por lo que se emite y
 * no por el guion.
 */
async function answerAliasIfAsked(flow: (typeof FLOWS)[number], alias: string) {
  script = createScript([...flow.before, [/^CBU/, CBU], [/Agregamos/, []]]);

  const askText = script.askTextStep.getMockImplementation();

  script.askTextStep.mockImplementation(async (message, options) =>
    message === ALIAS_QUESTION ? alias : askText!(message, options),
  );

  const session = createSession(ONLY_ALIAS);
  const state = await flow.run(session);

  return buildInvoiceInput(state as NonNullable<typeof state>, session.runtime);
}

/** La entrada que arma el CLI con el comando equivalente, con la misma config. */
async function reparse(input: BillingCommandInput, config: ArcliConfig) {
  const line = buildEquivalentCommand(input, {
    defaultCurrency: config.monedaPorDefecto,
    environment: 'testing',
    issuerCuit: EMITTER,
    platform: 'linux',
  });
  const { command, shortcut } = await parseWithProgram(line, 'linux');
  const plan = parseBillingCommandPlan(command, shortcut as VoucherShortcut, resolveBillingCommandDefaults(config));

  return plan.inputs[0] as BillingCommandInput;
}

async function expectRoundtrip(input: BillingCommandInput, config: ArcliConfig): Promise<void> {
  expect(comparableInput(await reparse(input, config), EMITTER)).toEqual(comparableInput(input, EMITTER));
}

const asked = () => script.askTextStep.mock.calls.map(([message]) => message);

describe.each(FLOWS)('$name una FCE con el CBU escrito a mano', (flow) => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.mocked(process.stdout.write).mockRestore();
  });

  it('cruce 2, hoy (cambia en la tanda 4): con un alias guardado no lo pregunta y lo informa', async () => {
    const input = await answer(flow, ONLY_ALIAS, [[/^CBU/, CBU]]);

    expect(script.remaining()).toBe(0);
    expect(input).toMatchObject({ cbu: CBU, cbuAlias: 'alias.config' });
    await expectRoundtrip(input, ONLY_ALIAS);
  });

  // Tests primero (REV-52): pasa a it() al implementarlo.
  it.fails('cruce 2, aprobado: pregunta el alias aunque haya uno guardado, y va el escrito', async () => {
    const input = await answerAliasIfAsked(flow, 'alias.escrito');

    expect(input.cbuAlias).toBe('alias.escrito');
    expect(asked()).toContain(ALIAS_QUESTION);
    await expectRoundtrip(input, ONLY_ALIAS);
  });

  // Tests primero (REV-52): pasa a it() al implementarlo.
  it.fails(
    'cruce 2, aprobado: con Enter en el alias no va ninguno, y el comando equivalente tampoco lo suma',
    async () => {
      const input = await answerAliasIfAsked(flow, '');

      expect(input).toMatchObject({ cbu: CBU });
      expect(input.cbuAlias).toBeUndefined();
      await expectRoundtrip(input, ONLY_ALIAS);
    },
  );

  it('no cambia: sin alias guardado se pregunta, y va el escrito', async () => {
    const config = configWith();
    const input = await answer(flow, config, [
      [/^CBU/, CBU],
      [/^Alias del CBU/, 'alias.escrito'],
    ]);

    expect(script.remaining()).toBe(0);
    expect(input).toMatchObject({ cbu: CBU, cbuAlias: 'alias.escrito' });
    await expectRoundtrip(input, config);
  });

  it('no cambia: con el CBU en la config no pregunta ninguno, y va con su alias si lo tiene', async () => {
    const withAlias = configWith({ aliasCbu: 'alias.config', cbu: CBU });
    const withoutAlias = configWith({ cbu: CBU });

    expect(await answer(flow, withAlias, [])).toMatchObject({ cbu: CBU, cbuAlias: 'alias.config' });
    expect((await answer(flow, withoutAlias, [])).cbuAlias).toBeUndefined();
    expect(script.remaining()).toBe(0);
  });
});
