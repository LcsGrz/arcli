import { Command } from 'commander';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
import { reportCliError } from '../../error-output';
import { executeBillingCommand, registerBillingCommandOptions } from '../billing.command.shared';

/** Un lote cortado, por el comando real y con lo que se ve en la terminal (ERR-3 y ERR-14). */
vi.mock('../../spinner', () => ({ startSpinner: () => null }));

function authorization(result: 'A' | 'R') {
  return {
    cae: result === 'A' ? '75123456789012' : '',
    caeFchVto: result === 'A' ? '20261130' : '',
    response: { FeDetResp: { FECAEDetResponse: [{ CbteDesde: 42, CbteHasta: 42, Resultado: result }] } },
  } as never;
}

let directory = '';
let stdout = '';
let stderr = '';
/** La escritura de los ya procesados falla, como con el disco lleno al redirigir la salida. */
let stdoutFails = false;

function plain(text: string): string {
  return stripAnsi(text).replace(/[│┃║╏\s]+/g, ' ');
}

type Step = 'A' | 'R' | 'incierta' | 'login';

/** Corre un lote en el que cada comprobante termina como dice `steps`, y reporta el error como `index.ts`. */
async function runBatch(
  steps: readonly Step[],
  options: { readonly json?: boolean; readonly pointsOfSale?: readonly number[] } = {},
): Promise<number> {
  const path = join(directory, 'lote.json');
  const item = {
    concepto: 'servicios',
    emitir: true,
    ivaReceptor: 'consumidor-final',
    tipoDocumento: 'consumidor-final',
  };
  let position = 0;

  writeFileSync(
    path,
    JSON.stringify(
      steps.map((_step, index) => ({
        ...item,
        montoTotal: 1000 * (index + 1),
        ...(options.pointsOfSale ? { puntoVenta: options.pointsOfSale[index] } : {}),
      })),
    ),
  );

  const command = new Command('fc');
  const runtime = {
    certificateNotices: [],
    config: arcliConfigSchema.parse({ cuit: '20111111112', pdf: 'nunca', puntoVentaPorDefecto: 3 }),
    context: { cuit: 20111111112 },
    cuit: 20111111112,
    environment: 'testing',
    outputJson: options.json ?? false,
    outputRaw: false,
    pointOfSale: 3,
  } as unknown as CliArcaRuntime;

  registerBillingCommandOptions(command);
  command.parse(['node', 'fc', '--cargar', path]);

  try {
    await executeBillingCommand(
      command,
      'fc',
      {},
      {
        createGateways: () => ({
          billing: {
            createVoucher: async () => {
              const step = steps[position];

              position += 1;

              if (step === 'incierta') {
                throw new Error('socket hang up');
              }

              return authorization(step === 'R' ? 'R' : 'A');
            },
            getNextVoucherNumber: async () => {
              if (steps[position] === 'login') {
                throw new Error('LoginFault');
              }

              return 42;
            },
            getQuotation: async () => 1000,
          },
          fce: { getObligation: vi.fn() } as never,
          fceRegistry: { getVoucherState: async () => undefined },
          history: { getLastNumber: async () => 0, getVoucher: async () => undefined },
          padron: { getTaxpayer: async () => null },
        }),
        resolveRuntime: () => runtime,
      },
    );
  } catch (error) {
    return reportCliError(error, options.json ?? false);
  }

  throw new Error('el lote no se cortó');
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-lote-'));
  stdout = '';
  stderr = '';
  stdoutFails = false;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    if (stdoutFails) {
      throw new Error('ENOSPC: no space left on device, write');
    }

    stdout += String(chunk);

    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);

    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(directory, { force: true, recursive: true });
});

