import { Command } from 'commander';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import { rethrowIfWsfeNotAuthorized } from '../../../services/arca/last-voucher';
import { billingAnswer } from '../../../testing/arca-answers';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
import { reportCliError } from '../../error-output';
import { listSelect } from '../../interactive/list-select';
import { executeBillingCommand, registerBillingCommandOptions } from '../billing.command.shared';

/** Un lote cortado, por el comando real y con lo que se ve en la terminal (ERR-3 y ERR-14). */
vi.mock('../../spinner', () => ({ startSpinner: () => null }));
vi.mock('../../interactive/list-select', () => ({ listSelect: vi.fn() }));

function authorization(result: 'A' | 'R') {
  return {
    cae: result === 'A' ? '75123456789012' : '',
    caeFchVto: result === 'A' ? '20261130' : '',
    response: { FeDetResp: { FECAEDetResponse: [{ CbteDesde: 42, CbteHasta: 42, Resultado: result }] } },
  };
}

let directory = '';
let stdout = '';
let stderr = '';
/** Despues de mostrar los ya procesados, la pregunta del PDF falla: no es un Ctrl+C. */
let deliveryFails = false;
const originalTty = [process.stdin.isTTY, process.stdout.isTTY] as const;

function plain(text: string): string {
  return stripAnsi(text).replace(/[│┃║╏\s]+/g, ' ');
}

type Step = 'A' | 'R' | 'ilegible' | 'incierta' | 'login' | 'sin-autorizar' | 'transitorio';

/** Corre un lote en el que cada comprobante termina como dice `steps`, y reporta el error como `index.ts`. */
async function runBatch(
  steps: readonly Step[],
  options: {
    readonly json?: boolean;
    readonly numbers?: readonly number[];
    readonly pointsOfSale?: readonly number[];
  } = {},
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
    config: arcliConfigSchema.parse({
      cuit: '20111111112',
      pdf: deliveryFails ? 'preguntar' : 'nunca',
      puntoVentaPorDefecto: 3,
    }),
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

              if (step === 'ilegible') {
                throw new TypeError("Cannot read properties of undefined (reading 'FeDetResp')");
              }

              return billingAnswer(authorization(step === 'R' ? 'R' : 'A'));
            },
            getNextVoucherNumber: async () => {
              if (steps[position] === 'sin-autorizar') {
                return rethrowIfWsfeNotAuthorized(new Error('ns1:coe.notAuthorized'));
              }

              if (steps[position] === 'transitorio') {
                throw new Error('(502) Transacción Activa');
              }

              if (steps[position] === 'login') {
                throw new Error('LoginFault');
              }

              return options.numbers?.[position] ?? 42 + steps.slice(0, position).filter((step) => step === 'A').length;
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
  deliveryFails = false;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);

    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);

    return true;
  });
});

afterEach(() => {
  [process.stdin.isTTY, process.stdout.isTTY] = originalTty;
  vi.mocked(listSelect).mockReset();
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(directory, { force: true, recursive: true });
});

