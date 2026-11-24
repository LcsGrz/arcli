import type { Command } from 'commander';
import fc from 'fast-check';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatArcaDateAsArgentineDate, formatDateAsArcaDate } from '../../../lib/dates/arca-date';
import { parseDateInputAsArcaDate } from '../../../lib/dates/relative-date';
import { InputValidationError } from '../../../lib/errors/app-error';
import { prepareBillingInput } from '../../../modules/billing/billing.prepare';
import { BILLING_RULES } from '../../../modules/billing/billing.rules';
import type { BillingCommandInput } from '../../../modules/billing/billing.schemas';
import { BillingService } from '../../../modules/billing/billing.service';
import type { VoucherShortcut } from '../../../modules/billing/billing.types';
import { DEFAULT_EXPORT_ITEM_DESCRIPTION, sumExportItems } from '../../../modules/export/export.items';
import { EXPORT_RULES } from '../../../modules/export/export.rules';
import { ExportService } from '../../../modules/export/export.service';
import {
  EXPORT_VOUCHER_KIND,
  type ExportGateway,
  type ExportItemInput,
  type ExportVoucherInput,
  type ExportVoucherKind,
  type ResolvedExportVoucher,
} from '../../../modules/export/export.types';
import { amountInputText, parseAmountInput, parseExchangeRateInput } from '../../../modules/interactive/amount-input';
import type { buildEquivalentCommand } from '../../../modules/interactive/equivalent-command';
import type { buildExportEquivalentCommand } from '../../../modules/interactive/export-equivalent-command';
import { BACK } from '../../../modules/interactive/wizard';
import type { PadronGateway } from '../../../modules/padron/padron';
import { systemClock } from '../../../services/time/system-clock';
import type { CliArcaRuntime } from '../../arca-runtime';
import { parseBillingCommandPlan } from '../../commands/billing.command.parser';
import { resolveBillingCommandDefaults } from '../../commands/billing.command.shared';
import { parseExportCommandPlan } from '../../commands/export.command.parser';
import { runExportFlow } from '../export.flow';
import { runExportNoteFlow } from '../export-note.flow';
import { runExportRepeatFlow } from '../export-repeat.flow';
import { runInvoiceFlow } from '../invoice.flow';
import { runNoteFlow } from '../note.flow';
import { runRepeatFlow } from '../repeat.flow';
import type { InteractiveSession } from '../session';

import { captured, comparableInput, parseWithProgram } from './equivalent-command.parse';
import {
  createRandomAssistant,
  describeEvents,
  finalPath,
  type PromptEvent,
  PromptLimitReached,
  type TextAnswers,
} from './random-assistant';
import {
  createBillingSession,
  createExportGateway,
  EXPORT_QUOTATION_RATE,
  NOW,
  OFFICIAL_RATE,
} from './screens.fixtures';

/**
 * Tests al azar del asistente (NAV-0, "Tests genéricos" del diseño del navegador): el asistente al azar de
 * `random-assistant.ts` recorre cada flujo de hoy, con Esc en cualquier pregunta, y despues se controlan las
 * invariantes sobre lo que llego a la vista previa:
 *
 * 1. Lo que aceptan las preguntas, la vista previa no lo rechaza, sin excepciones: las reglas entre campos corren al
 *    preguntar (`ruleValidator`, NAV-5).
 * 2. El comando equivalente, pegado en POSIX o en PowerShell, da la misma entrada que armo el asistente y la misma
 *    solicitud a ARCA que la vista previa.
 * 3. Nada de caminos abandonados: lo de un opcional desmarcado no llega a la entrada.
 * 4. Lo recordado sobrevive: la seleccion de opcionales vuelve con lo marcado, y Esc vuelve a la pregunta anterior
 *    con lo que se habia escrito.
 * 5. Todo valor final paso por el validador de su pregunta: la entrada lleva lo respondido en el camino final.
 *
 * ARCA esta simulado (`screens.fixtures.ts`), el reloj fijo y las semillas tambien: si una falla, fast-check imprime
 * el contraejemplo y la semilla, y `{ seed, path }` lo repite.
 */

const originalTimeZone = process.env.TZ;

process.env.TZ = 'America/Argentina/Buenos_Aires';

let assistant: ReturnType<typeof createRandomAssistant> | undefined;
let exportGateway: ExportGateway = createExportGateway();

const current = () => {
  if (!assistant) {
    throw new Error('El asistente al azar no esta armado');
  }

  return assistant.prompts;
};

type BillingEquivalent = {
  readonly input: BillingCommandInput;
  readonly options: Parameters<typeof buildEquivalentCommand>[1];
};
type ExportEquivalent = {
  readonly input: ExportVoucherInput;
  readonly options: Parameters<typeof buildExportEquivalentCommand>[1];
};

const equivalents: Array<{ billing: BillingEquivalent } | { export: ExportEquivalent }> = [];

vi.mock('../../../modules/interactive/equivalent-command', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/interactive/equivalent-command')>();

  return {
    ...actual,
    buildEquivalentCommand: (...args: Parameters<typeof actual.buildEquivalentCommand>) => {
      equivalents.push({ billing: { input: args[0], options: args[1] } });

      return actual.buildEquivalentCommand(...args);
    },
  };
});