describe('la sugerencia del lote cortado, según lo que pasó (ERR-3)', () => {
  it('sin ninguno procesado no habla de ya emitidos', async () => {
    expect(await runBatch(['login', 'A'])).toBe(1);
    expect(plain(stderr)).toContain('No se procesó ninguno');
    expect(plain(stderr)).toContain('el #1');
    expect(plain(stderr)).not.toContain('ya se emitieron');
    expect(plain(stderr)).not.toContain('de arriba');
  });

  it('con procesados, solo los que tienen CAE están emitidos', async () => {
    await runBatch(['A', 'R', 'login', 'A']);

    expect(plain(stderr)).toContain('Los procesados con CAE ya se emitieron: no los vuelvas a cargar.');
    expect(plain(stderr)).toContain('el #3');
    expect(plain(stderr)).toContain('reintentá los que quedaron sin procesar');
  });

  it('con una emisión sin confirmar no repite la verificación del mensaje', async () => {
    await runBatch(['A', 'incierta', 'A']);

    expect(plain(stderr)).toContain('arcli ultimos fc --pv 3 --testing');
    expect(plain(stderr).match(/arcli ultimos/g)).toHaveLength(1);
    expect(plain(stderr)).toContain('Los procesados con CAE ya se emitieron');
    expect(plain(stderr)).toContain('reintentá los que quedaron sin procesar');
  });

  it('sin confirmar el último: no manda a reintentar lo que no hay', async () => {
    await runBatch(['A', 'incierta']);

    expect(plain(stderr)).not.toContain('sin procesar');
  });

  it('sin confirmar el único: el mensaje ya dice todo, sin sugerencia', async () => {
    await runBatch(['incierta']);

    expect(plain(stderr)).toContain('El #1 puede haberse emitido');
    expect(plain(stderr)).not.toContain('Sugerencia');
  });

  it('no repite en "Detalles" lo que ya dice el mensaje (H21)', async () => {
    await runBatch(['A', 'incierta', 'A']);

    expect(plain(stderr)).not.toMatch(/Detalles|procesados:|sinConfirmar|fallo:|total:/);
  });

  it('en JSON no cambian código, detalles ni sugerencia', async () => {
    expect(await runBatch(['A', 'incierta', 'A'], { json: true })).toBe(1);

    const error = JSON.parse(stderr) as Record<string, unknown>;

    expect({ ...error, error: undefined }).toEqual({
      codigo: 'BATCH_EMISSION_ERROR',
      detalles: { fallo: 2, procesados: 1, sinConfirmar: 2, sinProcesar: [3], total: 3 },
      error: undefined,
      sugerencia: null,
    });
  });
});

describe('si no se pueden mostrar los ya procesados (ERR-14)', () => {
  it('avisa cuántos son y cómo verlos, y sale el error del lote', async () => {
    stdoutFails = true;

    expect(await runBatch(['A', 'R', 'login'])).toBe(1);
    expect(plain(stderr)).toContain('No se pudieron mostrar todos los datos de los 2 comprobantes ya procesados');
    expect(plain(stderr)).toContain('arcli ultimos fc --pv 3 --testing');
    expect(plain(stderr)).toContain('El lote se interrumpió en el comprobante #3: LoginFault');
    expect(stderr.indexOf('No se pudieron mostrar')).toBeLessThan(stderr.indexOf('LoginFault'));
  });

  it('con uno solo, en singular', async () => {
    stdoutFails = true;
    await runBatch(['A', 'login']);

    expect(plain(stderr)).toContain('del comprobante ya procesado');
  });

  it('un comando por punto de venta', async () => {
    stdoutFails = true;
    await runBatch(['A', 'A', 'login'], { pointsOfSale: [4, 5, 5] });

    expect(plain(stderr)).toContain('arcli ultimos fc --pv 4 --testing');
    expect(plain(stderr)).toContain('arcli ultimos fc --pv 5 --testing');
  });

  it('si se mostraron, no avisa', async () => {
    await runBatch(['A', 'login']);

    expect(plain(stdout)).toContain('75123456789012');
    expect(plain(stderr)).not.toContain('No se pud');
  });

  it('con --json no ensucia stdout ni stderr', async () => {
    stdoutFails = true;
    await runBatch(['A', 'login'], { json: true });

    expect(stdout).toBe('');
    expect(JSON.parse(stderr)).toMatchObject({ codigo: 'BATCH_EMISSION_ERROR', sugerencia: null });
  });
});
