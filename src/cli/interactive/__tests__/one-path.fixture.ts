import { afterEach, beforeEach, expect, vi } from 'vitest';

import type { ArcaProfileFixture } from '../../__tests__/arca-profile.fixture';
import {
  BEFORE_MIDNIGHT,
  CLIENT_CUIT,
  CLOCK_CONFIG,
  sdk,
  setClock,
  useClockFixture,
  wsfeRequests,
  wsfexRequests,
} from '../../__tests__/clock.fixture';
import { describeEmittedInThisRun, resetEmittedInThisRun } from '../../emitted-vouchers';
import { createProgram } from '../../program';
import { runInvoiceFlow } from '../invoice.flow';
import { runNoteFlow } from '../note.flow';
import { runRepeatFlow } from '../repeat.flow';
import { createInteractiveSession } from '../session';

import { startScript, type Steps } from './one-path.prompts';
import { KEEP_EXPORT_ITEMS, singleExportItem } from './script';

/**
 * Lo comun de los tests de "un solo camino" (REV-53): la misma entrada por el comando (en una terminal, con "¿Emitimos?")
 * y por el asistente, contra el mismo SDK falso y la misma config aislada.
 */

export const EMIT = [/Emitimos/, 'Sí, emitir ahora'] as const;
export const EMIT_WITH_PDF = [/Emitimos/, 'Sí, emitir y generar el PDF'] as const;
export const DO_NOT_EMIT = [/Emitimos/, 'No, dejar sin emitir'] as const;
export const NO_OPTIONALS = [/Agregamos/, []] as const;

export interface OnePathRun {
  /** Lo escrito despues de responder "¿Emitimos?". */
  readonly after: readonly string[];
  /** Las preguntas, en orden. */
  readonly asked: readonly string[];
  /** Lo escrito hasta "¿Emitimos?". */
  readonly before: readonly string[];
  readonly emitted: readonly string[];
  readonly error: unknown;
  readonly exitCode: typeof process.exitCode;
  /** Las consultas a ARCA entre la ultima respuesta y "¿Emitimos?": las de la vista previa. */
  readonly previewQueries: readonly string[];
  /** Lo que recibio ARCA para emitir, en orden. */
  readonly requests: readonly unknown[];
}

const services = { generic: sdk.generic, wsfe: sdk.wsfe, wsfex: sdk.wsfex };

/** Cada consulta al SDK, en orden. En la generica, con el nombre del metodo de ARCA. */
function queries(): string[] {
  return Object.entries(services)
    .flatMap(([service, methods]) =>
      Object.entries(methods).flatMap(([name, mock]) =>
        mock.mock.calls.map((args: unknown[], index: number) => ({
          label: service === 'generic' ? String(args[1]) : `${service}.${name}`,
          order: mock.mock.invocationCallOrder[index] ?? 0,
        })),
      ),
    )
    .sort((left, right) => left.order - right.order)
    .map(({ label }) => label);
}

export interface RunOptions {
  /** Corre al llegar a cada pregunta; si lanza, la pregunta se corta. */
  readonly onAsk?: (message: string) => void;
  readonly prepare?: () => void;
  readonly steps: Steps;
}

async function record(execute: () => Promise<unknown>, { onAsk, prepare, steps }: RunOptions): Promise<OnePathRun> {
  for (const methods of Object.values(services)) {
    Object.values(methods).forEach((mock) => mock.mockClear());
  }

  prepare?.();
  resetEmittedInThisRun();
  process.exitCode = undefined;

  const write = vi.mocked(process.stdout.write);
  const start = write.mock.calls.length;
  let split = start;
  let queriesAtLastAnswer = 0;
  let previewQueries: string[] = [];
  const script = startScript(steps, (message) => {
    if (/Emitimos/.test(message)) {
      split = write.mock.calls.length;
      previewQueries = queries().slice(queriesAtLastAnswer);
    }

    queriesAtLastAnswer = queries().length;
    onAsk?.(message);
  });
  const error: unknown = await execute().then(
    () => undefined,
    (reason: unknown) => reason,
  );
  const written = write.mock.calls.map(([chunk]) => String(chunk));

  return {
    after: written.slice(split),
    asked: script.asked,
    before: written.slice(start, split),
    emitted: describeEmittedInThisRun(),
    error,
    exitCode: process.exitCode,
    previewQueries,
    requests: [...wsfeRequests(), ...wsfexRequests()].map((request) => structuredClone(request)),
  };
}

