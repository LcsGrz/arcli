import Conf from 'conf';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stripAnsi } from '../../ui';
import { reportCliError } from '../error-output';
import { createProgram } from '../program';

/** ERR-21 y ERR-22, por el comando real con una config temporal. Nada va a la red. */

/** Root puede con todo y Windows no tiene estos permisos. */
const withPermissions = process.platform !== 'win32' && process.getuid?.() !== 0;
const CUIT = '20168598204';

let directory = '';

interface RunResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

type CliError = Record<string, unknown> & { readonly sugerencia: string };

async function run(...args: string[]): Promise<RunResult> {
  let stderr = '';
  let stdout = '';
  let exitCode = 0;
  const spies = [
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);

      return true;
    }),
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);

      return true;
    }),
  ];

  try {
    await createProgram().parseAsync(['node', 'arcli', ...args]);
  } catch (error) {
    exitCode = reportCliError(error, true);
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }

  const clean = (text: string) => stripAnsi(text).replace(/[│┃║╏\s]+/g, ' ');

  return { exitCode, stderr: clean(stderr), stdout: clean(stdout) };
}

async function runJson(...args: string[]): Promise<Record<string, unknown>> {
  const result = await run(...args, '--json');

  expect(result.exitCode, result.stderr).toBe(0);

  return JSON.parse(result.stdout) as Record<string, unknown>;
}

async function runError(...args: string[]): Promise<CliError> {
  const result = await run(...args);

  expect(result.exitCode).toBe(1);

  return JSON.parse(result.stderr) as CliError;
}

const configPath = () => join(directory, 'config.json');
const save = (config: unknown) => writeFileSync(configPath(), JSON.stringify(config));
const stored = () => JSON.parse(readFileSync(configPath(), 'utf8')) as unknown;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-reparar-'));
  vi.stubEnv('ARCLI_CONFIG_DIR', directory);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  rmSync(directory, { force: true, recursive: true });
});

