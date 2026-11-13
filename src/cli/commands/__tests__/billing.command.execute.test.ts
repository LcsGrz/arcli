import { Command } from 'commander';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function runtime(outputJson: boolean, config: Record<string, unknown> = {}): ResolvedArcaRuntime {
  return {
    certificateNotices: [],
    config: arcliConfigSchema.parse({ cuit: '20111111112', puntoVentaPorDefecto: 3, ...config }),
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
  options: {
    readonly config?: Record<string, unknown>;
    readonly gateways?: BillingCommandGateways;
    readonly json?: boolean;
  } = {},
): Promise<BillingCommandGateways> {
  const command = new Command('fc');
  const used = options.gateways ?? gateways();
  const dependencies: BillingCommandDependencies = {
    createGateways: () => used,
    resolveRuntime: () => runtime(options.json ?? true, options.config),
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

/** Las claves de la tabla "Caso simple" de docs/input-output.md, que es el contrato del `--json`. */
function documentedSummaryKeys(): string[] {
  const doc = readFileSync(new URL('../../../../docs/input-output.md', import.meta.url), 'utf8');
  const section = doc.split('### Caso simple')[1]?.split('\n### ')[0] ?? '';

  return [...section.matchAll(/^\| `(\w+)`/gm)].map((match) => match[1] as string);
}

/** Opcionales: `deprecado` solo con errores o eventos de ARCA, y `pdf` solo si se intento generar. */
const OPTIONAL_KEYS = new Set(['deprecado', 'pdf']);

/** El contrato tambien escrito aca, para que un cambio en la doc o en el codigo se vea en el diff del test. */
const SUMMARY_KEYS = [
  'atajo',
  'avisos',
  'cae',
  'caeVencimiento',
  'comprobante',
  'entorno',
  'errores',
  'estado',
  'eventos',
  'numero',
  'observacion',
  'observaciones',
  'previsualizacion',
  'puntoVenta',
  'resultado',
  'solicitud',
  'sugerencias',
  'tipoArca',
];

const keysOf = (value: unknown): string[] => Object.keys(value as Record<string, unknown>).sort();

function writeBatch(items: number): string {
  const path = join(directory, 'lote.json');

  writeFileSync(
    path,
    JSON.stringify(
      Array.from({ length: items }, (_, position) => ({
        concepto: 'servicios',
        ivaReceptor: 'consumidor-final',
        montoTotal: 1000 * (position + 1),
        tipoDocumento: 'consumidor-final',
      })),
    ),
  );

  return path;
}

describe('contrato del --json (docs/input-output.md)', () => {
  it('la tabla de la doc lista las mismas claves que fija este test', () => {
    expect(
      documentedSummaryKeys()
        .filter((key) => !OPTIONAL_KEYS.has(key))
        .sort(),
    ).toEqual(SUMMARY_KEYS);
  });

  it('la vista previa trae exactamente las claves documentadas, sin numero ni resultado', async () => {
    await run([...BASE, '--previsualizar']);

    const json = JSON.parse(stdout);

    expect(keysOf(json)).toEqual(SUMMARY_KEYS);
    expect(json).toMatchObject({
      atajo: 'fc',
      cae: null,
      caeVencimiento: null,
      comprobante: 'Factura C',
      entorno: 'testing',
      errores: [],
      estado: 'previsualizacion',
      eventos: [],
      numero: null,
      previsualizacion: true,
      puntoVenta: 3,
      resultado: null,
      tipoArca: 11,
    });
  });

  it('un comprobante aprobado trae exactamente las claves documentadas, con el numero en la solicitud', async () => {
    await run([...BASE, '--emitir']);

    const json = JSON.parse(stdout);

    expect(keysOf(json)).toEqual(SUMMARY_KEYS);
    expect(json).toMatchObject({
      cae: '75123456789012',
      caeVencimiento: '20261130',
      estado: 'aprobado',
      numero: 42,
      previsualizacion: false,
      resultado: 'A',
      solicitud: { CbteDesde: 42, CbteHasta: 42 },
    });
  });

  it('--bruto suma solo `respuesta`, con la del SDK si se emitio', async () => {
    await run([...BASE, '--emitir', '--bruto']);

    const json = JSON.parse(stdout);

    expect(keysOf(json)).toEqual([...SUMMARY_KEYS, 'respuesta'].sort());
    expect(json.respuesta).toMatchObject({ cae: '75123456789012', caeFchVto: '20261130' });
  });

  it('--bruto en la vista previa: `respuesta` es el mensaje, no null', async () => {
    await run([...BASE, '--previsualizar', '--bruto']);

    expect(JSON.parse(stdout).respuesta).toEqual({
      mensaje: 'Sin emisión real. Usá `--emitir` para obtener una respuesta de ARCA.',
    });
  });

  it('un lote es un array: cada item suma `indice` desde 1 y, con --bruto, su `respuesta`', async () => {
    await run(['--cargar', writeBatch(2), '--previsualizar', '--bruto']);

    const json = JSON.parse(stdout) as unknown[];

    expect(json.map((item) => (item as { indice: number }).indice)).toEqual([1, 2]);
    json.forEach((item) => expect(keysOf(item)).toEqual([...SUMMARY_KEYS, 'indice', 'respuesta'].sort()));
  });

  it('un array de un solo elemento tambien es un lote', async () => {
    await run(['--cargar', writeBatch(1), '--previsualizar']);

    expect(JSON.parse(stdout)).toEqual([expect.objectContaining({ indice: 1 })]);
  });
});

describe('sin flag de emision no se emite (el comando entero, con --json)', () => {
  it('sin --emitir ni --previsualizar queda en vista previa y no llama a createVoucher', async () => {
    const used = await run(BASE);

    expect(JSON.parse(stdout)).toMatchObject({ estado: 'previsualizacion', previsualizacion: true });
    expect(used.billing.createVoucher).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('un lote sin "emitir" tampoco emite ninguno', async () => {
    const used = await run(['--cargar', writeBatch(2)]);

    expect(JSON.parse(stdout)).toEqual([
      expect.objectContaining({ estado: 'previsualizacion' }),
      expect.objectContaining({ estado: 'previsualizacion' }),
    ]);
    expect(used.billing.createVoucher).not.toHaveBeenCalled();
  });

  it('con emitir true en la config emite sin flags', async () => {
    const used = await run(BASE, { config: { output: { emitirPorDefecto: true } } });

    expect(JSON.parse(stdout)).toMatchObject({ estado: 'aprobado', previsualizacion: false });
    expect(used.billing.createVoucher).toHaveBeenCalledTimes(1);
  });

  it('--previsualizar le gana a emitir true en la config', async () => {
    const used = await run([...BASE, '--previsualizar'], { config: { output: { emitirPorDefecto: true } } });

    expect(JSON.parse(stdout)).toMatchObject({ estado: 'previsualizacion' });
    expect(used.billing.createVoucher).not.toHaveBeenCalled();
  });
});
