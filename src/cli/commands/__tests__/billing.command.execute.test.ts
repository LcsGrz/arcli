import { Command } from 'commander';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import {
  type BillingCommandDependencies,
  type BillingCommandGateways,
  executeBillingCommand,
  registerBillingCommandOptions,
} from '../billing.command.shared';

const spinner = { stop: vi.fn() };

// En una terminal el comando muestra un spinner; aca se ve si se detiene siempre.
vi.mock('../../spinner', () => ({ startSpinner: () => spinner }));

/** Lo que devuelve wsfe al autorizar, recortado a lo que lee arcli. */
function authorization(result: 'A' | 'R') {
  return {
    cae: result === 'A' ? '75123456789012' : '',
    caeFchVto: result === 'A' ? '20261130' : '',
    response: {
      FeDetResp: {
        FECAEDetResponse: [
          {
            CbteDesde: 42,
            CbteHasta: 42,
            ...(result === 'R'
              ? { Observaciones: { Obs: [{ Code: 10243, Msg: 'Condicion IVA receptor no valida' }] } }
              : {}),
            Resultado: result,
          },
        ],
      },
    },
  } as never;
}

function gateways(overrides: Partial<BillingCommandGateways['billing']> = {}): BillingCommandGateways {
  return {
    billing: {
      createVoucher: vi.fn(async () => authorization('A')),
      getNextVoucherNumber: vi.fn(async () => 42),
      getQuotation: vi.fn(async () => 1000),
      ...overrides,
    },
    fce: { getObligation: vi.fn() } as never,
    padron: { getTaxpayer: vi.fn(async () => null) },
  };
}

function runtime(outputJson: boolean): ResolvedArcaRuntime {
  return {
    certificateNotices: [],
    config: arcliConfigSchema.parse({ cuit: '20111111112', puntoVentaPorDefecto: 3 }),
    context: { cuit: 20111111112 },
    environment: 'testing',
    outputJson,
    outputRaw: false,
    pointOfSale: 3,
  } as unknown as ResolvedArcaRuntime;
}

let stdout = '';
let directory = '';

async function run(
  args: readonly string[],
  options: { readonly gateways?: BillingCommandGateways; readonly json?: boolean } = {},
): Promise<BillingCommandGateways> {
  const command = new Command('fc');
  const used = options.gateways ?? gateways();
  const dependencies: BillingCommandDependencies = {
    createGateways: () => used,
    resolveRuntime: () => runtime(options.json ?? true),
  };

  registerBillingCommandOptions(command);
  command.parse(['node', 'fc', ...args]);
  await executeBillingCommand(command, 'fc', {}, dependencies);

  return used;
}

const BASE = ['-m', '1000', '--cs', '--cfinal'];

beforeEach(() => {
  stdout = '';
  directory = mkdtempSync(join(tmpdir(), 'arcli-command-'));
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);

    return true;
  });
  spinner.stop.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(directory, { force: true, recursive: true });
});

describe('executeBillingCommand con --json', () => {
  it('la vista previa escribe un solo JSON en stdout y no emite', async () => {
    const used = await run([...BASE, '--previsualizar']);

    expect(JSON.parse(stdout)).toMatchObject({ estado: 'previsualizacion', previsualizacion: true });
    expect(used.billing.createVoucher).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('emitido y aprobado: un JSON con el CAE y exit 0', async () => {
    await run([...BASE, '--emitir']);

    expect(JSON.parse(stdout)).toMatchObject({ cae: '75123456789012', estado: 'aprobado' });
    expect(process.exitCode).toBeUndefined();
  });

  it('rechazado por ARCA: el resultado sale igual, con exit 2', async () => {
    await run([...BASE, '--emitir'], { gateways: gateways({ createVoucher: vi.fn(async () => authorization('R')) }) });

    expect(JSON.parse(stdout)).toMatchObject({ estado: 'rechazado' });
    expect(process.exitCode).toBe(2);
  });

  it('en moneda extranjera avisa la cotizacion oficial, como en el modo interactivo', async () => {
    await run([...BASE, '--moneda', 'USD', '--previsualizar']);

    expect(JSON.parse(stdout).avisos).toEqual([expect.stringContaining('cotización oficial')]);
  });

  it('un lote que se corta escribe los ya emitidos y despues falla con el indice', async () => {
    const path = join(directory, 'lote.json');
    const createVoucher = vi
      .fn()
      .mockResolvedValueOnce(authorization('A'))
      .mockRejectedValueOnce(new Error('socket hang up'));

    writeFileSync(
      path,
      JSON.stringify([
        {
          concepto: 'servicios',
          emitir: true,
          ivaReceptor: 'consumidor-final',
          montoTotal: 1000,
          tipoDocumento: 'consumidor-final',
        },
        {
          concepto: 'servicios',
          emitir: true,
          ivaReceptor: 'consumidor-final',
          montoTotal: 2000,
          tipoDocumento: 'consumidor-final',
        },
      ]),
    );

    await expect(run(['--cargar', path], { gateways: gateways({ createVoucher }) })).rejects.toMatchObject({
      code: 'BATCH_EMISSION_ERROR',
    });

    const written = JSON.parse(stdout) as unknown[];

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ cae: '75123456789012' });
  });
});

describe('executeBillingCommand en una terminal', () => {
  it('detiene el spinner si la emision falla', async () => {
    const failing = gateways({ createVoucher: vi.fn(async () => Promise.reject(new Error('socket hang up'))) });

    await expect(run([...BASE, '--emitir'], { gateways: failing, json: false })).rejects.toMatchObject({
      code: 'EMISSION_UNCERTAIN',
    });
    expect(spinner.stop).toHaveBeenCalled();
  });
});
