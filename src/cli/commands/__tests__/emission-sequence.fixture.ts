import { Separator } from '@inquirer/core';
import { Command } from 'commander';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';

import type { VoucherShortcut } from '../../../modules/billing/billing.types';
import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import type { ExportGateway } from '../../../modules/export/export.gateway';
import { EXPORT_VOUCHER_KIND, type ExportVoucherKind } from '../../../modules/export/export.kinds';
import type { ExportIssuedVoucher } from '../../../modules/export/export.types';
import type { IssuedVoucher } from '../../../modules/vouchers/voucher-history';
import { PdfPlugin } from '../../../services/pdf/pdf-plugin';
import { billingAnswer, exportAnswer } from '../../../testing/arca-answers';
import { fakeBillingGateway, fakeExportGateway } from '../../../testing/arca-gateways';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
import { describeEmittedInThisRun, resetEmittedInThisRun } from '../../emitted-vouchers';
import { reportCliError } from '../../error-output';
import { registerGlobalOptions } from '../../global-options';
import { listSelect } from '../../interactive/list-select';
import {
  type BillingCommandGateways,
  executeBillingCommand,
  registerBillingCommandOptions,
} from '../billing.command.shared';
import { executeExportCommand } from '../export.command';
import { registerExportOptions } from '../export.command.options';

/**
 * Una corrida de un comando de emisión como una sola secuencia de eventos: llamadas a ARCA, lo emitido que queda
 * anotado, salidas, preguntas, PDF y cómo terminó (REV-50). El spinner queda afuera.
 *
 * El archivo de tests reemplaza el spinner y el teclado con `vi.mock` de `spinner` y de `interactive/list-select`.
 */

export const CLIENT_CUIT = 30709965812;
/** El miércoles 18/11/2026 al mediodía en Argentina. */
const NOW = new Date('2026-11-18T15:00:00.000Z');

export const FC = ['-m', '1000', '--cs', '--cfinal'];
export const FE = [
  ...['--cliente', 'ACME LLC', '--domicilio-cliente', '123 Main St', '--pais-destino', '212'],
  ...['-m', '1500', '--moneda', 'PES'],
];
/** Una nota E sobre la factura E 1. */
export const E_NOTE = ['-m', '500', '--ar', '1'];

/** Lo que consulta la factura E antes de la vista previa. No emite: el número y el ID son lecturas. */
export const FE_READS = [
  ...['getDestinationCountries', 'getDestinationCountryCuits', 'getUnits', 'getLanguages', 'getCurrencies'],
  ...['getActivities', 'getLastVoucherNumber', 'getLastRequestId'],
].map((method) => `ARCA ${method}`);

export const EMIT = 'Sí, emitir ahora';
export const EMIT_WITH_PDF = 'Sí, emitir y generar el PDF';
export const DO_NOT_EMIT = 'No, dejar sin emitir';
export const MAKE_PDF = 'Sí, generar el PDF';
export const INSTALL = 'Sí, instalar';
export const PDF_QUESTION = 'pregunta: ¿Generamos el PDF del comprobante?';
export const INSTALL_QUESTION =
  'pregunta: Para generar PDFs hay que descargar un componente (~160 MB, o ~360 MB si no tenés Chrome). ¿Instalarlo ahora?';

/** Cómo responde ARCA a cada emisión. `sin numero` falla antes de emitir; `incierta`, después de mandarla. */
type ArcaStep = 'A' | 'ilegible' | 'incierta' | 'R' | 'sin numero';

/** El texto de la opción que se elige, una tecla, o un error de la pregunta que no es una cancelación. */
type Answer = Error | string;

/** El paso del PDF que falla; `generar 42`, solo el de ese comprobante. */
type PdfFailure = 'cargar' | 'generar' | 'generar 42' | 'instalar';