/**
 * Lo que vio el flujo que se esta corriendo: los campos de la entrada que valido una pregunta con las reglas del flujo
 * (`ruleValidator`, o `scopedRuleValidator` con su `scope`) y los que declara en `writes` un paso que el asistente corrio
 * (en un grupo de opcionales, sus preguntas anidadas).
 */
const coverage = vi.hoisted(() => ({ validated: new Set<string>(), written: new Set<string>() }));

vi.mock('../../../modules/interactive/rule-validator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/interactive/rule-validator')>();

  return {
    ...actual,
    ruleValidator: (...args: Parameters<typeof actual.ruleValidator>) => {
      coverage.validated.add(args[0].field);

      return actual.ruleValidator(...args);
    },
    scopedRuleValidator: (...args: Parameters<typeof actual.scopedRuleValidator>) => {
      // Solo con las reglas del flujo: sin `scope` no hay entrada contra la que correrlas.
      if (args[2]) {
        coverage.validated.add(args[1]);
      }

      return actual.scopedRuleValidator(...args);
    },
  };
});

vi.mock('../../../modules/interactive/wizard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/interactive/wizard')>();

  return {
    ...actual,
    runWizard: (...args: Parameters<typeof actual.runWizard>) => {
      for (const step of args[0]) {
        if (Array.isArray(step.writes)) {
          step.writes.forEach((field) => coverage.written.add(field));
        }
      }

      return actual.runWizard(...args);
    },
  };
});

/** Los ítems con los que el asistente armó cada entrada de la E (`exportItemsEntry`): el último es el de la final. */
const itemsEntries: Array<readonly ExportItemInput[] | undefined> = [];

vi.mock('../../../modules/interactive/export-items', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/interactive/export-items')>();

  return {
    ...actual,
    exportItemsEntry: (items: Parameters<typeof actual.exportItemsEntry>[0]) => {
      itemsEntries.push(items);

      return actual.exportItemsEntry(items);
    },
  };
});

vi.mock('../../../modules/interactive/export-equivalent-command', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/interactive/export-equivalent-command')>();

  return {
    ...actual,
    buildExportEquivalentCommand: (...args: Parameters<typeof actual.buildExportEquivalentCommand>) => {
      equivalents.push({ export: { input: args[0], options: args[1] } });

      return actual.buildExportEquivalentCommand(...args);
    },
  };
});

// El comando equivalente pegado: commander lo parsea y el comando queda en `captured`, sin llamar a ARCA.
vi.mock('../../commands/export.command', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../commands/export.command')>()),
  executeExportCommand: async (command: Command, options: { voucherKind?: ExportVoucherKind } = {}) => {
    captured.push({ command, exportKind: options.voucherKind ?? EXPORT_VOUCHER_KIND });
  },
}));

vi.mock('../../commands/billing.command.shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../commands/billing.command.shared')>()),
  executeBillingCommand: async (command: Command, shortcut: VoucherShortcut) => {
    captured.push({ command, shortcut });
  },
}));

vi.mock('../prompts', () => ({
  askText: () => current().askText(),
  askTextStep: (...args: Parameters<ReturnType<typeof current>['askTextStep']>) => current().askTextStep(...args),
  chooseFromFilterList: (...args: Parameters<ReturnType<typeof current>['chooseFromFilterList']>) =>
    current().chooseFromFilterList(...args),
  chooseManyStep: (...args: Parameters<ReturnType<typeof current>['chooseManyStep']>) =>
    current().chooseManyStep(...args),
  chooseOrTypeStep: (...args: Parameters<ReturnType<typeof current>['chooseOrTypeStep']>) =>
    current().chooseOrTypeStep(...args),
  chooseOne: (...args: Parameters<ReturnType<typeof current>['chooseOne']>) => current().chooseOne(...args),
  chooseStep: (...args: Parameters<ReturnType<typeof current>['chooseStep']>) => current().chooseStep(...args),
  chooseStepWhileLoading: (...args: Parameters<ReturnType<typeof current>['chooseStepWhileLoading']>) =>
    current().chooseStepWhileLoading(...args),
  confirm: (message: string) => current().confirm(message),
  editRowsStep: (...args: Parameters<ReturnType<typeof current>['editRowsStep']>) => current().editRowsStep(...args),
  eraseLastAnswer: () => undefined,
  fitPageSize: () => 12,
  isPromptCancellation: () => false,
}));

vi.mock('../../../services/arca/arca-client.factory', () => ({
  ArcaClientFactory: class {
    public createExportGateway() {
      return exportGateway;
    }
  },
}));

vi.mock('../../../modules/config/config.service', () => ({
  ConfigService: class {
    public close() {}
    public setValue() {}
  },
}));

// ---------------------------------------------------------------------------------------------------------------
// Lo que escribe el asistente al azar en cada pregunta de texto.
// ---------------------------------------------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const daysFromToday = (days: number) =>
  formatArcaDateAsArgentineDate(formatDateAsArcaDate(new Date(NOW.getTime() + days * DAY)));
/**
 * Una fecha completa (dd/mm/aaaa) cerca de hoy: casi siempre hoy o unos dias antes, a veces hasta 40 dias antes o
 * despues. Asi la mayoria de las corridas llega a la vista previa y algunas prueban los bordes.
 */
