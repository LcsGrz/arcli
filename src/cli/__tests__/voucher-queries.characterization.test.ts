import { beforeEach, describe, expect, it, vi } from 'vitest';

import { stripAnsi } from '../../ui';
import { reportCliError } from '../error-output';
import { createProgram } from '../program';

import { answerAssociated, CLOCK_CONFIG, sdk, useClockFixture } from './clock.fixture';

/**
 * Caracterización de `ultimos` y `consultar` (REV-54): los errores de entrada y su orden, qué se le pide a ARCA y en
 * qué orden, el spinner y las salidas, por todas las familias. Entra por el CLI entero con el SDK falso, así no depende
 * de en qué módulo viven las reglas. La salida entera está en los dorados de `json-golden.test.ts`.
 */

const log = vi.hoisted(() => [] as string[]);

vi.mock('@arcasdk/core', async (original) =>
  (await import('./clock.fixture')).fakeArcaSdk(await original<Record<string, unknown>>()),
);
vi.mock('ora', () => ({
  default: ({ text }: { text: string }) => ({
    start: () => {
      log.push(`gira: ${text}`);

      return { stop: () => log.push('para') };
    },
  }),
}));

const profile = useClockFixture();

const FAMILIES: ReadonlyArray<readonly [shortcut: string, arcaType: number]> = [
  ['fa', 1],
  ['fb', 6],
  ['fc', 11],
  ['nca', 3],
  ['ncb', 8],
  ['ncc', 13],
  ['nda', 2],
  ['ndb', 7],
  ['ndc', 12],
  ['fcea', 201],
  ['fceb', 206],
  ['fcec', 211],
  ['ncea', 203],
  ['ndeb', 207],
  ['ncec', 213],
  ['ra', 4],
  ['rb', 9],
  ['rc', 15],
  ['fe', 19],
  ['nde', 20],
  ['nce', 21],
];
const isExport = (shortcut: string) => ['fe', 'nce', 'nde'].includes(shortcut);
/** Uno por servicio: wsfe y wsfex. */
const SERVICES = ['fc', 'fe'] as const;
const typeOf = (shortcut: string) => FAMILIES.find(([name]) => name === shortcut)?.[1] ?? 0;

const TYPES =
  'fa, fb, fc, nca, ncb, ncc, nda, ndb, ndc, fcea, fceb, fcec, ncea, nceb, ncec, ndea, ndeb, ndec, ra, rb, rc, fe, nde, nce';
const INVALID_TYPE = `El tipo "xx" no es válido. Usá un atajo: ${TYPES}.`;
const INVALID_QUANTITY = '`--cantidad` tiene que ser un número entre 1 y 50.';
const INVALID_POINT_OF_SALE = 'El punto de venta tiene que ser un número entero positivo.';
const MISSING_POINT_OF_SALE =
  'Falta el punto de venta. Usá `--pv <numero>` o configuralo con `arcli config establecer puntoVenta <numero>`.';
const invalidNumber = (raw: string) => `El número "${raw}" no es válido: tiene que ser un entero positivo.`;

const EXPORT_ROW = {
  Cae: '76463926585300',
  Cliente: 'ACME LLC',
  Domicilio_cliente: '123 Main St',
  Dst_cmp: 212,
  Fecha_cbte: '20261030',
  Imp_total: 1500,
  Moneda_Id: 'PES',
  Moneda_ctz: 1,
  Resultado: 'A',
  Tipo_expo: 2,
};
const NO_FEX_ERROR = { FEXErr: { ErrCode: 0, ErrMsg: 'OK' } };

/** Los números que ARCA no tiene, y los que tiene y no se pueden leer. Los demás están aprobados; el último es el 41. */
interface ArcaAnswers {
  readonly missing?: readonly number[];
  readonly unreadable?: readonly number[];
}