describe('la sugerencia del lote cortado, según lo que pasó (ERR-3)', () => {
  it('sin ninguno procesado no habla de ya emitidos ni contradice el mensaje', async () => {
    expect(await runBatch(['login', 'A'])).toBe(1);
    expect(plain(stderr)).toContain('Procesados: 0 de 2');
    expect(plain(stderr)).toContain('No se emitió ninguno: podés reintentar los que quedaron sin procesar.');
    expect(plain(stderr)).not.toMatch(/ya se emitieron|de arriba|No se procesó/);
  });

  it('con procesados, solo los que tienen CAE están emitidos', async () => {
    await runBatch(['A', 'R', 'login', 'A']);

    expect(plain(stderr)).toContain('Los procesados con CAE ya se emitieron: recordá no volver a cargarlos.');
    expect(plain(stderr)).toContain('El resto no se emitió: reintentá únicamente los que quedaron sin procesar.');
  });

  it('con una emisión sin confirmar no repite la verificación del mensaje', async () => {
    await runBatch(['A', 'incierta', 'A']);

    expect(plain(stderr)).toContain('arcli ultimos fc --pv 3 --testing');
    expect(plain(stderr).match(/arcli ultimos/g)).toHaveLength(1);
    expect(plain(stderr)).toContain('Los procesados con CAE ya se emitieron');
    expect(plain(stderr)).toContain('Después reintentá únicamente los que quedaron sin procesar');
    expect(plain(stderr)).not.toContain('no se emitió');
  });

  it('con una respuesta ilegible tampoco dice que no se emitió (ERR-16)', async () => {
    await runBatch(['A', 'ilegible', 'A']);

    expect(plain(stderr)).toContain('El #2 puede haberse emitido');
    expect(plain(stderr)).not.toContain('no se emitió');
  });

  it('sin confirmar el último: no manda a reintentar lo que no hay', async () => {
    await runBatch(['A', 'incierta']);

    expect(plain(stderr)).not.toContain('sin procesar');
  });

  it('sin confirmar el único: solo manda a verificarlo', async () => {
    await runBatch(['incierta']);

    expect(plain(stderr)).toContain('El #1 puede haberse emitido');
    expect(plain(stderr)).toContain('Verificá el #1 antes de reintentarlo.');
    expect(plain(stderr)).not.toMatch(/ya se emitieron|sin procesar/);
  });

  it('no repite en "Detalles" lo que ya dice el mensaje (H21)', async () => {
    await runBatch(['A', 'incierta', 'A']);

    expect(plain(stderr)).not.toMatch(/Detalles|procesados:|sinConfirmar|fallo:|total:/);
  });

  it('en JSON, el código, los detalles y la misma sugerencia que el panel', async () => {
    expect(await runBatch(['A', 'incierta', 'A'], { json: true })).toBe(1);

    const error = JSON.parse(stderr) as Record<string, unknown>;

    expect({ ...error, error: undefined }).toEqual({
      codigo: 'BATCH_EMISSION_ERROR',
      detalles: {
        codigoCausa: 'EMISSION_UNCERTAIN',
        fallo: 2,
        procesados: 1,
        sinConfirmar: 2,
        sinProcesar: [3],
        total: 3,
      },
      error: undefined,
      sugerencia:
        'Los procesados con CAE ya se emitieron: recordá no volver a cargarlos. Verificá el #2 antes de reintentarlo. Después reintentá únicamente los que quedaron sin procesar.',
    });
  });
});