describe('varias claves rotas en la config guardada (ERR-22)', () => {
  // Con una clave que ARCLI no conoce y un valor sin normalizar: nada de eso se toca.
  const BROKEN = {
    cuit: '123',
    entornoPorDefecto: 'x',
    monedaPorDefecto: 'dol',
    nota: { propia: 1 },
    puntoVentaPorDefecto: 'a',
  };

  it.each([
    [['establecer', 'alicuota', '21'], { ...BROKEN, alicuotaPorDefecto: '21' }],
    [['establecer', 'cuit', CUIT], { ...BROKEN, cuit: CUIT }],
    [['establecer', 'emitir', 'true'], { ...BROKEN, output: { emitirPorDefecto: true } }],
    [['eliminar', 'moneda'], { ...BROKEN, monedaPorDefecto: undefined }],
  ])('%j guarda solo esa clave y avisa cuáles quedan', async (args, expected) => {
    save(BROKEN);

    const result = await run('config', ...args);

    expect(result.exitCode).toBe(0);
    expect(stored()).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(result.stdout).toContain('CONFIGURACIÓN');
    expect(result.stdout).toContain('Entorno dato inválido');
    expect(result.stderr).toContain('arcli config establecer entorno <valor>');
    expect(result.stderr).toContain('arcli config eliminar puntoVenta');
    expect(result.stderr).not.toContain('PorDefecto');
  });

  it('con --json, la config sin las claves rotas y los avisos', async () => {
    save({ ...BROKEN, emisor: { logo: '', razonSocial: 'Ana' }, output: 3 });

    const json = await runJson('config', 'establecer', 'alicuota', '21');

    for (const key of ['cuit', 'entorno', 'puntoVenta', 'emitir', 'json', 'bruto']) {
      expect(json).not.toHaveProperty(key);
    }

    expect(json).toMatchObject({ alicuota: '21', emisor: { razonSocial: 'Ana' }, moneda: 'DOL', pdf: 'preguntar' });
    expect(json.emisor).not.toHaveProperty('logo');
    expect(json.avisos).toEqual([
      expect.stringContaining('`cuit`: el CUIT debe tener 11 dígitos. Corregilo con `arcli config establecer cuit'),
      expect.stringContaining('`emisor.logo`'),
      expect.stringContaining('`entorno`'),
      expect.stringContaining('`emitir`, `json`, `bruto`'),
      expect.stringContaining('`puntoVenta`'),
    ]);
  });

  it('si `json` es la clave rota, manda el flag; si está sana, vale', async () => {
    save({ cuit: '123', output: { jsonPorDefecto: 'x' } });
    expect((await run('config', 'establecer', 'alicuota', '21')).stdout).toContain('CONFIGURACIÓN');
    expect(await runJson('config', 'establecer', 'alicuota', '21')).toHaveProperty('avisos');

    save({ cuit: '123', output: { emitirPorDefecto: 'x', jsonPorDefecto: true } });

    const result = await run('config', 'establecer', 'alicuota', '21');

    expect(JSON.parse(result.stdout)).toMatchObject({ json: true });
    expect(result.stderr).toBe('');
  });

  it('de a una hasta dejarla sana, que sale como siempre', async () => {
    save({ cbu: '0110599520000012345677', cuit: '123' });

    const first = await runError('config');

    // El error del CBU es el de siempre; la sugerencia alcanza para las dos.
    expect(first.error).toMatch(/^El CBU guardado en la config no es válido/);
    expect(first.sugerencia).toContain('`arcli config establecer cuit <valor>` o `arcli config eliminar cuit`');
    expect(first.sugerencia).toContain(
      '`arcli config establecer cuenta <CBU> [ALIAS]` (sin el alias, se borra el guardado) o `arcli config eliminar cuenta`',
    );
    expect(first.sugerencia).not.toContain(configPath());

    expect((await runJson('config', 'eliminar', 'cbu')).avisos).toHaveLength(1);

    const json = await runJson('config', 'establecer', 'cuit', CUIT);

    expect(json).toMatchObject({ cuit: CUIT, entorno: 'testing', moneda: 'PES' });
    expect(json).not.toHaveProperty('avisos');
    expect(json).toEqual(await runJson('config'));
    expect(stored()).toMatchObject({ cuit: CUIT, entornoPorDefecto: 'testing', output: { jsonPorDefecto: false } });
  });

  it('los demás comandos siguen frenando y no tocan el archivo', async () => {
    save(BROKEN);

    for (const args of [['config'], ['config', 'revisar'], ['estado'], ['certificado', 'generar']]) {
      const error = await runError(...args);

      expect(error).toMatchObject({
        codigo: 'INPUT_VALIDATION_ERROR',
        detalles: [{ ruta: ['cuit'] }, { ruta: ['entornoPorDefecto'] }, { ruta: ['puntoVentaPorDefecto'] }],
      });
      expect(error.sugerencia).toBe(
        'Corregilos de a uno: `arcli config establecer cuit <valor>` o `arcli config eliminar cuit`; `arcli config establecer entorno <valor>` o `arcli config eliminar entorno`; `arcli config establecer puntoVenta <valor>` o `arcli config eliminar puntoVenta`.',
      );
      expect(stored()).toEqual(BROKEN);
    }
  });

  it('un valor inválido recién pasado se rechaza y no escribe', async () => {
    const config = {
      cert: {},
      cotizacionPorDefecto: -1,
      cuit: '123',
      emisor: {},
      entornoPorDefecto: 'x',
      key: {},
      monedaPorDefecto: 'PES',
      output: {},
    };

    for (const [key, value] of [
      ['cuit', '1'],
      ['cotizacion', '0'],
    ]) {
      save(config);
      expect((await runError('config', 'establecer', key, value)).codigo).toBe('INPUT_VALIDATION_ERROR');
      expect(stored()).toEqual(config);
    }
  });

  it.each([
    [{ output: 3 }, ['establecer', 'json', 'false'], { jsonPorDefecto: false }, 'output'],
    [{ output: [] }, ['establecer', 'json', 'false'], { jsonPorDefecto: false }, 'output'],
    [{ emisor: 'x' }, ['establecer', 'emisor.razonSocial', 'Ana'], { razonSocial: 'Ana' }, 'emisor'],
  ])('un grupo entero roto, %j', async (group, args, expected, key) => {
    save({ cuit: '123', ...group });
    expect((await runJson('config', ...args)).avisos).toHaveLength(1);
    expect(stored()).toEqual({ cuit: '123', [key]: expected });
  });

  it('eliminar una clave de un grupo roto no lo arregla: se rechaza', async () => {
    save({ emisor: 'x' });

    const error = await runError('config', 'eliminar', 'emisor.logo');

    expect(error.sugerencia).toContain('arcli config establecer emisor.condicionIva <valor>');
  });

  it('la clave deprecada rota no se muestra y se arregla con su reemplazo', async () => {
    save({ comprobantesPorLista: 0, cuit: '123', filasPorLista: 20 });

    const json = await runJson('config', 'establecer', 'alicuota', '21');

    expect(json).toMatchObject({ filasPorLista: 20 });
    expect(json).not.toHaveProperty('comprobantesPorLista');
    expect(json).not.toHaveProperty('deprecado');
    expect((await runJson('config', 'establecer', 'filasPorLista', '9')).avisos).toHaveLength(1);
    expect(stored()).toEqual({ alicuotaPorDefecto: '21', cuit: '123', filasPorLista: 9 });
  });

  it('con `filasPorLista` rota, `deprecado` no manda a una clave que no sale', async () => {
    save({ comprobantesPorLista: 8, filasPorLista: 0 });

    const json = await runJson('config', 'establecer', 'alicuota', '21');

    expect(json).toMatchObject({ comprobantesPorLista: 8 });
    expect(json).not.toHaveProperty('filasPorLista');
    expect(json).not.toHaveProperty('deprecado');
  });

  it('sin disco al completar los valores por defecto, el error nombra config.json', async () => {
    save({ cuit: CUIT });
    vi.spyOn(Conf.prototype, 'store', 'set').mockImplementation(() => {
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC', syscall: 'write' });
    });

    expect((await runError('config')).error).toMatch(
      /^No se pudo escribir .*config\.json: no queda espacio en el disco\.$/,
    );
  });

  it.each([[[]], [null]])('%j guardado se toma como vacío', async (config) => {
    save(config);
    expect(await runJson('config', 'establecer', 'cuit', CUIT)).toMatchObject({ cuit: CUIT, entorno: 'testing' });
  });

  it('con la config sana no hay avisos', async () => {
    save({ cuit: CUIT });
    expect(await runJson('config', 'establecer', 'alicuota', '21')).not.toHaveProperty('avisos');
    expect((await run('config', 'establecer', 'alicuota', '21')).stderr).toBe('');
  });
});