function answer({ missing = [], unreadable = [] }: ArcaAnswers = {}): void {
  answerAssociated();

  const consult = sdk.generic.call.getMockImplementation();

  sdk.generic.call.mockImplementation(
    async (service: string, method: string, params: { FeCompConsReq: Record<string, number> }) => {
      const { CbteNro, CbteTipo, PtoVta } = params.FeCompConsReq;

      log.push(`${service} ${method} ${CbteTipo} ${PtoVta}-${CbteNro}`);

      if (missing.includes(CbteNro)) {
        return { FECompConsultarResult: { Errors: { Err: [{ Code: 602, Msg: 'Sin Resultados' }] } } };
      }

      return unreadable.includes(CbteNro)
        ? {
            FECompConsultarResult: {
              ResultGet: { CbteDesde: CbteNro, CbteHasta: CbteNro, CodAutorizacion: '76463926585300' },
            },
          }
        : (consult?.(service, method, params) as unknown);
    },
  );
  sdk.wsfe.getLastVoucher.mockImplementation(async (pointOfSale: number, type: number) => {
    log.push(`wsfe último ${type} ${pointOfSale}`);

    return { cbteNro: 41 };
  });
  sdk.wsfex.getCmp.mockImplementation(async ({ Cmp }: { Cmp: Record<string, number> }) => {
    const { Cbte_nro: number, Cbte_tipo: type, Punto_vta: pointOfSale } = Cmp;

    log.push(`wsfex FEXGetCMP ${type} ${pointOfSale}-${number}`);

    if (missing.includes(number)) {
      return { FEXGetCMPResult: { FEXErr: { ErrCode: 1020, ErrMsg: 'No existe' } } };
    }

    return {
      FEXGetCMPResult: {
        ...NO_FEX_ERROR,
        FEXResultGet: {
          ...EXPORT_ROW,
          ...Cmp,
          ...(unreadable.includes(number) ? { Moneda_Id: '' } : {}),
        },
      },
    };
  });
  sdk.wsfex.getLastCmp.mockImplementation(async (input: unknown) => {
    const { Cbte_Tipo: type, Pto_venta: pointOfSale } = (input as { Auth: Record<string, number> }).Auth;

    log.push(`wsfex último ${type} ${pointOfSale}`);

    return { FEXGetLast_CMPResult: { ...NO_FEX_ERROR, FEXResult_LastCMP: { Cbte_nro: 41 } } };
  });
}

/** Las llamadas a ARCA, como quedan anotadas. */
const last = (shortcut: string, pointOfSale = 3) =>
  `${isExport(shortcut) ? 'wsfex' : 'wsfe'} último ${typeOf(shortcut)} ${pointOfSale}`;
const consulted = (shortcut: string, number: number, pointOfSale = 3) =>
  `${isExport(shortcut) ? 'wsfex FEXGetCMP' : 'wsfe FECompConsultar'} ${typeOf(shortcut)} ${pointOfSale}-${number}`;

interface Run {
  readonly code: number;
  /** El JSON de error de stderr. */
  readonly error?: Record<string, unknown>;
  readonly stderr: string;
  readonly stdout: string;
}

/** Corre el comando y termina como `index.ts`. */
async function run(args: readonly string[]): Promise<Run> {
  const json = args.includes('--json');
  const [stdoutStart, stderrStart] = [profile.stdout.length, profile.stderr.length];
  let code = 0;

  try {
    await createProgram().parseAsync(['node', 'arcli', ...args]);
  } catch (error) {
    code = reportCliError(error, json);
  }

  const stderr = stripAnsi(profile.stderr.slice(stderrStart));

  return {
    code,
    ...(json && code !== 0 ? { error: JSON.parse(stderr) as Record<string, unknown> } : {}),
    stderr,
    stdout: stripAnsi(profile.stdout.slice(stdoutStart)),
  };
}

const flat = (text: string) => text.replace(/[│┃║╏╎┊▎┌┐└┘\s]+/g, ' ').trim();