describe('si falla la entrega de los ya procesados (ERR-14)', () => {
  function failDelivery(): void {
    deliveryFails = true;
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    vi.mocked(listSelect).mockRejectedValueOnce(new Error('la pregunta falló'));
  }

  const steps = (count: number): Step[] => [...Array.from({ length: count }, (): Step => 'A'), 'login'];

  it('avisa antes del error del lote, con los números de los que tienen CAE', async () => {
    failDelivery();

    expect(await runBatch(['A', 'R', 'A', 'login'])).toBe(1);
    expect(plain(stderr)).toContain('No se pudieron mostrar todos los datos de los 3 comprobantes ya procesados.');
    expect(plain(stderr)).toContain('Se emitieron: fc del punto de venta 3, 42 y 43.');
    expect(plain(stderr)).toContain('`arcli ultimos fc --pv 3 --cantidad 3 --testing`');
    expect(plain(stderr)).toContain('El lote se interrumpió en el comprobante #4: LoginFault');
    expect(stderr.indexOf('No se pudieron mostrar')).toBeLessThan(stderr.indexOf('LoginFault'));
  });

  it('si tampoco se puede escribir el aviso, igual sale el error del lote', async () => {
    failDelivery();
    // El aviso es lo primero que va a stderr; lo que sigue, el error, se escribe.
    vi.mocked(process.stderr.write).mockImplementationOnce(() => {
      throw new Error('write EPIPE');
    });

    expect(await runBatch(['A', 'login'])).toBe(1);
    expect(plain(stderr)).toContain('El lote se interrumpió en el comprobante #2: LoginFault');
    expect(plain(stderr)).not.toContain('EPIPE');
  });

  it('con 20, el rango y una cantidad que los alcanza (sin ella se ven 15)', async () => {
    failDelivery();
    await runBatch(steps(20));

    expect(plain(stderr)).toContain('fc del punto de venta 3, del 42 al 61.');
    expect(plain(stderr)).toContain('`arcli ultimos fc --pv 3 --cantidad 21 --testing`');
  });

  it('con 60, más que el tope de `ultimos`: el rango y `consultar`', async () => {
    failDelivery();
    await runBatch(steps(60));

    expect(plain(stderr)).toContain('fc del punto de venta 3, del 42 al 101.');
    expect(plain(stderr)).toContain('`arcli consultar fc <número> --pv 3 --testing`');
    expect(plain(stderr)).not.toContain('--cantidad');
  });

  it('por punto de venta', async () => {
    failDelivery();
    await runBatch(['A', 'A', 'login'], { pointsOfSale: [4, 5, 5] });

    expect(plain(stderr)).toContain('`arcli ultimos fc --pv 4 --cantidad 2 --testing`');
    expect(plain(stderr)).toContain('`arcli ultimos fc --pv 5 --cantidad 2 --testing`');
  });

  it('con números salteados (alguien emitió en el medio), los nombra y la cantidad cubre los huecos', async () => {
    failDelivery();
    await runBatch(['A', 'A', 'A', 'A', 'A', 'login'], { numbers: [42, 45, 46, 47, 50] });

    expect(plain(stderr)).toContain('Se emitieron: fc del punto de venta 3, 42, del 45 al 47 y 50.');
    expect(plain(stderr)).toContain('--cantidad 10 --testing');
  });

  it('con uno solo, en singular', async () => {
    failDelivery();
    await runBatch(['A', 'login']);

    expect(plain(stderr)).toContain('Se emitió: fc del punto de venta 3, 42. Verificalo con');
  });

  it('sin ninguno con CAE, no da un comando', async () => {
    failDelivery();
    await runBatch(['R', 'login']);

    expect(plain(stderr)).not.toContain('Se emitieron');
  });

  it('si se entregaron, no avisa', async () => {
    await runBatch(['A', 'login']);

    expect(plain(stdout)).toContain('75123456789012');
    expect(plain(stderr)).not.toContain('No se pud');
  });

  it('con --json, una falla al escribir no ensucia stdout ni stderr', async () => {
    vi.mocked(process.stdout.write).mockImplementation(() => {
      throw new Error('no se pudo escribir');
    });
    await runBatch(['A', 'login'], { json: true });

    expect(stdout).toBe('');
    expect(JSON.parse(stderr)).toMatchObject({
      codigo: 'BATCH_EMISSION_ERROR',
      sugerencia:
        'Los procesados con CAE ya se emitieron: recordá no volver a cargarlos. El resto no se emitió: reintentá únicamente los que quedaron sin procesar.',
    });
  });

  it('un certificado sin autorizar a mitad del lote no dice que no se emitió nada', async () => {
    await runBatch(['A', 'sin-autorizar']);

    expect(plain(stderr)).toContain('El certificado no está autorizado para facturar');
    expect(plain(stderr)).not.toContain('No se emitió nada');
  });
});

