import Conf from 'conf';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stripAnsi } from '../../../ui';
import { reportCliError } from '../../error-output';
import { createProgram } from '../../program';

/** `config establecer cuenta <CBU> [ALIAS]` y las claves deprecadas `cbu` y `aliasCbu`, hasta el archivo. */

const CBU = '0110599520000012345678';
const OTHER_CBU = '0170099220000067797370';
const ALIAS = 'mi.alias.cbu';
const OTHER_ALIAS = 'otro.alias';
const ACCOUNT = { aliasCbu: ALIAS, cbu: CBU };
const REMOVED =
  'Se borró el alias mi.alias.cbu de la config: la cuenta quedó sin alias. Si lo tiene, guardá los dos con `arcli config establecer cuenta <CBU> <ALIAS>`.';

let directory = '';
let stdout = '';
let stderr = '';

const path = () => join(directory, 'config.json');
const save = (config: object) => writeFileSync(path(), JSON.stringify(config));
const stored = () => JSON.parse(readFileSync(path(), 'utf8')) as Record<string, unknown>;
const saved = () => {
  const { aliasCbu, cbu } = stored();

  return { aliasCbu, cbu };
};
const run = (...args: string[]) => createProgram().parseAsync(['node', 'arcli', 'config', ...args]);
const flat = (text: string) => stripAnsi(text).replace(/[\s│┃╏|]+/g, ' ');
const json = () => JSON.parse(stdout) as Record<string, unknown>;

async function runError(...args: string[]): Promise<Record<string, unknown>> {
  try {
    await run(...args);
  } catch (error) {
    stderr = '';
    reportCliError(error, true);

    return JSON.parse(stderr) as Record<string, unknown>;
  }

  throw new Error('No falló.');
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-config-cuenta-'));
  vi.stubEnv('ARCLI_CONFIG_DIR', directory);
  stdout = '';
  stderr = '';
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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  rmSync(directory, { force: true, recursive: true });
});

