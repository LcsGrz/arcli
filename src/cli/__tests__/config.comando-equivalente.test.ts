import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { configPath, normalize, runCli, storedBytes, useConfigKeysFixture } from './config-keys.fixture';

/**
 * TUI-47: la clave `asistente.comandoEquivalente` decide si el asistente muestra "Esto equivale a:" antes de
 * "¿Emitimos?". Es de sí o no, por defecto sí. Aca, lo que ve quien la configura por comando: `config establecer`,
 * `config eliminar`, `arcli config` y su `--json`, y la ayuda. El asistente está en
 * `interactive/__tests__/config.rev-78.test.ts` y el cierre de emisión en
 * `interactive/__tests__/equivalent-command.config.test.ts`.
 */

useConfigKeysFixture();

const KEY = 'asistente.comandoEquivalente';
const LABEL = 'Mostrar el comando equivalente';

type Json = Record<string, unknown>;

async function runJson(...args: readonly string[]): Promise<Json> {
  const { code, stderr, stdout } = await runCli(...args, '--json');

  expect({ code, stderr }).toEqual({ code: 0, stderr: '' });

  return JSON.parse(stdout) as Json;
}

/** Las líneas del panel de `arcli config`, sin bordes ni espacios a los lados. */
async function configLines(...args: readonly string[]): Promise<string[]> {
  const { code, stderr, stdout } = await runCli(...args);

  expect({ code, stderr }).toEqual({ code: 0, stderr: '' });

  return normalize(stdout)
    .split('\n')
    .map((line) => line.replace(/^\s*│/, '').replace(/│\s*$/, '').trim());
}

/** El valor que muestra la fila del comando equivalente, o `undefined` si no está. */
function rowValue(lines: readonly string[]): string | undefined {
  const row = lines.find((line) => line.startsWith(`${LABEL}  `));

  return row?.slice(LABEL.length).trim();
}

describe('`config establecer asistente.comandoEquivalente`', () => {
  it.each([
    ['true', true],
    ['FALSE', false],
    ['si', true],
    [' Sí ', true],
    ['no', false],
    ['1', true],
    ['0', false],
  ] as const)('%s se guarda como %s y `--json` lo devuelve en `asistente`', async (value, saved) => {
    const json = await runJson('config', 'establecer', KEY, value);

    expect(json.asistente).toEqual({ comandoEquivalente: saved });
  });
  it('queda en el config.json como `asistente.comandoEquivalente`', async () => {
    await runJson('config', 'establecer', KEY, 'no');

    expect((JSON.parse(storedBytes()) as Json).asistente).toEqual({ comandoEquivalente: false });
  });
  it('un valor que no es sí o no se rechaza con los valores válidos', async () => {
    const { code, stderr } = await runCli('config', 'establecer', KEY, 'quizas', '--json');

    expect(code).toBe(1);
    expect(JSON.parse(stderr)).toMatchObject({
      codigo: 'INPUT_VALIDATION_ERROR',
      error: '`asistente.comandoEquivalente` no acepta "quizas". Usá true/false, si/no o 1/0.',
    });
  });
  it('sin `--json` muestra la config con la fila en "no"', async () => {
    expect(rowValue(await configLines('config', 'establecer', KEY, 'no'))).toBe('no');
  });
});

describe('`config eliminar asistente.comandoEquivalente`', () => {
  it('vuelve al por defecto: `--json` dice true', async () => {
    await runJson('config', 'establecer', KEY, 'no');

    const json = await runJson('config', 'eliminar', KEY);

    expect(json.asistente).toEqual({ comandoEquivalente: true });
  });
  it('sin `--json` muestra la fila con "sí (por defecto)"', async () => {
    await runJson('config', 'establecer', KEY, 'no');

    expect(rowValue(await configLines('config', 'eliminar', KEY))).toBe('sí (por defecto)');
  });
});

describe('`arcli config`', () => {
  it('`--json` sin nada guardado trae `asistente.comandoEquivalente` en true', async () => {
    expect((await runJson('config')).asistente).toEqual({ comandoEquivalente: true });
  });
  it('`--json` trae el valor guardado', async () => {
    // Como lo deja `config establecer`, escrito a mano: lo que se lee es el archivo, no lo que guarda el comando.
    writeFileSync(configPath(), JSON.stringify({ asistente: { comandoEquivalente: false } }));

    expect((await runJson('config')).asistente).toEqual({ comandoEquivalente: false });
  });
  it('sin nada guardado, la fila dice "sí (por defecto)"', async () => {
    expect(rowValue(await configLines('config'))).toBe('sí (por defecto)');
  });
  it('guardado en sí, la fila dice "sí", sin "(por defecto)"', async () => {
    await runJson('config', 'establecer', KEY, 'si');

    expect(rowValue(await configLines('config'))).toBe('sí');
  });
  it('la fila va en una sección "Asistente", después de "Salida y listados"', async () => {
    const lines = await configLines('config');
    const output = lines.indexOf('Salida y listados');
    const assistant = lines.indexOf('Asistente');
    const row = lines.findIndex((line) => line.startsWith(`${LABEL}  `));

    expect(output).toBeGreaterThan(-1);
    expect(assistant).toBeGreaterThan(output);
    // La fila es la primera de la sección, debajo del título.
    expect(row).toBe(assistant + 1);
  });
});

describe('`config establecer --ayuda`', () => {
  it('lista la clave con sus valores de sí o no y el por defecto', async () => {
    const lines = await configLines('config', 'establecer', '--ayuda');

    expect(lines).toContain(`- ${KEY}: ${LABEL} (true/false, si/no o 1/0; por defecto si)`);
  });
});