/** El comando con flags, en una terminal: sin `--emitir` ni `--previsualizar`, pregunta. */
export function runCommand(args: readonly string[], options: RunOptions): Promise<OnePathRun> {
  return record(() => createProgram().parseAsync(['node', 'arcli', ...args]), options);
}

export function runAssistant(flow: () => Promise<unknown>, options: RunOptions): Promise<OnePathRun> {
  return record(flow, options);
}

/** Sin errores y con todo el guion preguntado. */
export function expectFinished(result: OnePathRun, steps: Steps): void {
  if (result.error !== undefined) {
    throw result.error;
  }

  expect(result.asked).toHaveLength(steps.length);
}

export function useOnePathFixture(): ArcaProfileFixture {
  const profile = useClockFixture();
  const originalTty = [process.stdin.isTTY, process.stdout.isTTY] as const;

  beforeEach(() => {
    profile.writeConfig(profile.configWith(profile.healthy, CLOCK_CONFIG));
    setClock(BEFORE_MIDNIGHT);
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
  });

  afterEach(() => {
    resetEmittedInThisRun();
    [process.stdin.isTTY, process.stdout.isTTY] = originalTty;
  });

  return profile;
}

/** Los flujos, cada uno con su sesion nueva. */
export const invoiceFlow = () => runInvoiceFlow(createInteractiveSession({}));
export const productionInvoiceFlow = () => runInvoiceFlow(createInteractiveSession({ produccion: true }));
export const receiptFlow = () => runInvoiceFlow(createInteractiveSession({}), true);
export const noteFlow = (kind: 'credito' | 'debito') => () => runNoteFlow(createInteractiveSession({}), kind);
export const repeatFlow = () => runRepeatFlow(createInteractiveSession({}));

export const SERVICES: Steps = [
  [/Qué estás facturando/, 'Servicios'],
  [/Monto total/, '1000'],
];

export const FC_STEPS: Steps = [
  [/comprobante/, 'Factura C'],
  [/A quién/, 'Consumidor final'],
  ...SERVICES,
  NO_OPTIONALS,
];
export const FC_ARGS = ['fc', '-m', '1000', '--cs', '--cfinal'];

export const FA_STEPS: Steps = [
  [/comprobante/, 'Factura A'],
  [/A quién/, 'Con CUIT'],
  [/CUIT del receptor/, String(CLIENT_CUIT)],
  [/Condición frente al IVA/, 'Responsable inscripto'],
  ...SERVICES,
  NO_OPTIONALS,
];
export const RI_ARGS = ['--cuit', String(CLIENT_CUIT), '--ir-ri'];

export const FE_STEPS: Steps = [
  [/comprobante/, 'Factura de exportación E'],
  [/cliente del exterior/, 'ACME LLC'],
  [/Domicilio/, '123 Main St'],
  [/País de destino/, '212'],
  [/ID impositivo/, ''],
  [/Qué exportás/, 'Servicios'],
  [/Moneda del comprobante/, 'Pesos'],
  ...singleExportItem('100', 'Consultoría'),
  [/Forma de pago/, 'Transferencia Internacional'],
  [/Fecha de pago/, ''],
  NO_OPTIONALS,
];
export const FE_ARGS = [
  ...['fe', '--cliente', 'ACME LLC', '--domicilio-cliente', '123 Main St', '--pais-destino', '212'],
  ...['-m', '100', '--item', '|Consultoría|1|100|unidades', '--moneda', 'PES'],
];

/** Una nota E sobre la factura E 00003-00000001, entera, con sus items. */
export const NOTE_E_STEPS: Steps = [
  [/Sobre qué comprobante/, 'Facturas'],
  [/Qué factura\?/, 'Factura de exportación E'],
  [/Punto de venta de la factura E/, '3'],
  [/Número de la factura E/, '1'],
  ...KEEP_EXPORT_ITEMS,
  NO_OPTIONALS,
];
export const noteEArgs = (shortcut: 'nce' | 'nde') => [
  ...[shortcut, '--ar', '1', '--apv', '3', '-m', '1500', '--item', '|Consultoría|1|1500|unidades'],
];

export const TO_INVOICE = [/A qué la asociamos/, 'A una factura'] as const;

/** Una nota A, B, C o FCE sobre un comprobante. En FCE no se pregunta a que se asocia. */
export const over = (invoice: string, target?: Steps[number], number = '00003-00000041'): Steps => [
  [/Sobre qué comprobante/, 'Facturas'],
  [/Qué factura\?/, invoice],
  ...(target ? [target] : []),
  [/Sobre qué f/, number],
];
