import { describe, expect, it, vi } from 'vitest';

import { resolveActiveEnvironment } from '../../modules/interactive/config-fields';
import { reportCliError } from '../error-output';
import { createProgram } from '../program';

/** Corre el CLI con `--json` e imprime el error como `index.ts`; devuelve el JSON de error. */
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
    reportCliError(thrown, true);

    return JSON.parse(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')) as Record<string, unknown>;
  } finally {
    stderr.mockRestore();
    stdout.mockRestore();
  }
}

/**
 * `--testing` con `--produccion` no da el mismo código en todos lados (TEST-5). Estos tests fijan el comportamiento
 * actual, que es contrato del `--json`: si se unifica, se cambian acá a propósito y con su transición.
 */
describe('--testing con --produccion', () => {
  const MESSAGE = 'Usá `--testing` o `--produccion`, pero no ambos a la vez.';

  it.each([
    [['estado', '--testing', '--produccion']],
    [['padron', '20123456786', '--testing', '--produccion']],
    [['fc', '--monto', '1000', '--cs', '--ir-cf', '--testing', '--produccion']],
  ])('%j: CONFIGURATION_ERROR (lo resuelve la config de ARCA)', async (argv) => {
    expect(await runJsonError(argv)).toMatchObject({ codigo: 'CONFIGURATION_ERROR', error: MESSAGE });
  });

  it('certificado generar: INPUT_VALIDATION_ERROR (lo valida el comando)', async () => {
    expect(await runJsonError(['certificado', 'generar', '--testing', '--produccion'])).toMatchObject({
      codigo: 'INPUT_VALIDATION_ERROR',
      error: MESSAGE,
    });
  });

  // La sesión de ARCA del modo interactivo pasa por el mismo resolver (CONFIGURATION_ERROR); antes, la revisión de lo
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