describe('el lote cortado dice qué hacer, igual en el panel y en el JSON (REV-49)', () => {
  const EMITTED = 'Los procesados con CAE ya se emitieron: recordá no volver a cargarlos.';
  const SAFE = `${EMITTED} El resto no se emitió: reintentá únicamente los que quedaron sin procesar.`;
  const NONE = 'No se emitió ninguno: podés reintentar los que quedaron sin procesar.';
  const THEN = 'Después reintentá únicamente los que quedaron sin procesar.';
  const verify = (index: number) => `Verificá el #${index} antes de reintentarlo.`;
  const UNCERTAIN = 'No se pudo confirmar la emisión: socket hang up';
  const failed = (index: number, reason: string) => `El lote se interrumpió en el comprobante #${index}: ${reason}`;
  const unconfirmed = (index: number) =>
    `El #${index} puede haberse emitido: verificalo con \`arcli ultimos fc --pv 3 --testing\` antes de reintentarlo.`;
  const many = (count: number): Step[] => Array.from({ length: count }, (): Step => 'A');

  async function jsonError(steps: readonly Step[]): Promise<Record<string, unknown>> {
    expect(await runBatch(steps, { json: true })).toBe(1);

    return JSON.parse(stderr) as Record<string, unknown>;
  }

  const SUGGESTIONS: ReadonlyArray<[string, Step[], string]> = [
    ['con procesados y un fallo seguro', ['A', 'login', 'A'], SAFE],
    ['con procesados que ARCA rechazó y un fallo seguro', ['R', 'login'], SAFE],
    ['sin procesados y un fallo seguro', ['login', 'A'], NONE],
    ['la causa tiene su sugerencia: no se copia', ['A', 'sin-autorizar'], SAFE],
    ['sin confirmar, con procesados y pendientes', ['A', 'incierta', 'A'], `${EMITTED} ${verify(2)} ${THEN}`],
    ['sin confirmar, con procesados y sin pendientes', ['A', 'incierta'], `${EMITTED} ${verify(2)}`],
    ['sin confirmar, sin procesados y con pendientes', ['incierta', 'A'], `${verify(1)} ${THEN}`],
    ['sin confirmar el único', ['incierta'], verify(1)],
  ];

  it.each(SUGGESTIONS)('sugerencia del JSON, %s', async (_name, steps, suggestion) => {
    expect((await jsonError(steps)).sugerencia).toBe(suggestion);
  });

  it.each(SUGGESTIONS)('sugerencia del panel, %s', async (_name, steps, suggestion) => {
    await runBatch(steps);

    // Entera: lo que sigue al título de la sugerencia hasta el borde de abajo.
    expect(plain(stderr).match(/Sugerencia (.*?) ?[╰└╚]/)?.[1]).toBe(suggestion);
  });

  const PENDING: ReadonlyArray<[string, Step[], string[]]> = [
    ['uno', ['A', 'login'], [failed(2, 'LoginFault'), 'Procesados: 1 de 2.', 'Sin procesar: #2.']],
    ['dos', ['A', 'login', 'A'], [failed(2, 'LoginFault'), 'Procesados: 1 de 3.', 'Sin procesar: #2, #3.']],
    [
      'tres, el rango y la cantidad',
      ['A', 'login', 'A', 'A'],
      [failed(2, 'LoginFault'), 'Procesados: 1 de 4.', 'Sin procesar: #2 a #4 (3).'],
    ],
    [
      'ninguno procesado',
      ['login', 'A', 'A'],
      [failed(1, 'LoginFault'), 'Procesados: 0 de 3.', 'Sin procesar: #1 a #3 (3).'],
    ],
    [
      'noventa y ocho, con uno sin confirmar',
      ['A', 'incierta', ...many(98)],
      [failed(2, UNCERTAIN), 'Procesados: 1 de 100.', 'Sin procesar: #3 a #100 (98).', unconfirmed(2)],
    ],
  ];

  it.each(PENDING)('sin procesar, %s: en su línea del error', async (_name, steps, lines) => {
    expect((await jsonError(steps)).error).toBe(lines.join('\n'));
  });

  it.each(PENDING)('sin procesar, %s: en su línea del panel', async (_name, steps, [, , pending]) => {
    await runBatch(steps);

    const lines = stripAnsi(stderr)
      .split('\n')
      .map((line) => line.replace(/[│┃║╏]/g, '').trim());

    expect(lines).toContain(pending);
  });

  it('sin pendientes, el error no dice "Sin procesar"', async () => {
    expect((await jsonError(['A', 'incierta'])).error).toBe(
      [failed(2, UNCERTAIN), 'Procesados: 1 de 2.', unconfirmed(2)].join('\n'),
    );
  });

  it('detalles.sinProcesar sigue con la lista completa', async () => {
    const { detalles } = await jsonError(['A', 'incierta', ...many(98)]);

    expect((detalles as { sinProcesar: number[] }).sinProcesar).toEqual(
      Array.from({ length: 98 }, (_, index) => index + 3),
    );
  });

  const CAUSES: ReadonlyArray<[string, Step, Record<string, unknown>]> = [
    ['inesperada', 'login', { codigoCausa: 'UNEXPECTED_ERROR' }],
    ['transitoria', 'transitorio', { codigoCausa: 'TRANSIENT_ERROR' }],
    ['sin autorizar', 'sin-autorizar', { codigoCausa: 'WSFE_SERVICE_NOT_AUTHORIZED' }],
    ['sin confirmar', 'incierta', { codigoCausa: 'EMISSION_UNCERTAIN', sinConfirmar: 2, sinProcesar: [] }],
  ];

  it.each(CAUSES)('detalles.codigoCausa, %s', async (_name, step, expected) => {
    expect((await jsonError(['A', step])).detalles).toEqual({
      fallo: 2,
      procesados: 1,
      sinProcesar: [2],
      total: 2,
      ...expected,
    });
  });

  it('el panel no muestra codigoCausa', async () => {
    await runBatch(['A', 'transitorio']);

    expect(stderr).not.toMatch(/codigoCausa|TRANSIENT_ERROR/);
  });
});