const configure = (extra: Record<string, unknown> = {}) =>
  profile.writeConfig(profile.configWith(profile.healthy, { ...CLOCK_CONFIG, ...extra }));

/** Con `--json`: el error y nada pedido a ARCA. */
async function expectRejected(args: readonly string[], message: string): Promise<void> {
  const result = await run([...args, '--json']);

  expect(result).toMatchObject({
    code: 1,
    error: { codigo: 'INPUT_VALIDATION_ERROR', error: message },
    stdout: '',
  });
  expect(log).toEqual([]);
}

beforeEach(() => {
  log.length = 0;
  configure();
  answer();
});

describe.each(FAMILIES)('%s', (shortcut, type) => {
  it('ultimos: el último número y, de ahí para atrás, los pedidos', async () => {
    const { code, stdout } = await run(['ultimos', shortcut, '--cantidad', '2', '--json']);

    expect(code).toBe(0);
    expect(log).toEqual([last(shortcut), consulted(shortcut, 41), consulted(shortcut, 40)]);
    expect(JSON.parse(stdout)).toMatchObject({
      atajo: shortcut,
      comprobantes: [{ numero: 41 }, { numero: 40 }],
      entorno: 'testing',
      puntoVenta: 3,
      tipoArca: type,
    });
  });

  it('consultar: solo el pedido', async () => {
    const { code, stdout } = await run(['consultar', shortcut, '12', '--json']);

    expect(code).toBe(0);
    expect(log).toEqual([consulted(shortcut, 12)]);
    expect(JSON.parse(stdout)).toMatchObject({
      atajo: shortcut,
      entorno: 'testing',
      numero: 12,
      puntoVenta: 3,
      tipoArca: type,
    });
  });

  it('ultimos: uno ilegible va en su lugar, con --json y en texto', async () => {
    answer({ unreadable: [40] });

    const notice = 'ARCLI no pudo leer los datos de 1 comprobante: 00003-00000040. Existe en ARCA: no lo repitas.';
    const json = await run(['ultimos', shortcut, '--cantidad', '3', '--json']);
    const text = await run(['ultimos', shortcut, '--cantidad', '3']);

    expect(json.code).toBe(0);
    expect((JSON.parse(json.stdout) as { comprobantes: unknown[] }).comprobantes).toEqual([
      expect.objectContaining({ numero: 41 }),
      { cae: '76463926585300', error: 'No se pudieron leer los datos que devolvió ARCA.', numero: 40 },
      expect.objectContaining({ numero: 39 }),
    ]);
    expect(flat(json.stderr)).toBe(notice);
    expect(text).toMatchObject({ code: 0, stderr: '' });
    expect(flat(text.stdout)).toContain('00003-00000040 No se pudieron leer sus datos CAE 76463926585300');
    expect(flat(text.stdout)).toContain(notice);
  });

  it('ultimos: uno que no existe no se lista ni se avisa', async () => {
    answer({ missing: [40] });

    const { code, stderr, stdout } = await run(['ultimos', shortcut, '--cantidad', '3', '--json']);
    const { comprobantes } = JSON.parse(stdout) as { comprobantes: Array<{ numero: number }> };

    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    expect(comprobantes.map(({ numero }) => numero)).toEqual([41, 39]);
  });

  it('consultar: uno ilegible es un error que dice que existe', async () => {
    answer({ unreadable: [40] });

    expect(await run(['consultar', shortcut, '40', '--json'])).toMatchObject({
      code: 1,
      error: {
        codigo: 'ARCA_VOUCHER_QUERY_ERROR',
        error: expect.stringContaining('00003-00000040 existe, con el CAE 76463926585300') as unknown,
      },
      stdout: '',
    });
  });
});