const dateNearToday = fc.oneof(
  { arbitrary: fc.constant(daysFromToday(0)), weight: 4 },
  { arbitrary: fc.integer({ max: 0, min: -10 }).map(daysFromToday), weight: 3 },
  { arbitrary: fc.integer({ max: 40, min: -40 }).map(daysFromToday), weight: 1 },
  // Relativas (TUI-18): la entrada y el comando equivalente las llevan resueltas.
  { arbitrary: fc.constantFrom('hoy', 'ayer', 'HOY'), weight: 1 },
  { arbitrary: fc.integer({ max: 10, min: 0 }).map((days) => `-${days}`), weight: 1 },
);

const ANSWERS: TextAnswers = [
  [/^Punto de venta/, fc.constant('3')],
  [/^Número de la/, fc.constant('7')],
  [/^Monto/, fc.constantFrom('1', '100', '1.000', '1.500,50', '60,50', '50.000', '1.210.000', '12.000.000')],
  [/^Parte (exenta|no gravada)/, fc.constantFrom('', '0', '10', '300', '800')],
  [
    /^(Fecha del comprobante|Servicio desde|Servicio hasta|Vencimiento del pago|Período desde|Período hasta)/,
    dateNearToday,
  ],
  [/^Fecha de pago/, fc.oneof(fc.constant(''), dateNearToday)],
  // La fecha de un asociado de otro sistema ("Fecha de la nota de crédito C 00003-00000007:"), como `--afecha`.
  [/^Fecha (de la|del) .+ \d{5}-\d{8}:/, dateNearToday],
  [/^Cotización de/, fc.constantFrom('1.000', '1.180', '1.420,50')],
  // El CUIT emisor de la sesion de prueba: la pregunta lo rechaza (10069) y el asistente reintenta con otro (REV-75).
  [/^CUIT del receptor/, fc.constantFrom('30-70996581-2', '20-20179706-4', '20-11111111-2')],
  [/^DNI /, fc.constant('30.123.456')],
  [/^CUIL /, fc.constant('20-30123456-3')],
  [/^CUIT del consumidor/, fc.constant('20-20179706-4')],
  [/^CBU del emisor/, fc.constant('0170099220000067797370')],
  [/^Alias del CBU/, fc.constantFrom('', 'emisor.prueba.cbu')],
  [/cliente del exterior/, fc.constantFrom('ACME LLC', "O'Brien & Peña")],
  [/^Domicilio/, fc.constant('123 Main St')],
  [/^País de destino/, fc.constantFrom('ESTADOS UNIDOS', 'BRASIL', '212')],
  [/^(ARCA no tiene un CUIT publicado|CUIT del país)/, fc.constantFrom('', '55000002126')],
  [/^ID impositivo/, fc.constantFrom('', '12-3456789')],
  // Los ítems de la E (NAV-10): el primero puede quedar con los valores por defecto ("Según detalle", 1); del segundo en
  // adelante, casi siempre Enter para terminar.
  [/^Descripción del ítem 1:/, fc.constantFrom('', 'Consultoría', 'Jugo de naranja')],
  [/^Descripción del ítem \d+ \(Enter para terminar\)/, fc.constantFrom('', '', '', 'Flete')],
  [/^Descripción del ítem \d+:/, fc.constantFrom('', 'Seguro')],
  [/^Cantidad:/, fc.constantFrom('', '1', '2', '0,5', '1.000')],
  [/^(Importe|Precio unitario)( en [A-Z]{3})?:/, fc.constantFrom('1', '100', '1.500,50', '60,50', '2,123456')],
  [/^Descripción del incoterm/, fc.constantFrom('', 'FOB Buenos Aires')],
  [/^Forma de pago/, fc.constant('')],
  [/Actividad de WSFEX/, fc.constantFrom('', '620100')],
  [/^Permisos de embarque/, fc.constant('')],
  [/^Observaciones/, fc.constantFrom('', 'Texto de prueba')],
];

/**
 * Config de prueba: la de siempre, con dolares por defecto (con o sin la cotizacion deprecada), con la cotizacion
 * deprecada sin moneda (vale para cualquier extranjera: "En pesos" arranca con la de la config) o con el CBU cargado.
 */
const CONFIGS: ReadonlyArray<Record<string, unknown>> = [
  {},
  { monedaPorDefecto: 'USD' },
  { cotizacionPorDefecto: 1400, monedaPorDefecto: 'USD' },
  { cotizacionPorDefecto: 1400 },
  { aliasCbu: 'emisor.prueba.cbu', cbu: '0170099220000067797370' },
];

interface Flow {
  readonly family: 'billing' | 'export';
  readonly name: string;
  readonly run: (session: InteractiveSession, g: fc.GeneratorValue) => Promise<unknown>;
  /** Opciones de lista que no elige: la E tiene sus propios flujos. */
  readonly excludeChoices?: RegExp;
}

const OTHER_FLOWS = /exportación/;