describe('certificado generar con el pedido pendiente ilegible (ERR-21)', () => {
  const folder = () => join(directory, 'certificados', CUIT);
  const key = () => join(folder(), 'testing.nueva.key');
  const request = () => join(folder(), 'testing.nueva.csr');
  const mode = (path: string) => statSync(path).mode & 0o777;

  beforeEach(() => {
    save({ cuit: CUIT });
    mkdirSync(folder(), { recursive: true });
    writeFileSync(key(), 'CLAVE');
    writeFileSync(request(), 'CSR');
  });

  async function expectUntouched(path: () => string): Promise<void> {
    chmodSync(path(), 0o000);

    let error: CliError;
    let modeAfter: number;

    try {
      error = await runError('certificado', 'generar');
      modeAfter = mode(path());
    } finally {
      chmodSync(path(), 0o700);
    }

    expect(error).toMatchObject({
      codigo: 'UNEXPECTED_ERROR',
      error: expect.stringMatching(/^No se pudo abrir .*testing\.nueva\.key: no tenés permiso\.$/),
    });
    expect(error.sugerencia).toContain('permiso');
    expect(modeAfter).toBe(0);
    expect(readFileSync(key(), 'utf8')).toBe('CLAVE');
    expect(readFileSync(request(), 'utf8')).toBe('CSR');
  }

  it.runIf(withPermissions)('con la carpeta del CUIT sin permiso', () => expectUntouched(folder));

  it.runIf(withPermissions)('con la carpeta de certificados sin permiso', () =>
    expectUntouched(() => join(directory, 'certificados')),
  );

  it.runIf(withPermissions)('con la clave sin permiso', () => expectUntouched(key));

  it.runIf(withPermissions)(
    'con --reemplazar también frena si no puede leer la clave o entrar a certificados',
    async () => {
      for (const path of [key(), join(directory, 'certificados')]) {
        chmodSync(path, 0o000);

        const error = await runError('certificado', 'generar', '--reemplazar');

        chmodSync(path, 0o700);
        expect(error.codigo).toBe('UNEXPECTED_ERROR');
        expect(readFileSync(key(), 'utf8')).toBe('CLAVE');
      }
    },
  );

  // ARQ-27: el permiso que la persona le sacó a la carpeta no se repone; frena con el error de permiso de siempre.
  it.runIf(withPermissions)('con --reemplazar y la carpeta del CUIT sin permiso, frena sin reponerlo', async () => {
    chmodSync(folder(), 0o000);

    let error: CliError;
    let modeAfter: number;

    try {
      error = await runError('certificado', 'generar', '--reemplazar');
      modeAfter = mode(folder());
    } finally {
      chmodSync(folder(), 0o700);
    }

    expect(error).toMatchObject({
      codigo: 'UNEXPECTED_ERROR',
      error: expect.stringMatching(/^No se pudo abrir .*testing\.nueva\.key: no tenés permiso\.$/),
    });
    expect(modeAfter).toBe(0);
    expect(readFileSync(key(), 'utf8')).toBe('CLAVE');
  });

  it.runIf(withPermissions)(
    'con la carpeta del CUIT de solo lectura, no le da escritura para crear el pedido',
    async () => {
      rmSync(key());
      rmSync(request());
      chmodSync(folder(), 0o500);

      let error: CliError;
      let modeAfter: number;

      try {
        error = await runError('certificado', 'generar');
        modeAfter = mode(folder());
      } finally {
        chmodSync(folder(), 0o700);
      }

      expect(error).toMatchObject({
        codigo: 'UNEXPECTED_ERROR',
        error: expect.stringMatching(/testing\.nueva\.key: no tenés permiso\.$/),
      });
      expect(modeAfter).toBe(0o500);
      expect(readdirSync(folder())).toEqual([]);
    },
  );

  it('con un pedido legible, CERTIFICATE_REQUEST_PENDING; sin pedido, lo arma', async () => {
    expect((await runError('certificado', 'generar')).codigo).toBe('CERTIFICATE_REQUEST_PENDING');

    rmSync(folder(), { recursive: true });
    expect((await run('certificado', 'generar')).exitCode).toBe(0);
  });
});
