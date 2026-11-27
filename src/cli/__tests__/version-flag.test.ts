import { CommanderError } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { stripAnsi } from '../../ui';
import { handleCommanderExit } from '../error-output';
import { createProgram } from '../program';
import { CLI_VERSION } from '../version';

import { configPath, runCli, saveFullConfig, useConfigKeysFixture } from './config-keys.fixture';

/**
 * ERR-23: `-V` muestra la versión solo cuando es exactamente `-V`, en cualquier lugar del comando. Un argumento que
 * empieza con `-V` (`-Varios`, `-Ventas.sa`) es un valor o una opción desconocida, no la versión.
 */

useConfigKeysFixture();

const CBU = '0110599520000012345678';
/** Más largo que lo que acepta `--descripcion`: el error dice que el valor llegó a la descripción. */
const LONG_DESCRIPTION = `-Varios${'x'.repeat(200)}`;

/** El panel en una línea: la sugerencia puede cortarse en dos renglones. */
const flat = (text: string) => stripAnsi(text).replace(/[\s│┃╏|]+/g, ' ');

const stored = (): Record<string, unknown> =>
  existsSync(configPath()) ? (JSON.parse(readFileSync(configPath(), 'utf8')) as Record<string, unknown>) : {};

/** Fija `process.platform` en cada test del bloque: en Windows la sugerencia trae `'--'`, con comillas. */
function usePlatform(platform: NodeJS.Platform): void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
  });

  afterEach(() => {
    if (original) {
      Object.defineProperty(process, 'platform', original);
    }
  });
}

describe('la versión', () => {
  it.each([[['-V']], [['--version']], [['config', '-V']], [['fc', '-m', '1', '-V']]])(
    '%j imprime la versión con exit 0',
    async (argv) => {
      const { code, stderr, stdout } = await runCli(...argv);

      expect(stdout.trim()).toBe(CLI_VERSION);
      expect(stderr).toBe('');
      expect(code).toBe(0);
    },
  );

  it('la ayuda sigue mostrando `-V, --version`', async () => {
    const { code, stdout } = await runCli('--ayuda');

    expect(stdout).toContain('-V, --version');
    expect(code).toBe(0);
  });
});

describe('un argumento que empieza con -V no es la versión', () => {
  it('`--descripcion -Varios…` usa el valor como descripción', async () => {
    // Con la config completa, lo primero que falla es la descripción; sin ARCA: no pasa de la validación.
    saveFullConfig();

    const { code, stderr, stdout } = await runCli(
      ...['fc', '-m', '1', '--cs', '--cfinal', '--testing', '--previsualizar', '--json'],
      ...['--descripcion', LONG_DESCRIPTION],
    );

    expect(stdout).toBe('');
    expect(JSON.parse(stderr)).toMatchObject({
      codigo: 'INPUT_VALIDATION_ERROR',
      detalles: [expect.objectContaining({ mensaje: 'Descripción tiene que tener hasta 200 caracteres.' })],
    });
    expect(code).toBe(1);
  });

  it('`monotributo --categoria -Varios` es un error del valor de --categoria', async () => {
    const { code, stderr, stdout } = await runCli('monotributo', '--categoria', '-Varios', '--json');

    expect(stdout).toBe('');
    expect(JSON.parse(stderr)).toMatchObject({
      codigo: 'INPUT_VALIDATION_ERROR',
      error: '`--categoria` "-Varios" no es válido: usá una letra de la A a la K.',
    });
    expect(code).toBe(1);
  });

  it('`arcli -Vx` es una opción desconocida', async () => {
    const { code, stderr, stdout } = await runCli('-Vx', '--json');

    expect(stdout).toBe('');
    expect(JSON.parse(stderr)).toMatchObject({ codigo: 'INPUT_VALIDATION_ERROR', error: 'opción desconocida `-Vx`' });
    expect(code).toBe(1);
  });
});