const FLOWS: readonly Flow[] = [
  {
    excludeChoices: OTHER_FLOWS,
    family: 'billing',
    name: 'factura A, B, C y FCE',
    run: (session) => runInvoiceFlow(session),
  },
  { family: 'billing', name: 'recibo', run: (session) => runInvoiceFlow(session, true) },
  {
    excludeChoices: OTHER_FLOWS,
    family: 'billing',
    name: 'nota de crédito',
    run: (session) => runNoteFlow(session, 'credito'),
  },
  {
    excludeChoices: OTHER_FLOWS,
    family: 'billing',
    name: 'nota de débito',
    run: (session) => runNoteFlow(session, 'debito'),
  },
  { excludeChoices: OTHER_FLOWS, family: 'billing', name: 'Repetir', run: runRepeatFlow },
  { family: 'export', name: 'factura E', run: runExportFlow },
  {
    family: 'export',
    name: 'notas E',
    run: (session, g) => runExportNoteFlow(session, g(fc.constantFrom, 'credito', 'debito') as 'credito' | 'debito'),
  },
  { family: 'export', name: 'Repetir E', run: (session) => runExportRepeatFlow(session, 3) },
];

// ---------------------------------------------------------------------------------------------------------------
// Una corrida: el flujo con el asistente al azar, y lo que llego a la vista previa.
// ---------------------------------------------------------------------------------------------------------------

interface Walk {
  readonly billingPayload?: unknown;
  readonly equivalent?: (typeof equivalents)[number];
  readonly error?: unknown;
  readonly events: readonly PromptEvent[];
  readonly exportPayload?: unknown;
  readonly session: InteractiveSession;
}

/** Corre `flow` con el asistente al azar. `undefined` si se paso del tope de preguntas. */
async function walk(
  flow: Flow,
  g: fc.GeneratorValue,
  { answers, backPercent }: Pick<PropertyOptions, 'answers' | 'backPercent'>,
): Promise<Walk | undefined> {
  assistant = createRandomAssistant(g, {
    answers,
    backPercent,
    excludeChoices: flow.excludeChoices,
    maxPrompts: 60,
  });
  equivalents.length = 0;
  itemsEntries.length = 0;
  exportGateway = createExportGateway();

  const session = createBillingSession(g(fc.constantFrom, ...CONFIGS) as Record<string, unknown>);
  const billing = vi.spyOn(BillingService.prototype, 'buildVoucherPayload');
  const exported = vi.spyOn(ExportService.prototype, 'resolve');
  const error = await flow.run(session, g).then(
    () => undefined,
    (thrown: unknown) => thrown ?? new Error('El flujo fallo sin error'),
  );
  // Antes de restaurar: `mockRestore` borra lo que guardo el espia.
  const exportResult = exported.mock.settledResults.findLast((result) => result.type === 'fulfilled');
  const billingPayload = billing.mock.results.findLast((result) => result.type === 'return')?.value;

  billing.mockRestore();
  exported.mockRestore();

  if (error instanceof PromptLimitReached) {
    return undefined;
  }

  return {
    billingPayload,
    equivalent: equivalents.at(-1),
    error,
    events: assistant.events,
    exportPayload: (exportResult?.value as ResolvedExportVoucher | undefined)?.payload,
    session,
  };
}

/** El contraejemplo legible: las preguntas y respuestas de la corrida. */
function context(run: Walk): string {
  return `\n--- preguntas y respuestas ---\n${describeEvents(run.events)}`;
}

/** La entrada que llego a la vista previa. */
function inputOf(run: Walk): Record<string, unknown> | undefined {
  if (!run.equivalent) {
    return undefined;
  }

  return ('billing' in run.equivalent ? run.equivalent.billing.input : run.equivalent.export.input) as Record<
    string,
    unknown
  >;
}

// ---------------------------------------------------------------------------------------------------------------
// Invariantes.
// ---------------------------------------------------------------------------------------------------------------

/** 1. Lo que aceptan las preguntas, la vista previa no lo rechaza. */
function assertPreviewAccepts(run: Walk): void {
  if (run.error === undefined) {
    return;
  }

  if (!(run.error instanceof InputValidationError)) {
    throw run.error;
  }

  throw new Error(`La vista previa rechazó lo que aceptaron las preguntas: ${run.error.message}${context(run)}`);
}

const padron: PadronGateway = {
  getTaxpayer: async () => {
    throw new Error('Los tests al azar no consultan el padrón.');
  },
};

/**
 * 2. El comando equivalente, pegado en las dos shells, da la misma entrada que armo el asistente y la misma solicitud
 * que la vista previa.
 */