describe('config establecer cuenta', () => {
  it('guarda el CBU y el alias, sin avisos ni deprecado', async () => {
    save({ aliasCbu: OTHER_ALIAS, cbu: OTHER_CBU });

    await run('establecer', ' cuenta ', ` ${CBU} `, ` ${ALIAS} `, '--json');

    expect(saved()).toEqual(ACCOUNT);
    expect(json()).toMatchObject(ACCOUNT);
    expect(json()).not.toHaveProperty('avisos');
    expect(json()).not.toHaveProperty('cuenta');
    expect(stderr).toBe('');
  });

  it('los guarda en una sola escritura: si falla, no queda ninguno', async () => {
    // Completa, para que la única escritura sea la del cambio.
    await run('establecer', 'cuenta', OTHER_CBU, OTHER_ALIAS);

    const write = vi.spyOn(Conf.prototype, 'store', 'set').mockImplementation(() => {
      throw new Error('disco lleno');
    });

    await expect(run('establecer', 'cuenta', CBU, ALIAS)).rejects.toThrow('disco lleno');
    expect(write).toHaveBeenCalledTimes(1);
    expect(saved()).toEqual({ aliasCbu: OTHER_ALIAS, cbu: OTHER_CBU });
  });

  it.each([
    ['CBU inválido', ['123', ALIAS], /22 dígitos/],
    ['alias inválido', [OTHER_CBU, 'abc'], /entre 6 y 20/],
    ['alias vacío', [OTHER_CBU, ''], /entre 6 y 20/],
  ])('%s: error de entrada y no guarda nada', async (_name, args, message) => {
    save(ACCOUNT);

    const error = await runError('establecer', 'cuenta', ...args);

    expect(error).toMatchObject({ codigo: 'INPUT_VALIDATION_ERROR', error: expect.stringMatching(message) });
    expect(error.sugerencia).toContain('arcli config establecer --ayuda');
    expect(saved()).toEqual(ACCOUNT);
  });

  it.each([
    ['otro CBU', ACCOUNT],
    ['el mismo CBU', { aliasCbu: ALIAS, cbu: OTHER_CBU }],
    ['sin CBU guardado', { aliasCbu: ALIAS }],
  ])('sin alias, con %s, borra el guardado y lo dice en `avisos`', async (_name, config) => {
    save(config);

    await run('establecer', 'cuenta', OTHER_CBU, '--json');

    expect(json().avisos).toEqual([REMOVED]);
    expect(json()).not.toHaveProperty('aliasCbu');
    expect(saved()).toEqual({ aliasCbu: undefined, cbu: OTHER_CBU });
    expect(stderr).toBe('');
  });

  it('sin --json, el aviso sale en stderr', async () => {
    save(ACCOUNT);

    await run('establecer', 'cuenta', OTHER_CBU);

    expect(flat(stderr)).toContain(REMOVED);
    expect(flat(stdout)).not.toContain('Se borró');
  });

  it('sin alias y sin uno guardado no avisa', async () => {
    save({ cbu: CBU });

    await run('establecer', 'cuenta', OTHER_CBU, '--json');

    expect(json()).not.toHaveProperty('avisos');
    expect(saved()).toEqual({ aliasCbu: undefined, cbu: OTHER_CBU });
  });

  it('un alias guardado que ni siquiera es un texto también se borra', async () => {
    save({ aliasCbu: 5, cbu: CBU });

    await run('establecer', 'cuenta', CBU, '--json');

    expect(json().avisos).toEqual([expect.stringMatching(/^Se borró el alias de la config/)]);
    expect(saved()).toEqual({ aliasCbu: undefined, cbu: CBU });
  });

  it('arregla un CBU y un alias guardados inválidos', async () => {
    save({ aliasCbu: '!', cbu: '123' });

    await run('establecer', 'cuenta', CBU, ALIAS, '--json');

    expect(json()).not.toHaveProperty('avisos');
    expect(saved()).toEqual(ACCOUNT);
  });

  it('con otras claves rotas guarda igual solo la cuenta', async () => {
    save({ ...ACCOUNT, cuit: '123' });

    await run('establecer', 'cuenta', OTHER_CBU, '--json');

    expect(json().avisos).toEqual([REMOVED, expect.stringContaining('Sigue habiendo un dato inválido')]);
    expect(stored()).toEqual({ cbu: OTHER_CBU, cuit: '123' });
  });

  it.each([
    [['cuit', '20123456786', 'x'], 'espera 2 y recibió 3 (cuit, 20123456786, x)'],
    [['cbu', CBU, ALIAS], `espera 2 y recibió 3 (cbu, ${CBU}, ${ALIAS})`],
    [['cuit', '20123456786', 'x', 'y'], 'espera 2 y recibió 4 (cuit, 20123456786, x, y)'],
    [['noExiste', '1', '2'], 'espera 2 y recibió 3 (noExiste, 1, 2)'],
    [['cuenta', CBU, ALIAS, 'x'], `espera 3 y recibió 4 (cuenta, ${CBU}, ${ALIAS}, x)`],
  ])('%j: sobran argumentos', async (args, message) => {
    save(ACCOUNT);

    expect(await runError('establecer', ...args)).toMatchObject({
      codigo: 'INPUT_VALIDATION_ERROR',
      error: `sobran argumentos: ${message}.`,
    });
    expect(saved()).toEqual(ACCOUNT);
  });

  it('sin CBU falta el argumento', async () => {
    expect(await runError('establecer', 'cuenta')).toMatchObject({
      codigo: 'INPUT_VALIDATION_ERROR',
      error: 'falta el argumento obligatorio `valor`',
    });
  });
});