describe('una opción corta desconocida entre los argumentos sugiere `--`', () => {
  usePlatform('linux');

  it.each([['-Ventas.sa'], ['-mi.alias']])(
    '`config establecer cuenta <CBU> %s` no guarda nada y muestra el comando con `--`',
    async (alias) => {
      const { code, stderr, stdout } = await runCli('config', 'establecer', 'cuenta', CBU, alias, '--json');

      expect(stdout).toBe('');
      expect(JSON.parse(stderr)).toMatchObject({
        codigo: 'INPUT_VALIDATION_ERROR',
        error: `opción desconocida \`${alias}\``,
        // El `--json` que se usó va antes del `--`.
        sugerencia: expect.stringContaining(`arcli config establecer --json -- cuenta ${CBU} ${alias}`),
      });
      expect(code).toBe(1);
      expect(stored()).not.toHaveProperty('cbu');
    },
  );

  it('sin --json, el panel de error lleva la misma sugerencia', async () => {
    const { code, stderr, stdout } = await runCli('config', 'establecer', 'cuenta', CBU, '-Ventas.sa');

    expect(stdout).not.toContain(CLI_VERSION);
    expect(flat(stderr)).toContain('opción desconocida `-Ventas.sa`');
    expect(flat(stderr)).toContain(`arcli config establecer -- cuenta ${CBU} -Ventas.sa`);
    expect(code).toBe(1);
  });
});

describe('después de `--`', () => {
  it('`-V` se guarda como valor', async () => {
    const { code } = await runCli('config', 'establecer', '--', 'emisor.razonSocial', '-V');

    expect(code).toBe(0);
    expect(stored()).toMatchObject({ emisor: { razonSocial: '-V' } });
  });

  it('el comando que sugiere el error guarda el alias', async () => {
    const { code } = await runCli('config', 'establecer', '--', 'cuenta', CBU, '-Ventas.sa');

    expect(code).toBe(0);
    expect(stored()).toMatchObject({ aliasCbu: '-Ventas.sa', cbu: CBU });
  });
});

/** El comando que sugiere el error en `--json`, sin los backticks. */
const suggestedCommand = (stderr: string): string => {
  const { sugerencia } = JSON.parse(stderr) as { sugerencia: string };

  return /`(arcli [^`]+ -- [^`]+)`/.exec(sugerencia)?.[1] ?? '';
};

describe('la sugerencia de `--`', () => {
  usePlatform('linux');

  it('conserva los flags que se usaron antes del `--`, y el comando sugerido guarda la cuenta', async () => {
    const failed = await runCli('config', 'establecer', 'cuenta', CBU, '-Ventas.sa', '--json');
    const suggested = suggestedCommand(failed.stderr);

    expect(suggested).toBe(`arcli config establecer --json -- cuenta ${CBU} -Ventas.sa`);

    const { code, stdout } = await runCli(...suggested.split(' ').slice(1));

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ aliasCbu: '-Ventas.sa', cbu: CBU });
    expect(stored()).toMatchObject({ aliasCbu: '-Ventas.sa', cbu: CBU });
  });

  it('un flag mal escrito también manda a la ayuda del comando', async () => {
    const { code, stderr } = await runCli('padron', '20333333334', '-j', '--json');

    expect(JSON.parse(stderr)).toMatchObject({
      codigo: 'INPUT_VALIDATION_ERROR',
      error: 'opción desconocida `-j`',
      sugerencia:
        'Si `-j` es un valor, poné `--` antes de los valores: `arcli padron --json -- 20333333334 -j`. ' +
        'Si es una opción, mirá `arcli padron --ayuda`.',
    });
    expect(code).toBe(1);
  });
});

describe('la sugerencia de `--` en Windows', () => {
  usePlatform('win32');

  it('el `--` va entre comillas: PowerShell no se lo queda', async () => {
    const { stderr } = await runCli('config', 'establecer', 'cuenta', CBU, '-Ventas.sa', '--json');

    expect(JSON.parse(stderr)).toMatchObject({
      sugerencia: expect.stringContaining(`\`arcli config establecer --json '--' cuenta ${CBU} -Ventas.sa\``),
    });
  });
});

describe('`-V` con otro error antes', () => {
  it.each([
    [['fc', '-x', '-V', '--json'], 'opción desconocida `-x`'],
    [['noexiste', '-V', '--json'], 'comando desconocido `noexiste`'],
  ])('%j sale con ese error, no con la versión', async (argv, error) => {
    const { code, stderr, stdout } = await runCli(...argv);

    expect(stdout).toBe('');
    expect(JSON.parse(stderr)).toMatchObject({ codigo: 'INPUT_VALIDATION_ERROR', error });
    expect(code).toBe(1);
  });
});

describe('handleCommanderExit', () => {
  it('no tira por `executeSubCommandAsync`, como el default de commander', () => {
    const program = createProgram();
    const error = new CommanderError(1, 'commander.executeSubCommandAsync', '(error)');

    expect(() => handleCommanderExit(program, program, error)).not.toThrow();
  });
});