async function assertEquivalentRoundtrip(run: Walk): Promise<void> {
  const shown = run.equivalent;

  if (!shown || run.error !== undefined) {
    return;
  }

  const { buildEquivalentCommand: billingCommand } = await vi.importActual<
    typeof import('../../../modules/interactive/equivalent-command')
  >('../../../modules/interactive/equivalent-command');
  const { buildExportEquivalentCommand: exportCommand } = await vi.importActual<
    typeof import('../../../modules/interactive/export-equivalent-command')
  >('../../../modules/interactive/export-equivalent-command');
  const runtime = run.session.runtime;
  const issuerCuit = runtime.context.cuit;

  for (const platform of ['linux', 'win32'] as const) {
    if ('billing' in shown) {
      const line = billingCommand(shown.billing.input, { ...shown.billing.options, platform });
      const call = await parseWithProgram(line, platform);
      const plan = parseBillingCommandPlan(
        call.command,
        call.shortcut as VoucherShortcut,
        resolveBillingCommandDefaults(runtime.config),
      );
      const parsed = plan.inputs[0] as BillingCommandInput;

      expect(comparableInput(parsed, issuerCuit), `${line}${context(run)}`).toEqual(
        comparableInput(shown.billing.input, issuerCuit),
      );

      const service = new BillingService({ clock: systemClock });
      const prepared = await prepareBillingInput(
        service,
        parsed,
        {
          billing: run.session.billingGateway,
          padron,
        },
        runtime,
      );

      expect(service.buildVoucherPayload(prepared.input, runtime), `${line}${context(run)}`).toEqual(
        run.billingPayload,
      );
    } else {
      const line = exportCommand(shown.export.input, { ...shown.export.options, platform });
      const call = await parseWithProgram(line, platform);
      const plan = parseExportCommandPlan(call.command, { voucherKind: call.exportKind });

      expect(comparableInput(plan.input, issuerCuit), `${line}${context(run)}`).toEqual(
        comparableInput(shown.export.input, issuerCuit),
      );

      const resolved = await new ExportService({ clock: { now: () => NOW } }).resolve(
        plan.input,
        exportGateway,
        runtime as CliArcaRuntime,
      );

      expect(resolved.payload, `${line}${context(run)}`).toEqual(run.exportPayload);
    }
  }
}

type Normalize = (value: unknown) => unknown;

const asDate: Normalize = (value) =>
  typeof value === 'string' && value.trim() ? parseDateInputAsArcaDate(value, 'day', NOW) : undefined;
const asAmount: Normalize = (value) =>
  (typeof value === 'string' ? parseAmountInput(value) : (value as number | undefined)) ?? 0;
const asRate: Normalize = (value) => (typeof value === 'string' ? parseExchangeRateInput(value) : value);
const asText: Normalize = (value) => (typeof value === 'string' ? value.trim() || undefined : value);

/** Cada campo de la entrada que sale de una pregunta de texto, con como se compara lo escrito con lo que llego. */
const TYPED_FIELDS: Record<Flow['family'], ReadonlyArray<readonly [RegExp, string, Normalize]>> = {
  billing: [
    [/^Fecha del comprobante/, 'billingDate', asDate],
    [/^Servicio desde/, 'serviceStartDate', asDate],
    [/^Servicio hasta/, 'serviceEndDate', asDate],
    [/^Vencimiento del pago/, 'paymentDueDate', asDate],
    [/^Parte exenta/, 'exemptAmount', asAmount],
    [/^Parte no gravada/, 'untaxedAmount', asAmount],
    [/^Cotización de/, 'exchangeRate', asRate],
    [/^(Monto total|Monto de la nota)/, 'totalAmount', asAmount],
    [/^Período desde/, 'associatedPeriod.desde', asDate],
    [/^Período hasta/, 'associatedPeriod.hasta', asDate],
  ],
  export: [
    [/cliente del exterior/, 'clientName', asText],
    [/^Domicilio/, 'clientAddress', asText],
    [/^ID impositivo/, 'clientTaxId', asText],
    [/^Fecha del comprobante/, 'voucherDate', asDate],
    [/^Fecha de pago/, 'paymentDate', asDate],
    [/^Observaciones \(/, 'observations', asText],
    [/^Observaciones comerciales/, 'commercialObservations', asText],
    [/^Cotización de/, 'exchangeRate', asRate],
  ],
};

function fieldAt(input: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined),
      input,
    );
}

/**
 * La cotizacion que arranco escrita con la oficial de ARCA y quedo sin tocar: en A, B y C (#15) y en la E, con la de
 * aduana de WSFEX (NAV-9). Como el CLI sin `--cm`, la entrada no la lleva y la vista previa la consulta. Las respuestas
 * al azar nunca son `1450` ni `1174,6`, asi que solo pasa si se dejo lo escrito. La de la config (`cotizacion`) sin
 * tocar si llega a la entrada, marcada como de la config.
 */
