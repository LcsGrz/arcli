import Conf from 'conf';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stripAnsi } from '../../../ui';
import { createProgram } from '../../program';

/** REV-52: `config establecer cbu` con un alias guardado, hasta el archivo. */

const CBU = '0110599520000012345678';
const OTHER_CBU = '0170099220000067797370';
const ALIAS = 'mi.alias.cbu';
const REMOVED =
  'Se borró el alias mi.alias.cbu de la config, que era del CBU anterior. Si el nuevo tiene alias, guardá los dos con `arcli config establecer cuenta <CBU> <ALIAS>`.';
const KEPT =
  'El alias guardado (mi.alias.cbu) se va a usar con este CBU. Si es de otro, guardá la cuenta de nuevo con `arcli config establecer cuenta <CBU> [ALIAS]`: sin alias, borra el guardado.';

let directory = '';
let stdout = '';
let stderr = '';

const path = () => join(directory, 'config.json');
const save = (config: object) => writeFileSync(path(), JSON.stringify(config));
const saved = () => {
  const { aliasCbu, cbu } = JSON.parse(readFileSync(path(), 'utf8')) as Record<string, unknown>;

  return { aliasCbu, cbu };
};
const run = (...args: string[]) => createProgram().parseAsync(['node', 'arcli', 'config', ...args]);
const flat = (text: string) => stripAnsi(text).replace(/[\s│┃╏|]+/g, ' ');

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-config-cbu-'));
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
  rmSync(directory, { force: true, recursive: true });
});

describe('config establecer cbu con un alias guardado', () => {
  it('con otro CBU borra el alias y lo dice en `avisos`', async () => {
    save({ aliasCbu: ALIAS, cbu: CBU });

    await run('establecer', 'cbu', OTHER_CBU, '--json');

    const json = JSON.parse(stdout) as Record<string, unknown>;

    expect(json.avisos).toEqual([REMOVED]);
    expect(json).toHaveProperty('cbu');
    expect(json).not.toHaveProperty('aliasCbu');
    expect(saved()).toEqual({ aliasCbu: undefined, cbu: OTHER_CBU });
  });

  it('sin --json, el aviso sale en stderr', async () => {
    save({ aliasCbu: ALIAS, cbu: CBU });

    await run('establecer', 'cbu', OTHER_CBU);

    expect(flat(stderr)).toContain(REMOVED);
    expect(flat(stdout)).not.toContain('Se borró');
  });

  it('sin CBU guardado, el alias queda y avisa que se va a usar', async () => {
    save({ aliasCbu: ALIAS });

    await run('establecer', 'cbu', CBU, '--json');

    expect((JSON.parse(stdout) as Record<string, unknown>).avisos).toEqual([expect.stringContaining(KEPT)]);
    expect(saved()).toEqual({ aliasCbu: ALIAS, cbu: CBU });
  });

  it('un CBU guardado inválido cuenta como si no hubiera: el alias queda y avisa', async () => {
    save({ aliasCbu: ALIAS, cbu: '123' });

    await run('establecer', 'cbu', CBU, '--json');

    expect((JSON.parse(stdout) as Record<string, unknown>).avisos).toEqual([expect.stringContaining(KEPT)]);
    expect(saved()).toEqual({ aliasCbu: ALIAS, cbu: CBU });
  });

  it('un alias guardado inválido no se va a usar: sale solo el aviso de dato inválido', async () => {
    save({ aliasCbu: '!', cbu: undefined });

    await run('establecer', 'cbu', CBU, '--json');

    expect((JSON.parse(stdout) as Record<string, unknown>).avisos).toEqual([
      expect.stringContaining('Sigue habiendo un dato inválido'),
    ]);
  });

  it.each([
    ['el mismo CBU, con espacios', { aliasCbu: ALIAS, cbu: CBU }, ['establecer', 'cbu', ` ${CBU} `]],
    ['sin alias guardado', { cbu: CBU }, ['establecer', 'cbu', OTHER_CBU]],
    ['otra clave', { aliasCbu: ALIAS, cbu: CBU }, ['establecer', 'puntoVenta', '3']],
  ])('%s: ni borra ni avisa', async (_name, config, args) => {
    save(config);

    await run(...args, '--json');

    expect(JSON.parse(stdout)).not.toHaveProperty('avisos');
    expect(saved().aliasCbu).toBe((config as { aliasCbu?: string }).aliasCbu);
  });

  it('con otra clave rota también lo borra, y los dos avisos van juntos', async () => {
    save({ aliasCbu: ALIAS, cbu: CBU, cuit: '123' });

    await run('establecer', 'cbu', OTHER_CBU, '--json');

    expect((JSON.parse(stdout) as Record<string, unknown>).avisos).toEqual([
      REMOVED,
      expect.stringContaining('Sigue habiendo un dato inválido'),
    ]);
    expect(saved()).toEqual({ aliasCbu: undefined, cbu: OTHER_CBU });
  });

  it('un CBU inválido no cambia nada', async () => {
    save({ aliasCbu: ALIAS, cbu: CBU });

    await expect(run('establecer', 'cbu', '123')).rejects.toThrow();
    expect(saved()).toEqual({ aliasCbu: ALIAS, cbu: CBU });
  });

  it('si falla la escritura no queda a medias ni avisa', async () => {
    // Completa, para que la única escritura sea la del cambio.
    await run('establecer', 'cbu', CBU);
    await run('establecer', 'aliasCbu', ALIAS);
    stderr = '';
    vi.spyOn(Conf.prototype, 'store', 'set').mockImplementation(() => {
      throw new Error('disco lleno');
    });

    await expect(run('establecer', 'cbu', OTHER_CBU)).rejects.toThrow('disco lleno');
    expect(saved()).toEqual({ aliasCbu: ALIAS, cbu: CBU });
    expect(stderr).toBe('');
  });
});