export interface RunOptions {
  readonly answers?: readonly Answer[];
  readonly arca?: readonly ArcaStep[];
  readonly config?: Record<string, unknown>;
  readonly json?: boolean;
  /** Corre (y se espera) cuando ARCA ya recibió la llamada y todavía no contestó: para interrumpir en ese momento. */
  readonly onArcaCall?: (method: string, args: readonly unknown[]) => Promise<void> | void;
  /** En cada evento, apenas pasa: para mirar el estado del proceso en ese momento. */
  readonly onEvent?: (text: string) => void;
  readonly pdfFailure?: PdfFailure;
  readonly pluginInstalled?: boolean;
  /** `bruto` en la config. */
  readonly raw?: boolean;
  /** Si stdin y stdout son una terminal; con un par, cada una por separado. */
  readonly tty?: boolean | readonly [stdin: boolean, stdout: boolean];
}

export interface Run {
  readonly events: readonly string[];
  /** Los payloads que recibió la llamada que emite, en orden. */
  readonly sent: ReadonlyArray<Record<string, unknown>>;
  readonly stderr: string;
  readonly stdout: string;
}

/** Lo que se reconoce en una salida de texto, en el orden en que aparece. */
const LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/SIN EMITIR/g, 'vista previa'],
  [/75123456789012/g, 'CAE'],
  [/RECHAZADO/g, 'rechazado'],
  [/PDF guardado/g, 'PDF guardado'],
  [/PDF no generado/gi, 'PDF no generado'],
  [/No se emitió nada/g, 'no se emitió nada'],
  [/No se pudieron mostrar/g, 'no se pudieron mostrar'],
  [/en el PDF; no se generó/g, 'aviso de datos del PDF'],
];

const ISSUED: IssuedVoucher = {
  currency: 'PES',
  date: '20261105',
  documentNumber: 0,
  documentTypeCode: 99,
  ivaAmount: 0,
  netAmount: 5_000_000,
  number: 12,
  result: 'A',
  total: 5_000_000,
};

const ISSUED_EXPORT: ExportIssuedVoucher = {
  activities: [620100],
  arcaType: 19,
  clientAddress: '123 Main St',
  clientCountryCuit: 55000002126,
  clientName: 'ACME LLC',
  currencyCode: 'PES',
  date: '20261030',
  destinationCountry: 212,
  exchangeRate: 1,
  exportType: 2,
  language: 1,
  number: 1,
  paymentTerms: 'Transferencia Internacional',
  pointOfSale: 3,
  result: 'A',
  total: 1500,
};

let directory = '';
let events: string[] = [];
let sent: Array<Record<string, unknown>> = [];
let stderr = '';
let stdout = '';
let onArcaCall: RunOptions['onArcaCall'];
let onEvent: RunOptions['onEvent'];
let pending: { readonly output: 'stderr' | 'stdout'; text: string } | undefined;
let recorded = '';

function describeJson(text: string): string {
  const items = [JSON.parse(text)].flat() as Array<Record<string, unknown>>;

  return `JSON ${items
    .map(({ estado, numero, pdf }) =>
      [
        estado,
        ...(numero === null ? [] : [numero]),
        ...(pdf ? ['ruta' in (pdf as object) ? 'con PDF' : 'PDF no generado'] : []),
      ].join(' '),
    )
    .join(', ')}`;
}

function describeText(text: string): string | undefined {
  const plain = text.replace(/[│┃║╏╎┊▎\s]+/g, ' ');
  const found = LABELS.flatMap(([pattern, label]) =>
    [...plain.matchAll(pattern)].map((match) => ({ at: match.index, label })),
  ).sort((left, right) => left.at - right.at);

  if (found.length === 0) {
    // La línea "✔ pregunta respuesta" que queda después de responder ya es el evento `pregunta`.
    return /¿(Emitimos|Generamos|Instalarlo)/.test(plain) || !plain.trim() ? undefined : `otra: ${plain.trim()}`;
  }

  return found.map(({ label }) => label).join(', ');
}