describe('consultar uno que no existe: VOUCHER_NOT_FOUND', () => {
  it.each([
    ['fa', 'la factura A'],
    ['fcea', 'la factura de crédito electrónica A'],
    ['nca', 'la nota de crédito A'],
    ['ndc', 'la nota de débito C'],
    ['rc', 'el recibo C'],
    ['fe', 'la factura de exportación E'],
    ['nce', 'la nota de crédito de exportación E'],
    ['nde', 'la nota de débito de exportación E'],
  ])('%s, con --json y en texto', async (shortcut, name) => {
    answer({ missing: [14] });

    const message = `No existe ${name} N° 00005-00000014 en ARCA (testing).`;
    const args = ['consultar', shortcut, '14', '--pv', '5'];
    const json = await run([...args, '--json']);
    const text = await run(args);

    expect(json).toMatchObject({ code: 1, stdout: '' });
    expect(json.error).toEqual({ codigo: 'VOUCHER_NOT_FOUND', detalles: null, error: message, sugerencia: null });
    expect(text).toMatchObject({ code: 1, stdout: '' });
    expect(flat(text.stderr)).toContain(message);
  });
});

describe('el tipo', () => {
  it.each([[['ultimos', 'xx']], [['consultar', 'xx', '1']]])('%j: el error con todos los atajos', async (args) => {
    await expectRejected(args, INVALID_TYPE);
  });

  it('se nombra como se escribió', async () => {
    await expectRejected(['ultimos', ' Xx '], INVALID_TYPE.replace('"xx"', '" Xx "'));
  });

  it.each([
    ['  FC ', 'fc'],
    ['Fe', 'fe'],
  ])('"%s" es %s', async (raw, shortcut) => {
    await run(['consultar', raw, '12', '--json']);

    expect(log).toEqual([consulted(shortcut, 12)]);
  });

  it('en texto, el error va a stderr', async () => {
    const result = await run(['ultimos', 'xx']);

    expect(result).toMatchObject({ code: 1, stdout: '' });
    expect(flat(result.stderr)).toContain('El tipo "xx" no es válido.');
  });
});

describe.each(SERVICES)('ultimos %s: la cantidad', (shortcut) => {
  it.each(['0', '51'])('--cantidad %s está fuera de rango', async (quantity) => {
    await expectRejected(['ultimos', shortcut, '--cantidad', quantity], INVALID_QUANTITY);
  });

  it.each(['1.5', '1,5', 'abc', '3a'])('--cantidad %s no es un entero', async (quantity) => {
    await expectRejected(
      ['ultimos', shortcut, '--cantidad', quantity],
      `\`--cantidad\` "${quantity}" no es válido: tiene que ser un número entero.`,
    );
  });

  it.each<[string, { readonly config?: object; readonly flags?: string[] }, number]>([
    ['1', { flags: ['--cantidad', '1'] }, 1],
    ['el tope, con menos emitidos', { flags: ['--cantidad', '50'] }, 41],
    ['sin --cantidad ni config', {}, 15],
    ['`filasPorLista`', { config: { filasPorLista: 4 } }, 4],
    ['la clave deprecada', { config: { comprobantesPorLista: 6 } }, 6],
    ['`filasPorLista` sobre la deprecada', { config: { comprobantesPorLista: 6, filasPorLista: 4 } }, 4],
    ['--cantidad sobre `filasPorLista`', { config: { filasPorLista: 4 }, flags: ['--cantidad', '3'] }, 3],
  ])('%s', async (_name, { config, flags = [] }, expected) => {
    configure({ ...config });

    const { stdout } = await run(['ultimos', shortcut, ...flags, '--json']);

    expect((JSON.parse(stdout) as { comprobantes: unknown[] }).comprobantes).toHaveLength(expected);
    // El último número y uno por comprobante: ni una consulta de más.
    expect(log).toHaveLength(expected + 1);
  });

  it('en texto se consulta lo mismo que con --json', async () => {
    await run(['ultimos', shortcut, '--cantidad', '5', '--json']);

    const json = log.splice(0);

    await run(['ultimos', shortcut, '--cantidad', '5']);

    expect(json).toHaveLength(6);
    expect(log).toEqual(json);
  });
});

