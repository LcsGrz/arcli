import { Command } from 'commander';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VoucherShortcut } from '../../../modules/billing/billing.types';
import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
  type ExportGateway,
  type ExportVoucherKind,
} from '../../../modules/export/export.types';
import { billingAnswer, exportAnswer } from '../../../testing/arca-answers';
import { fakeBillingGateway, fakeExportGateway } from '../../../testing/arca-gateways';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
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
 * Ctrl+C en una pregunta de un comando, por el comando real (ERR-2): antes de emitir dice que no se emitió nada; con el
 * comprobante ya emitido, nunca. Solo se reemplaza la lista que lee el teclado.
 */
vi.mock('../../spinner', () => ({ startSpinner: () => ({ stop: vi.fn(), text: '' }) }));
vi.mock('../../interactive/list-select', () => ({ listSelect: vi.fn() }));

const CANCELLED = 'Cancelado. No se emitió nada.';

function cancelled(): Error {
  return Object.assign(new Error('User force closed the prompt with SIGINT'), { name: 'ExitPromptError' });
}

function billingGateways(): BillingCommandGateways {
  return {
    billing: fakeBillingGateway({
      createVoucher: vi.fn(async () =>
        billingAnswer({
          cae: '75123456789012',
          caeFchVto: '20261130',
          response: { FeDetResp: { FECAEDetResponse: [{ CbteDesde: 42, CbteHasta: 42, Resultado: 'A' }] } },
        }),
      ),
    }),
    fce: { getObligation: vi.fn() } as never,
    fceRegistry: { getVoucherState: vi.fn(async () => undefined) },
    history: { getLastNumber: vi.fn(async () => 0), getVoucher: vi.fn(async () => undefined) },
    padron: { getTaxpayer: vi.fn(async () => null) },
  };
}

function exportGateway(): ExportGateway {
  return fakeExportGateway({
    authorize: vi.fn(async () =>
      exportAnswer({
        FEXAuthorizeResult: {
          FEXErr: { ErrCode: 0, ErrMsg: '' },
          FEXEvents: { EventCode: 0, EventMsg: '' },
          FEXResultAuth: {
            Cae: '75123456789012',
            Cbte_nro: 1,
            Cbte_tipo: 19,
            Cuit: 20111111112,
            Fch_cbte: '20261101',
            Fch_venc_Cae: '20261111',
            Id: 8,
            Motivos_Obs: '',
            Punto_vta: 4,
            Reproceso: 'N',
            Resultado: 'A',
          },
        },
      }),
    ),
    getVoucher: vi.fn(async () => ({
      activities: [620100],
      arcaType: 19,
      clientAddress: '123 Main St',
      clientCountryCuit: 55000002126,
      clientName: 'ACME LLC',
      currencyCode: 'DOL',
      date: '20261030',
      destinationCountry: 212,
      exchangeRate: 1000,
      exportType: 2 as const,
      language: 1,
      number: 1,
      paymentTerms: 'Transferencia Internacional',
      pointOfSale: 4,
      result: 'A',
      total: 1500,
    })),
  });
}

function runtime(config: Record<string, unknown> = {}): CliArcaRuntime {
  return {
    certificateNotices: [],
    config: arcliConfigSchema.parse({
      cuit: '20111111112',
      emisor: { domicilio: 'Calle 123', inicioActividades: '20200301', razonSocial: 'Ana Gomez' },
      exportacion: { actividad: 620100 },
      pdf: 'nunca',
      puntoVentaPorDefecto: 4,
      ...config,
    }),
    context: { cuit: 20111111112 },
    cuit: 20111111112,
    environment: 'testing',
    outputJson: false,
    outputRaw: false,
    pointOfSale: 4,
  } as unknown as CliArcaRuntime;
}

async function runBilling(
  args: readonly string[],
  options: { config?: Record<string, unknown>; gateways?: BillingCommandGateways; shortcut?: VoucherShortcut } = {},
): Promise<BillingCommandGateways> {
  const used = options.gateways ?? billingGateways();
  const shortcut = options.shortcut ?? 'fc';
  const command = new Command(shortcut);

  registerBillingCommandOptions(command);
  command.parse(['node', shortcut, ...args]);
  await executeBillingCommand(
    command,
    shortcut,
    {},
    { createGateways: () => used, resolveRuntime: () => runtime(options.config) },
  );

  return used;
}

async function runExport(
  args: readonly string[],
  options: { config?: Record<string, unknown>; gateway?: ExportGateway; kind?: ExportVoucherKind } = {},
): Promise<ExportGateway> {
  const used = options.gateway ?? exportGateway();
  const voucherKind = options.kind ?? EXPORT_VOUCHER_KIND;
  const command = new Command(voucherKind.shortcut);

  registerGlobalOptions(command);
  registerExportOptions(command, voucherKind);
  command.parse(['node', voucherKind.shortcut, ...args]);
  await executeExportCommand(
    command,
    { voucherKind },
    { createGateway: () => used, resolveRuntime: () => runtime(options.config) },
  );

  return used;
}

/** Termina como `index.ts`: con error no pasa por el `.then` que muestra el panel de actualizacion. */
async function expectCancelled(run: Promise<unknown>): Promise<void> {
  let stderr = '';
  const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);

    return true;
  });
  const error: unknown = await run.then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(Error);
  expect(reportCliError(error, false)).toBe(1);
  expect(stripAnsi(stderr).replace(/[│┃╏\s]+/g, ' ')).toContain(CANCELLED);
  expect(stripAnsi(stderr)).toContain('┌');
  expect(printed()).not.toContain('Cancelado');
  write.mockRestore();
}