function flush(): void {
  if (!pending) {
    return;
  }

  const { output } = pending;
  const text = stripAnsi(pending.text);
  const described = /^\s*[[{]/.test(text) ? describeJson(text) : describeText(text);

  pending = undefined;

  if (described) {
    events.push(`${output === 'stdout' ? 'salida' : 'stderr'}: ${described}`);
  }
}

/** Lo emitido se busca antes de cada evento: si quedara anotado recién después de una salida, se vería después. */
function noteRecorded(): void {
  const current = describeEmittedInThisRun()
    .map((line) => line.replace(/^Se emiti(?:ó|eron): (.*)\. Verifical.*$/, '$1'))
    .join('; ');

  if (current !== recorded) {
    recorded = current;
    flush();
    events.push(`anotado: ${current}`);
  }
}

function event(text: string): void {
  flush();
  noteRecorded();
  events.push(text);
  onEvent?.(text);
}

/** Lo que se escribe seguido, sin otro evento en el medio, es una sola salida. */
function write(output: 'stderr' | 'stdout', text: string): void {
  if (pending && pending.output !== output) {
    flush();
  }

  noteRecorded();

  if (pending) {
    pending.text += text;
  } else {
    pending = { output, text };
  }
}

function describeCall(method: string, args: readonly unknown[]): string {
  if (method !== 'createVoucher' && method !== 'authorize') {
    return method;
  }

  const payload = args[0] as Record<string, unknown>;

  sent.push(structuredClone(payload));

  return `${method} ${String(payload.CbteDesde ?? payload.Cbte_nro)} por ${String(payload.ImpTotal ?? payload.Imp_total)}`;
}

/** Cada llamada al gateway queda anotada antes de responder. */
function watched<T extends object>(gateway: T): T {
  return Object.fromEntries(
    Object.entries(gateway).map(([method, call]) => [
      method,
      async (...args: readonly unknown[]) => {
        event(`ARCA ${describeCall(method, args)}`);
        await onArcaCall?.(method, args);

        return (call as (...args: readonly unknown[]) => Promise<unknown>)(...args);
      },
    ]),
  ) as T;
}

function answerStep(step: ArcaStep, unreadable: string): 'A' | 'R' {
  if (step === 'incierta') {
    throw new Error('socket hang up');
  }

  if (step === 'ilegible') {
    throw new TypeError(`Cannot read properties of undefined (reading '${unreadable}')`);
  }

  return step === 'R' ? 'R' : 'A';
}

function billingGateways(steps: readonly ArcaStep[], issued: Partial<IssuedVoucher> = {}): BillingCommandGateways {
  let position = 0;
  let next = 42;

  return {
    billing: watched(
      fakeBillingGateway({
        createVoucher: async () => {
          const step = steps[position] ?? 'A';

          position += 1;

          const result = answerStep(step, 'FeDetResp');
          const number = next;

          next += result === 'A' ? 1 : 0;

          return billingAnswer({
            cae: result === 'A' ? '75123456789012' : '',
            caeFchVto: result === 'A' ? '20261130' : '',
            response: {
              FeDetResp: { FECAEDetResponse: [{ CbteDesde: number, CbteHasta: number, Resultado: result }] },
            },
          });
        },
        getNextVoucherNumber: async () => {
          if (steps[position] === 'sin numero') {
            throw new Error('LoginFault');
          }

          return next;
        },
      }),
    ),
    fce: watched({ getObligation: async () => ({ minimumAmount: 1, obligated: false }) }) as never,
    fceRegistry: watched({ getVoucherState: async () => 'Rechazado' as const }),
    history: watched({ getLastNumber: async () => 12, getVoucher: async () => ({ ...ISSUED, ...issued }) }),
    padron: watched({
      getTaxpayer: async () => ({ address: null, ivaCondition: 'responsable-inscripto', name: null }) as never,
    }),
  };
}

export function exportGateway(steps: readonly ArcaStep[] = []): ExportGateway {
  const step = steps[0] ?? 'A';

  return watched(
    fakeExportGateway({
      authorize: async (payload) => {
        const result = answerStep(step, 'FEXResultAuth');

        return exportAnswer({
          FEXAuthorizeResult: {
            FEXErr: { ErrCode: 0, ErrMsg: '' },
            FEXEvents: { EventCode: 0, EventMsg: '' },
            FEXResultAuth: {
              Cae: result === 'A' ? '75123456789012' : '',
              Cbte_nro: payload.Cbte_nro,
              Cbte_tipo: payload.Cbte_Tipo,
              Cuit: 20111111112,
              Fch_cbte: payload.Fecha_cbte,
              Fch_venc_Cae: result === 'A' ? '20261130' : '',
              Id: payload.Id,
              Motivos_Obs: '',
              Punto_vta: payload.Punto_vta,
              Reproceso: 'N',
              Resultado: result,
            },
          },
        });
      },
      getLastVoucherNumber: async () => {
        if (step === 'sin numero') {
          throw new Error('LoginFault');
        }

        return 41;
      },
      getVoucher: async () => ISSUED_EXPORT,
    }),
  );
}

export function emissionRuntime(options: RunOptions): CliArcaRuntime {
  return {
    certificateNotices: [],
    config: arcliConfigSchema.parse({
      consultarPadron: false,
      cuit: '20111111112',
      emisor: { domicilio: 'Calle 123', inicioActividades: '20200301', razonSocial: 'Ana Gomez' },
      exportacion: { actividad: 620100 },
      pdf: 'nunca',
      pdfCarpeta: join(directory, 'pdf'),
      puntoVentaPorDefecto: 3,
      verificarFce: false,
      ...options.config,
    }),
    context: { cuit: 20111111112 },
    cuit: 20111111112,
    environment: 'testing',
    outputJson: options.json ?? false,
    outputRaw: options.raw ?? false,
    pointOfSale: 3,
  } as unknown as CliArcaRuntime;
}

function prepareAnswers(answers: readonly Answer[]): void {
  const queue = [...answers];

  vi.mocked(listSelect).mockImplementation(async ({ choices, message }) => {
    event(`pregunta: ${message}`);

    const answer = queue.shift();

    if (answer === undefined) {
      throw new Error(`el test no respondió "${message}"`);
    }

    if (answer instanceof Error) {
      throw answer;
    }

    if (answer === 'Ctrl+C') {
      throw Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' });
    }

    if (answer === 'Esc') {
      process.stdin.emit('keypress', '', { name: 'escape' });
      throw Object.assign(new Error('Prompt was aborted'), { name: 'AbortPromptError' });
    }

    const choice = choices.find(
      (item): item is { name: string; value: unknown } => !Separator.isSeparator(item) && item.name === answer,
    );

    if (!choice) {
      throw new Error(`"${answer}" no está en "${message}"`);
    }

    return choice.value as never;
  });
}

function preparePdf(options: RunOptions): void {
  let installed = options.pluginInstalled ?? true;
  const failIf = (step: string) => {
    if (options.pdfFailure === step || options.pdfFailure === step.split(' ')[0]) {
      throw new Error(`falló ${step}`);
    }
  };

  vi.spyOn(PdfPlugin.prototype, 'getStatus').mockImplementation(() => ({ installed }) as never);
  vi.spyOn(PdfPlugin.prototype, 'install').mockImplementation(async () => {
    event('PDF instalar');
    failIf('instalar');
    installed = true;

    return { installed } as never;
  });
  vi.spyOn(PdfPlugin.prototype, 'load').mockImplementation(() => {
    event('PDF cargar');
    failIf('cargar');

    return {
      render: async ({ cbteDesde }) => {
        event(`PDF generar ${cbteDesde}`);
        failIf(`generar ${cbteDesde}`);

        return new Uint8Array([1]);
      },
    };
  });
}

/** Corre `execute` y termina como `index.ts`: un error se reporta y da el exit code. */
export async function runSequence(execute: () => Promise<unknown>, options: RunOptions): Promise<Run> {
  const { tty = false } = options;
  const [stdinTty, stdoutTty] = typeof tty === 'boolean' ? [tty, tty] : tty;

  events = [];
  sent = [];
  stderr = '';
  stdout = '';
  onArcaCall = options.onArcaCall;
  onEvent = options.onEvent;
  pending = undefined;
  recorded = '';
  process.exitCode = undefined;
  process.stdin.isTTY = stdinTty;
  process.stdout.isTTY = stdoutTty;
  resetEmittedInThisRun();
  prepareAnswers(options.answers ?? []);
  preparePdf(options);

  try {
    await execute();
    event(`fin: exit ${process.exitCode ?? 0}`);
  } catch (error) {
    event(`error: ${(error as { readonly code?: string }).code ?? (error as Error).message}`);

    const exitCode = reportCliError(error, options.json ?? false);

    // Lo que escribe el reporte ya es el evento `error`.
    pending = undefined;
    events.push(`fin: exit ${exitCode}`);
  }

  return { events, sent, stderr, stdout };
}

export async function runBilling(
  args: readonly string[],
  options: RunOptions & { readonly issued?: Partial<IssuedVoucher>; readonly shortcut?: VoucherShortcut } = {},
): Promise<Run> {
  const shortcut = options.shortcut ?? 'fc';
  const command = new Command(shortcut);

  registerBillingCommandOptions(command);
  command.parse(['node', shortcut, ...args]);

  return runSequence(
    () =>
      executeBillingCommand(
        command,
        shortcut,
        {},
        {
          createGateways: () => billingGateways(options.arca ?? [], options.issued),
          resolveRuntime: () => emissionRuntime(options),
        },
      ),
    options,
  );
}

export async function runExport(
  args: readonly string[],
  options: RunOptions & {
    /** Con lo que el comando toma de afuera por defecto: el archivo de tests simula el perfil y el WSFEX de abajo. */
    readonly defaultDependencies?: boolean;
    readonly kind?: ExportVoucherKind;
  } = {},
): Promise<Run> {
  const voucherKind = options.kind ?? EXPORT_VOUCHER_KIND;
  const command = new Command(voucherKind.shortcut);

  registerGlobalOptions(command);
  registerExportOptions(command, voucherKind);
  command.parse(['node', voucherKind.shortcut, ...args]);

  return runSequence(
    () =>
      executeExportCommand(
        command,
        { voucherKind },
        options.defaultDependencies
          ? undefined
          : { createGateway: () => exportGateway(options.arca), resolveRuntime: () => emissionRuntime(options) },
      ),
    options,
  );
}

/** Un JSON de `--cargar` en la carpeta temporal del test. */
export function writeInput(content: unknown): string {
  const path = join(directory, 'entrada.json');

  writeFileSync(path, JSON.stringify(content), 'utf8');

  return path;
}

/** Un lote de facturas C de $ 1.000, $ 2.000, etc. */
export function batch(count: number, extra: (position: number) => Record<string, unknown> = () => ({})): string {
  return writeInput(
    Array.from({ length: count }, (_, position) => ({
      concepto: 'servicios',
      ivaReceptor: 'consumidor-final',
      montoTotal: 1000 * (position + 1),
      tipoDocumento: 'consumidor-final',
      ...extra(position),
    })),
  );
}

/** Las llamadas que emiten y, en A, B y C, las que piden el número para emitir. */
export function emissionCalls(run: Run): string[] {
  return run.events.filter((text) => /^ARCA (authorize|createVoucher|getNextVoucherNumber)\b/.test(text));
}

/** Carpeta de config temporal, salidas capturadas y reloj quieto, por test. */
export function useEmissionSequence(): void {
  const originalTty = [process.stdin.isTTY, process.stdout.isTTY] as const;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'arcli-secuencia-'));
    vi.stubEnv('ARCLI_CONFIG_DIR', directory);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      write('stdout', String(chunk));

      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      write('stderr', String(chunk));

      return true;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(listSelect).mockReset();
    resetEmittedInThisRun();
    process.exitCode = undefined;
    [process.stdin.isTTY, process.stdout.isTTY] = originalTty;
    rmSync(directory, { force: true, recursive: true });
  });
}