describe.each(SERVICES)('consultar %s: el número', (shortcut) => {
  it.each(['0', '00', '1.5', '1e3', '0x10', '3a', 'abc', ''])('"%s" no es válido', async (raw) => {
    await expectRejected(['consultar', shortcut, raw], invalidNumber(raw));
  });

  it('con ceros adelante y espacios se lee igual', async () => {
    await run(['consultar', shortcut, ' 00000012 ', '--json']);

    expect(log).toEqual([consulted(shortcut, 12)]);
  });
});

const QUERIES = SERVICES.flatMap((shortcut) => [
  { args: ['ultimos', shortcut], first: last, name: `ultimos ${shortcut}`, shortcut },
  {
    args: ['consultar', shortcut, '12'],
    first: (kind: string, pointOfSale?: number) => consulted(kind, 12, pointOfSale),
    name: `consultar ${shortcut}`,
    shortcut,
  },
]);

describe.each(QUERIES)('$name: el punto de venta', ({ args, first, shortcut }) => {
  it('falta', async () => {
    configure({ puntoVentaPorDefecto: undefined });

    await expectRejected(args, MISSING_POINT_OF_SALE);
  });

  it.each(['--pv', '--punto-venta'])('%s 0', async (flag) => {
    await expectRejected([...args, flag, '0'], INVALID_POINT_OF_SALE);
  });

  it.each(['--pv', '--punto-venta'])('%s 3a', async (flag) => {
    await expectRejected([...args, flag, '3a'], `\`${flag}\` "3a" no es válido: tiene que ser un número entero.`);
  });

  it.each<[string, string[], number]>([
    ['el de la config', [], 3],
    ['--pv sobre la config', ['--pv', '5'], 5],
    ['--punto-venta sobre la config', ['--punto-venta', '7'], 7],
    ['--pv sobre --punto-venta', ['--punto-venta', '7', '--pv', '5'], 5],
  ])('%s', async (_name, flags, expected) => {
    const { stdout } = await run([...args, ...flags, '--json']);

    expect(log[0]).toBe(first(shortcut, expected));
    expect(JSON.parse(stdout)).toMatchObject({ puntoVenta: expected });
  });
});

describe('el orden de los errores', () => {
  /** Sin certificado configurado. */
  const NO_PROFILE = { cert: {}, key: {} };

  it('el tipo, antes que la cantidad, el número y el perfil', async () => {
    configure(NO_PROFILE);

    await expectRejected(['ultimos', 'xx', '--cantidad', '0', '--pv', '0'], INVALID_TYPE);
    await expectRejected(['consultar', 'xx', '0', '--pv', '0'], INVALID_TYPE);
  });

  it.each(SERVICES)('%s: la cantidad y el número, antes que el perfil y el punto de venta', async (shortcut) => {
    configure(NO_PROFILE);

    await expectRejected(['ultimos', shortcut, '--cantidad', '0', '--pv', '0'], INVALID_QUANTITY);
    await expectRejected(['consultar', shortcut, '0', '--pv', '0'], invalidNumber('0'));
  });

  it.each(QUERIES)('$name: el perfil, antes que el punto de venta', async ({ args }) => {
    configure({ ...NO_PROFILE, puntoVentaPorDefecto: undefined });

    const { error } = await run([...args, '--json']);

    expect(error).toMatchObject({ codigo: 'CONFIGURATION_ERROR' });
    expect((await run([...args, '--pv', '0', '--json'])).error).toEqual(error);
    expect(log).toEqual([]);
  });

  it.each(QUERIES)('$name: el certificado vencido, antes que el punto de venta', async ({ args }) => {
    profile.moveClockAfterExpiry(profile.healthy, 1);

    expect((await run([...args, '--pv', '0', '--json'])).error).toMatchObject({ codigo: 'CERTIFICATE_EXPIRED' });
    expect(log).toEqual([]);
  });
});

