import type { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { resolveActiveEnvironment } from '../../modules/interactive/config-fields';
import { reportCliError } from '../error-output';
import { createProgram } from '../program';

/** Corre el CLI con `--json` e imprime el error como `index.ts`; devuelve el JSON de error, con el código de salida. */
async function runJsonError(argv: string[]): Promise<Record<string, unknown>> {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

  try {
    let thrown: unknown;

    try {
      await createProgram().parseAsync(['node', 'arcli', ...argv, '--json']);
    } catch (error) {
      thrown = error;
    }

    if (thrown === undefined) {
      throw new Error(`se esperaba un error con ${argv.join(' ')}`);
    }

    stderr.mockClear();
    const exitCode = reportCliError(thrown, true);

    return {
      ...(JSON.parse(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')) as Record<string, unknown>),
      exitCode,
    };
  } finally {
    stderr.mockRestore();
    stdout.mockRestore();
  }
}

/** Lo obligatorio de cada comando, para que el único problema sean los dos flags. */
const REQUIRED_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  'certificado importar': [fileURLToPath(import.meta.url)],
  consultar: ['fc', '1'],
  'fce-obligado': ['20123456786'],
  padron: ['20123456786'],
  // Sin tabla, lista las que hay: no usa el entorno (ver abajo).
  parametros: ['comprobantes'],
  ultimos: ['fc'],
};

/** Los que ya lo daban bien. */
const ALREADY_INPUT = new Set(['certificado generar', 'certificado importar']);

/** Los comandos que declaran los dos flags. El del asistente necesita una terminal: su sesión se prueba aparte. */
function commandsWithBothFlags(): Array<[string, string[]]> {
  const found: Array<[string, string[]]> = [];

  function walk(parent: Command, parentPath: string): void {
    for (const command of parent.commands) {
      const path = `${parentPath} ${command.name()}`.trim();
      const flags = command.options.map(({ long }) => long);

      if (path !== 'interactivo' && flags.includes('--testing') && flags.includes('--produccion')) {
        const required = command.registeredArguments.filter((argument) => argument.required);
        const letter = required.length === 1 && required[0].name() === 'letra';
        const letters = ['a', 'b', 'c', 'e'].filter(
          (name) => name !== 'e' || /^(factura|nota-credito|nota-debito)$/.test(path),
        );
        const variants = letter ? letters.map((name) => [name]) : [REQUIRED_ARGUMENTS[path] ?? []];

        for (const args of variants) {
          if (args.length < required.length) {
            throw new Error(`Faltan los argumentos de \`${path}\` en REQUIRED_ARGUMENTS.`);
          }

          found.push([
            letter ? `${path} ${args[0]}` : path,
            [...path.split(' '), ...args, '--testing', '--produccion'],
          ]);
        }
      }

      walk(command, path);
    }
  }

  walk(createProgram(), '');

  return found;
}

describe('--testing con --produccion', () => {
  const MESSAGE = 'Usá `--testing` o `--produccion`, pero no ambos a la vez.';
  const COMMANDS = commandsWithBothFlags();

  it('recorre los comandos registrados', () => {
    expect(COMMANDS.map(([name]) => name)).toEqual(
      expect.arrayContaining(['fa', 'rc', 'fcea', 'fe', 'nce', 'factura e', 'recibo c', 'consultar', 'monotributo']),
    );
  });

  it.each(COMMANDS)('sin cambios: %s, el mismo mensaje y código de salida 1', async (_name, argv) => {
    expect(await runJsonError(argv)).toMatchObject({ detalles: null, error: MESSAGE, exitCode: 1, sugerencia: null });
  });

  it.each(COMMANDS.filter(([name]) => !ALREADY_INPUT.has(name)))('%s: INPUT_VALIDATION_ERROR', async (_name, argv) => {
    expect(await runJsonError(argv)).toMatchObject({ codigo: 'INPUT_VALIDATION_ERROR', error: MESSAGE });
  });

  it.each(COMMANDS.filter(([name]) => ALREADY_INPUT.has(name)))(
    'sin cambios: %s, INPUT_VALIDATION_ERROR',
    async (_name, argv) => {
      expect(await runJsonError(argv)).toMatchObject({ codigo: 'INPUT_VALIDATION_ERROR', error: MESSAGE });
    },
  );

  it('sin cambios: `parametros` sin tabla no usa el entorno y lista las tablas', async () => {
    await expect(runJsonError(['parametros', '--testing', '--produccion'])).rejects.toThrow('se esperaba un error');
  });

  it('sin cambios: la config que falta sigue siendo CONFIGURATION_ERROR', async () => {
    expect(await runJsonError(['estado', '--testing'])).toMatchObject({ codigo: 'CONFIGURATION_ERROR', exitCode: 1 });
  });

  // La sesión de ARCA del modo interactivo pasa por el mismo resolver; antes, la revisión de lo
  // que falta configurar no da error y mira el entorno de la config.
  it('la revisión de la configuración del modo interactivo se queda con el entorno de la config', () => {
    expect(resolveActiveEnvironment({ entornoPorDefecto: 'produccion' }, { produccion: true, testing: true })).toBe(
      'produccion',
    );
    expect(resolveActiveEnvironment({ entornoPorDefecto: 'testing' }, { produccion: true, testing: true })).toBe(
      'testing',
    );
  });
});