describe('config eliminar', () => {
  it('cuenta borra los dos, sin avisos', async () => {
    save(ACCOUNT);

    await run('eliminar', 'cuenta', '--json');

    expect(json()).not.toHaveProperty('avisos');
    expect(saved()).toEqual({ aliasCbu: undefined, cbu: undefined });
    expect(stderr).toBe('');
  });

  it('cbu borra también el alias, lo avisa y está deprecada', async () => {
    save(ACCOUNT);

    await run('eliminar', 'cbu', '--json');

    expect(json().avisos).toEqual(['Se borró también el alias mi.alias.cbu de la config: sin el CBU no se usa.']);
    expect(saved()).toEqual({ aliasCbu: undefined, cbu: undefined });
    expect(stripAnsi(stderr).trim()).toBe(
      'La clave "cbu" está deprecada y se va a sacar en la 3.0.0: usá `arcli config eliminar cuenta`.',
    );
  });

  it('cbu sin alias guardado no avisa de un alias', async () => {
    save({ cbu: CBU });

    await run('eliminar', 'cbu', '--json');

    expect(json()).not.toHaveProperty('avisos');
  });

  it('aliasCbu borra solo el alias y está deprecada', async () => {
    save(ACCOUNT);

    await run('eliminar', 'aliasCbu', '--json');

    expect(json()).not.toHaveProperty('avisos');
    expect(saved()).toEqual({ aliasCbu: undefined, cbu: CBU });
    expect(stripAnsi(stderr).trim()).toBe(
      'La clave "aliasCbu" está deprecada y se va a sacar en la 3.0.0: usá `arcli config establecer cuenta <CBU>`, que deja la cuenta sin alias.',
    );
  });

  it('con otras claves rotas borra igual solo la cuenta', async () => {
    save({ ...ACCOUNT, cuit: '123' });

    await run('eliminar', 'cuenta', '--json');

    expect(json().avisos).toEqual([expect.stringContaining('Sigue habiendo un dato inválido')]);
    expect(stored()).toEqual({ cuit: '123' });
  });
});

describe('las claves deprecadas cbu y aliasCbu', () => {
  it.each([
    ['cbu', OTHER_CBU, { aliasCbu: undefined, cbu: OTHER_CBU }],
    ['aliasCbu', OTHER_ALIAS, { aliasCbu: OTHER_ALIAS, cbu: CBU }],
  ])('establecer %s guarda como antes y muestra el comando nuevo', async (key, value, expected) => {
    save(ACCOUNT);

    await run('establecer', key, value, '--json');

    expect(saved()).toEqual(expected);
    expect(stripAnsi(stderr).trim()).toBe(
      `La clave "${key}" está deprecada y se va a sacar en la 3.0.0: usá \`arcli config establecer cuenta <CBU> [ALIAS]\`.`,
    );
  });

  it('leerlas no avisa', async () => {
    save(ACCOUNT);

    await run('--json');

    expect(json()).toMatchObject(ACCOUNT);
    expect(json()).not.toHaveProperty('deprecado');
    expect(stderr).toBe('');
  });
});

describe('arcli config con la cuenta', () => {
  it.each([
    [ACCOUNT, `${CBU} (${ALIAS})`],
    [{ cbu: CBU }, CBU],
    [{ aliasCbu: ALIAS }, `sin CBU (${ALIAS})`],
    [{}, 'sin configurar'],
  ])('%j', async (config, text) => {
    save(config);

    await run();

    expect(flat(stdout)).toContain(`Cuenta (CBU y alias) ${text} `);
  });

  it.each([
    [{ ...ACCOUNT, cbu: '123' }, 'cbu'],
    [{ ...ACCOUNT, aliasCbu: '!' }, 'aliasCbu'],
  ])('%j: dato inválido, y el aviso nombra el comando nuevo', async (config, broken) => {
    save(config);

    await run('establecer', 'puntoVenta', '3');

    expect(flat(stdout)).toContain('Cuenta (CBU y alias) dato inválido');
    expect(flat(stderr)).toContain('`arcli config establecer cuenta <CBU> [ALIAS]`');
    // Con solo el alias mal, eliminar la cuenta borraría también un CBU sano.
    expect(flat(stderr).includes('arcli config eliminar cuenta')).toBe(broken === 'cbu');

    stdout = '';
    await run('establecer', 'puntoVenta', '4', '--json');
    expect(json()).not.toHaveProperty(broken);
  });
});