describe('spinner y salidas en una terminal', () => {
  const SPIN = 'gira: Consultando ARCA...';

  /** Corre en una terminal y anota las salidas en la misma secuencia; lo que se escribe seguido es una sola. */
  async function runInTerminal(args: readonly string[]): Promise<Run> {
    const original = [process.stdout.isTTY, process.stdout.columns] as const;

    for (const name of ['stdout', 'stderr'] as const) {
      const write = vi.mocked(process[name].write);
      const capture = write.getMockImplementation();

      write.mockImplementation((...values) => {
        if (log.at(-1) !== name) {
          log.push(name);
        }

        return capture?.(...values) ?? true;
      });
    }

    [process.stdout.isTTY, process.stdout.columns] = [true, 100];

    try {
      return await run(args);
    } finally {
      [process.stdout.isTTY, process.stdout.columns] = original;
    }
  }

  it.each(SERVICES)('ultimos %s: gira mientras consulta y para antes de la salida', async (shortcut) => {
    await runInTerminal(['ultimos', shortcut, '--cantidad', '1']);

    expect(log).toEqual([SPIN, last(shortcut), consulted(shortcut, 41), 'para', 'stdout']);
  });

  it.each(SERVICES)('consultar %s: gira mientras consulta y para antes de la salida', async (shortcut) => {
    await runInTerminal(['consultar', shortcut, '12']);

    expect(log).toEqual([SPIN, consulted(shortcut, 12), 'para', 'stdout']);
  });

  it.each(SERVICES)('consultar %s, inexistente: para antes del error', async (shortcut) => {
    answer({ missing: [12] });
    await runInTerminal(['consultar', shortcut, '12']);

    expect(log).toEqual([SPIN, consulted(shortcut, 12), 'para', 'stderr']);
  });

  it.each(SERVICES)('ultimos %s, si falla la consulta: para antes del error', async (shortcut) => {
    sdk.wsfe.getLastVoucher.mockRejectedValue(new Error('socket hang up'));
    sdk.wsfex.getLastCmp.mockRejectedValue(new Error('socket hang up'));

    expect((await runInTerminal(['ultimos', shortcut])).code).toBe(1);
    expect(log).toEqual([SPIN, 'para', 'stderr']);
  });

  it.each(SERVICES)('ultimos %s --json: sin spinner; el aviso del ilegible va después del JSON', async (shortcut) => {
    answer({ unreadable: [41] });
    await runInTerminal(['ultimos', shortcut, '--cantidad', '1', '--json']);

    expect(log).toEqual([last(shortcut), consulted(shortcut, 41), 'stdout', 'stderr']);
  });

  it.each(QUERIES)('$name con un error de entrada: no gira', async ({ args }) => {
    await runInTerminal([...args, '--pv', '0']);

    expect(log).toEqual(['stderr']);
  });

  it.each(QUERIES)('$name: el certificado por vencer se avisa antes de consultar', async ({ args }) => {
    profile.writeConfig(profile.configWith(profile.expiring, CLOCK_CONFIG));
    await runInTerminal(args);

    expect(log.slice(0, 2)).toEqual(['stderr', SPIN]);
  });
});

describe('a ARCA se le pide de a cuatro', () => {
  it.each(SERVICES)('ultimos %s', async (shortcut) => {
    const mock = isExport(shortcut) ? sdk.wsfex.getCmp : sdk.generic.call;
    const call = mock.getMockImplementation();
    let active = 0;
    let most = 0;

    mock.mockImplementation(async (...args: unknown[]) => {
      active += 1;
      most = Math.max(most, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;

      return call?.(...args) as unknown;
    });
    await run(['ultimos', shortcut, '--cantidad', '9', '--json']);

    expect(most).toBe(4);
    expect(mock).toHaveBeenCalledTimes(9);
  });
});