const BILLING = ['-m', '1000', '--cs', '--cfinal'];
const EXPORT = [
  ...['--cliente', 'ACME LLC', '--domicilio-cliente', '123 Main St', '--pais-destino', '212'],
  ...['-m', '1500', '--cotizacion-moneda', '1000'],
];
const originalTty = [process.stdin.isTTY, process.stdout.isTTY] as const;
let stdout = '';
let directory = '';

function printed(): string {
  return stripAnsi(stdout).replace(/[│┃╏\s]+/g, ' ');
}

function batchFile(): string {
  const path = join(directory, 'lote.json');
  const item = { concepto: 'servicios', ivaReceptor: 'consumidor-final', tipoDocumento: 'consumidor-final' };

  writeFileSync(
    path,
    JSON.stringify([
      { ...item, montoTotal: 1000 },
      { ...item, montoTotal: 2000 },
    ]),
  );

  return path;
}

beforeEach(() => {
  stdout = '';
  directory = mkdtempSync(join(tmpdir(), 'arcli-cancel-'));
  vi.stubEnv('ARCLI_CONFIG_DIR', directory);
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);

    return true;
  });
  vi.mocked(listSelect).mockReset();
  vi.mocked(listSelect).mockRejectedValueOnce(cancelled());
  process.stdin.isTTY = true;
  process.stdout.isTTY = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  [process.stdin.isTTY, process.stdout.isTTY] = originalTty;
  rmSync(directory, { force: true, recursive: true });
});

describe('Ctrl+C en "¿Emitimos?": no se emitió nada y sale con 1', () => {
  it.each<[string, VoucherShortcut, readonly string[]]>([
    ['factura A', 'fa', ['-m', '1000', '--cs', '--cuit', '20123456786', '--ir', 'responsable-inscripto']],
    ['factura B', 'fb', BILLING],
    ['factura C', 'fc', BILLING],
    ['recibo C', 'rc', BILLING],
    ['nota de crédito C', 'ncc', [...BILLING, '--periodo-desde', 'mes-pasado', '--periodo-hasta', 'hoy']],
  ])('%s', async (_name, shortcut, args) => {
    const used = billingGateways();

    await expectCancelled(runBilling(args, { gateways: used, shortcut }));
    expect(used.billing.createVoucher).not.toHaveBeenCalled();
  });

  it('lote', async () => {
    const used = billingGateways();

    await expectCancelled(runBilling(['--cargar', batchFile()], { gateways: used }));
    expect(used.billing.createVoucher).not.toHaveBeenCalled();
  });

  it.each<[string, ExportVoucherKind, readonly string[]]>([
    ['factura E', EXPORT_VOUCHER_KIND, EXPORT],
    ['nota de crédito E', EXPORT_CREDIT_NOTE_KIND, ['-m', '500', '--ar', '1']],
  ])('%s', async (_name, kind, args) => {
    const used = exportGateway();

    await expectCancelled(runExport(args, { gateway: used, kind }));
    expect(used.authorize).not.toHaveBeenCalled();
  });

  it('cualquier otro error de la pregunta no se tapa', async () => {
    vi.mocked(listSelect).mockReset();
    vi.mocked(listSelect).mockRejectedValueOnce(new Error('boom'));

    await expect(runBilling(BILLING)).rejects.toThrow('boom');
    expect(printed()).not.toContain('Cancelado');
  });
});

/** La pregunta del PDF (o la de instalar el componente) llega con el comprobante ya emitido. */
describe('Ctrl+C con el comprobante ya emitido: no dice que no se emitió nada y sale con 0', () => {
  const QUESTIONS: ReadonlyArray<[string, Record<string, unknown>]> = [
    ['la pregunta del PDF', { pdf: 'preguntar' }],
    ['instalar el componente de PDF', { pdf: 'siempre' }],
  ];

  function expectEmitted(): void {
    expect(listSelect).toHaveBeenCalledTimes(1);
    expect(printed()).toContain('75123456789012');
    expect(printed()).not.toContain('No se emitió nada');
    expect(printed()).not.toContain('User force closed');
    expect(process.exitCode).toBeUndefined();
  }

  it.each(QUESTIONS)('A, B y C: %s', async (_name, config) => {
    const used = await runBilling([...BILLING, '--emitir'], { config });

    expect(used.billing.createVoucher).toHaveBeenCalledTimes(1);
    expectEmitted();
  });

  it.each(QUESTIONS)('lote: %s', async (_name, config) => {
    const used = await runBilling(['--cargar', batchFile(), '--emitir'], { config });

    expect(used.billing.createVoucher).toHaveBeenCalledTimes(2);
    expectEmitted();
  });

  it('lote que se corta con uno ya emitido: sale el error del lote, sin "No se emitió nada"', async () => {
    const used = billingGateways();
    const command = new Command('fc');

    vi.mocked(used.billing.getNextVoucherNumber)
      .mockResolvedValueOnce(42)
      .mockRejectedValueOnce(new Error('LoginFault'));
    registerBillingCommandOptions(command);
    command.parse(['node', 'fc', '--cargar', batchFile(), '--emitir']);

    await expect(
      executeBillingCommand(
        command,
        'fc',
        {},
        { createGateways: () => used, resolveRuntime: () => runtime({ pdf: 'preguntar' }) },
      ),
    ).rejects.toMatchObject({ code: 'BATCH_EMISSION_ERROR' });
    expectEmitted();
  });

  it.each(QUESTIONS)('E: %s', async (_name, config) => {
    const used = await runExport([...EXPORT, '--emitir'], { config });

    expect(used.authorize).toHaveBeenCalledTimes(1);
    expectEmitted();
  });
});