function untouchedOfficialRate(event: Extract<PromptEvent, { kind: 'text' }>): boolean {
  return (
    /^Cotización de .*\(la oficial de ARCA es/.test(event.message) &&
    [OFFICIAL_RATE, EXPORT_QUOTATION_RATE].map((rate) => amountInputText(rate)).includes(event.answer as string)
  );
}

/** 5. Cada campo escrito lleva la respuesta (validada) de su pregunta en el camino final. */
function assertTypedValuesReachInput(flow: Flow, run: Walk): void {
  const input = inputOf(run);

  if (!input || run.error !== undefined) {
    return;
  }

  const path = finalPath(run.events, OPTIONALS);

  for (const [question, field, normalize] of TYPED_FIELDS[flow.family]) {
    const answered = path.findLast((event) => event.kind === 'text' && question.test(event.message));

    if (answered?.kind !== 'text' || answered.answer === BACK) {
      continue;
    }

    expect(normalize(fieldAt(input, field)), `${field} ← "${answered.message}"${context(run)}`).toEqual(
      untouchedOfficialRate(answered) ? undefined : normalize(answered.answer),
    );
  }

  // En la E el monto no se escribe: es la suma de los ítems cargados (NAV-10). Van uno por `--item` o, si es un solo
  // renglón por el total, en la forma rápida: la descripción escrita en `--descripcion` (sin ella, "Según detalle") y
  // el importe en `--monto`.
  if (flow.family === 'export') {
    const loaded = itemsEntries.at(-1) ?? [];
    const [only] = loaded;

    expect(loaded.length, `ítems cargados${context(run)}`).toBeGreaterThan(0);
    expect(input.amount, `monto = suma de los ítems${context(run)}`).toBe(sumExportItems(loaded));

    if (input.items === undefined) {
      expect(loaded, `forma rápida con un solo ítem${context(run)}`).toHaveLength(1);
      expect(input.description ?? DEFAULT_EXPORT_ITEM_DESCRIPTION, `descripción ← ítem 1${context(run)}`).toBe(
        only?.description.trim(),
      );
      expect(input.amount, `importe ← ítem 1${context(run)}`).toBe(only?.unitPrice);
    } else {
      expect(input.items, `un --item por renglón${context(run)}`).toEqual(loaded);
    }
  }
}

/** Los campos de cada opcional que arrancan vacios: si el opcional no queda marcado, no llegan a la entrada. */
const OWNED_FIELDS: Record<Flow['family'], ReadonlyArray<readonly [RegExp, readonly string[]]>> = {
  billing: [
    [/^Fecha del comprobante/, ['billingDate']],
    [/^Vencimiento del pago/, ['paymentDueDate']],
  ],
  export: [
    [/^Fecha del comprobante/, ['voucherDate']],
    [/^Observaciones/, ['observations', 'commercialObservations']],
  ],
};

const OPTIONALS = /^¿Agregamos algún opcional/;

const choiceNames = (event: Extract<PromptEvent, { kind: 'many' }>, values: readonly unknown[]) =>
  event.choices
    .filter((choice) => values.some((value) => isDeepStrictEqual(value, choice.value)))
    .map((choice) => choice.name);

/** 3. Lo respondido en un opcional que termino desmarcado no llega a la entrada. */
function assertNoAbandonedOptionals(flow: Flow, run: Walk): void {
  const input = inputOf(run);
  const selection = finalPath(run.events, OPTIONALS).findLast(
    (event) => event.kind === 'many' && OPTIONALS.test(event.message),
  );

  if (!input || run.error !== undefined || selection?.kind !== 'many' || !Array.isArray(selection.answer)) {
    return;
  }

  const marked = choiceNames(selection, selection.answer);

  for (const [optional, fields] of OWNED_FIELDS[flow.family]) {
    if (marked.some((name) => optional.test(name))) {
      continue;
    }

    for (const field of fields) {
      expect(fieldAt(input, field), `${field}: "${optional.source}" quedó desmarcado${context(run)}`).toBeUndefined();
    }
  }
}

/** Las preguntas que eligen el comprobante del que se copian la alicuota y el exento ("Repetir"). */
const COPY_SOURCE = /^(¿Qué comprobante querés repetir\?|¿Cuál repetimos\?)/;
/**
 * Los opcionales que siguen al comprobante copiado (`resetWhen`): con otro, arrancan como la primera vez. En A, B y C,
 * la alicuota, el exento y los datos del consumidor final (son del receptor, que sale del comprobante); en "Repetir" E,
 * lo que se copia de la factura (items, idioma, CUIT del pais e incoterm).
 */
const FOLLOWS_COPY_SOURCE: readonly unknown[] = ['alicuota', 'consumidor', 'exento', 'cuit-pais', 'idioma', 'incoterm'];
/** Las dos preguntas de los datos del consumidor final, como opcional o, desde el tope, como obligatorias. */
const CONSUMER_DOCUMENT = /^Documento del consumidor final/;
const CONSUMER_NUMBER = /^(DNI|CUIT|CUIL) del consumidor final/;
/**
 * En "Repetir", el exento tambien sigue a "¿Mismo monto?" (REV-70): con otro monto no se copia y se vuelve a preguntar,
 * marcado si el original tenia. Si cambia esa respuesta, arranca como la primera vez (`preselected`).
 */
const SAME_AMOUNT = /^¿Mismo monto\?/;

/**
 * 4. La seleccion de opcionales vuelve con lo ultimo marcado que se sigue ofreciendo, y Esc vuelve a la pregunta
 * anterior con lo escrito. Lo marcado es lo de la ultima seleccion confirmada, aunque se haya confirmado con otras
 * opciones (por ejemplo, con productos no se ofrece el periodo): lo que ya no se ofrecia ahi quedo desmarcado, como
 * dice el grupo de opcionales (`optionalGroup`). Si en "Repetir" se eligio otro comprobante desde esa seleccion, la
 * alicuota y el exento (en la E, lo copiado de la factura) no siguen marcados: arrancan como la primera vez. Las facturas A, B y FCE de los datos de prueba
 * tienen una sola alicuota, asi que la alicuota no arranca marcada por `preselected`: tienen que quedar desmarcados.
 * Si cambio "¿Mismo monto?", el exento arranca como la primera vez: marcado o no segun el original, asi que no se mira.
 */
function assertRemembered(run: Walk): void {
  const lastMarked = new Map<
    string,
    { readonly amount: unknown; readonly marked: readonly unknown[]; readonly source: readonly unknown[] }
  >();
  const source = new Map<string, unknown>();
  let amount: unknown;
  /**
   * Los datos del consumidor final respondidos como obligatorios (desde el tope, fuera de la seleccion) quedan marcados
   * (`requiredOptional`): si dejan de ser obligatorios, la seleccion los muestra marcados. Se desmarcan al confirmar una
   * seleccion que los ofrece sin marcarlos.
   */
  let requiredConsumer = false;
  let consumerMode: 'obligatorio' | 'opcional' | undefined;

  run.events.forEach((event, index) => {
    const before = run.events[index - 1];

    if (CONSUMER_DOCUMENT.test(event.message)) {
      const fromSelection =
        before?.kind === 'many' && Array.isArray(before.answer) && before.answer.includes('consumidor');
      const backFromNumber = before && CONSUMER_NUMBER.test(before.message) && before.answer === BACK;

      consumerMode = fromSelection ? 'opcional' : backFromNumber ? consumerMode : 'obligatorio';
    }

    if (CONSUMER_NUMBER.test(event.message) && event.answer !== BACK && consumerMode === 'obligatorio') {
      requiredConsumer = true;
    }

    if (event.kind === 'list' && COPY_SOURCE.test(event.message) && event.answer !== BACK) {
      source.set(event.message, event.answer);
    }

    if (event.kind === 'list' && SAME_AMOUNT.test(event.message) && event.answer !== BACK) {
      amount = event.answer;
    }

    if (event.kind === 'many' && OPTIONALS.test(event.message)) {
      const key = event.message;
      const remembered = lastMarked.get(key);
      const currentSource = [...source.entries()];

      if (remembered) {
        const sameSource = isDeepStrictEqual(remembered.source, currentSource);
        const exemptReset = !isDeepStrictEqual(remembered.amount, amount);
        const compared = (value: unknown) => !(exemptReset && value === 'exento');
        const marked = requiredConsumer ? [...remembered.marked, 'consumidor'] : remembered.marked;
        const available = event.choices
          .filter((choice) => !choice.disabled)
          .map((choice) => choice.value)
          .filter(
            (value) =>
              marked.some((candidate) => isDeepStrictEqual(candidate, value)) &&
              compared(value) &&
              (sameSource || !FOLLOWS_COPY_SOURCE.includes(value)),
          );

        expect(
          event.selected.filter(compared),
          `"${event.message}" no arrancó con lo marcado antes${context(run)}`,
        ).toEqual(available);
      }

      if (Array.isArray(event.answer)) {
        lastMarked.set(key, { amount, marked: event.answer, source: currentSource });

        // Ofrecido y sin marcar, se desmarca; obligatorio (no se ofrece), sigue marcado.
        if (event.choices.some((choice) => choice.value === 'consumidor')) {
          requiredConsumer = false;
        }
      }
    }

    // Esc en la pregunta siguiente vuelve a esta: lo escrito arranca escrito. Salvo "Descripción del ítem N (Enter para
    // terminar)", que arranca vacía a propósito: vacía tiene que poder terminar la carga (NAV-10).
    const back = run.events[index + 1];
    const again = run.events[index + 2];

    if (
      event.kind === 'text' &&
      !/\(Enter para terminar\)/.test(event.message) &&
      typeof event.answer === 'string' &&
      event.answer.trim() &&
      back?.answer === BACK &&
      again?.kind === 'text' &&
      again.message === event.message
    ) {
      expect(
        again.previousAnswer?.trim(),
        `"${event.message}" no arrancó escrita al volver${context(run)}`,
      ).toBeTruthy();
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Las propiedades, por flujo.
// ---------------------------------------------------------------------------------------------------------------

interface PropertyOptions {
  readonly answers: TextAnswers;
  /** Probabilidad de Esc en cada pregunta, en porcentaje: la 3 y la 4 necesitan ir y volver mas. */
  readonly backPercent: number;
  readonly numRuns: number;
  readonly seed: number;
}

/**
 * Para las 3 y 4, que prueban la navegacion: fechas de hoy y sin exento, asi casi ninguna pregunta rechaza la respuesta
 * por una regla entre campos y llegan mas caminos con idas y vueltas.
 */
const NAVIGATION_ANSWERS: TextAnswers = [
  [
    /^(Fecha del comprobante|Servicio desde|Servicio hasta|Vencimiento del pago|Período desde|Período hasta)/,
    fc.constant(daysFromToday(0)),
  ],
  [/^Parte (exenta|no gravada)/, fc.constant('')],
  ...ANSWERS,
];

/** Para las invariantes 1, 2 y 5: fechas e importes variados, y muchas corridas llegan a la vista previa. */
const FORWARD: Omit<PropertyOptions, 'seed'> = { answers: ANSWERS, backPercent: 10, numRuns: 80 };
/** Para las invariantes 3 y 4: mas Esc y mas corridas, para que haya caminos abandonados y vueltas. */
const BACK_AND_FORTH: Omit<PropertyOptions, 'seed'> = { answers: NAVIGATION_ANSWERS, backPercent: 20, numRuns: 400 };

/**
 * Corre la propiedad y cuenta cuantas corridas llegaron a la vista previa: si son pocas, la propiedad no prueba nada y
 * falla. Sin encoger el contraejemplo (`endOnFailure`): con `fc.gen` tarda minutos, y el mensaje ya trae las preguntas
 * y respuestas de la corrida que fallo.
 */
async function property(
  flow: Flow,
  options: PropertyOptions,
  check: (run: Walk) => Promise<void> | void,
): Promise<void> {
  let previewed = 0;

  await fc.assert(
    fc.asyncProperty(fc.gen(), async (g) => {
      const run = await walk(flow, g, options);

      if (!run) {
        return;
      }

      if (run.equivalent) {
        previewed += 1;
      }

      await check(run);
    }),
    { endOnFailure: true, numRuns: options.numRuns, seed: options.seed },
  );

  expect(previewed, 'pocas corridas llegaron a la vista previa').toBeGreaterThanOrEqual(options.numRuns / 10);
}

let restoreWrite: () => void;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();

  if (originalTimeZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimeZone;
  }
});

beforeEach(() => {
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

  restoreWrite = () => write.mockRestore();
});

// Cientos de corridas del asistente por test: en un runner lento con cobertura pasan los 5 s por defecto de vitest (el
// CI de Node 22 tardó 5,7 s en la invariante 4 de "Repetir" E). El tope no cambia lo que se prueba, solo cuánto se espera.
vi.setConfig({ testTimeout: 60_000 });

afterEach(() => {
  restoreWrite();
  assistant = undefined;
});

describe.each(FLOWS)('asistente al azar: $name', (flow) => {
  it('invariantes 1, 2 y 5: la vista previa acepta lo que aceptan las preguntas, el comando equivalente arma la misma solicitud y la entrada lleva lo respondido', () =>
    property(flow, { ...FORWARD, seed: 20261119 }, async (run) => {
      assertPreviewAccepts(run);
      await assertEquivalentRoundtrip(run);
      assertTypedValuesReachInput(flow, run);
    }));
});

describe.each(FLOWS)('asistente al azar: $name', (flow) => {
  // REV-68 en A, B y C (NAV-2) y en la E (NAV-3): los opcionales son un `optionalGroup` que recuerda lo marcado y lo
  // respondido. En la factura E y "Repetir" E, el CUIT del país arranca escrito al volver (REV-74, #10).
  it('invariante 4: la selección de opcionales vuelve con lo marcado y Esc vuelve con lo escrito', () =>
    property(flow, { ...BACK_AND_FORTH, seed: 20261121 }, (run) => assertRemembered(run)));

  // En A, B y C desde REV-65; en la E desde NAV-3 (REV-67).
  it('invariante 3: lo de un opcional desmarcado no llega a la entrada', () =>
    property(flow, { ...BACK_AND_FORTH, seed: 20261120 }, (run) => assertNoAbandonedOptionals(flow, run)));
});

/**
 * Los campos de las reglas que no aplican a cada flujo, con el motivo. El resto de `BILLING_RULES` (A, B y C) o de
 * `EXPORT_RULES` (la E) lo tiene que validar una pregunta con las reglas del flujo y escribirlo un paso (`writes`).
 */
const NO_ASSOCIATED = {
  'associatedPeriod.desde': 'sin asociado: no es una nota',
  'associatedPeriod.hasta': 'sin asociado: no es una nota',
  'associatedVoucher.fecha': 'sin asociado: no es una nota',
};
const SCRIPTED_ASSOCIATED = {
  // El asistente al azar no ingresa comprobantes a mano: lo cubre `navigator.rev.test.ts` ("REV-71: la fecha de un
  // asociado de otro sistema…").
  'associatedVoucher.fecha': 'asociado de otro sistema, cubierto por guion',
};
const ITEMS = { items: 'los items de la E son un bucle propio, que solo termina cuando suman el monto (NAV-3)' };
const NOT_APPLICABLE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'factura A, B, C y FCE': NO_ASSOCIATED,
  'factura E': ITEMS,
  'nota de crédito': SCRIPTED_ASSOCIATED,
  'nota de débito': SCRIPTED_ASSOCIATED,
  'notas E': {
    ...ITEMS,
    exchangeRate: 'el asociado de prueba es de servicios: la cotización es la suya (2053) y no se ofrece',
    paymentDate: 'las notas E no llevan fecha de pago (1673)',
  },
  recibo: NO_ASSOCIATED,
  Repetir: NO_ASSOCIATED,
  'Repetir E': {
    ...ITEMS,
    exchangeRate: 'la factura de prueba que se repite es de servicios: ARCA exige la suya (2053) y no se ofrece',
  },
};

describe.each(FLOWS)('reglas (NAV-5): $name', (flow) => {
  it('cada campo de una regla que aplica lo valida una pregunta con las reglas del flujo y lo escribe un paso', async () => {
    coverage.validated.clear();
    coverage.written.clear();

    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        await walk(flow, g, { answers: ANSWERS, backPercent: 5 });
      }),
      { numRuns: 60, seed: 20261122 },
    );

    const skipped = NOT_APPLICABLE[flow.name] ?? {};
    const fields = [
      ...new Set((flow.family === 'billing' ? BILLING_RULES : EXPORT_RULES).flatMap((rule) => rule.fields)),
    ].filter((field) => !(field in skipped));

    expect(
      fields.filter((field) => !coverage.validated.has(field)),
      'sin pregunta con reglas',
    ).toEqual([]);
    expect(
      fields.filter((field) => !coverage.written.has(field)),
      'sin paso que lo escriba',
    ).toEqual([]);
  });
});
