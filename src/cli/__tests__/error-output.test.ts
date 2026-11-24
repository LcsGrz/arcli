import { Command, InvalidArgumentError, Option } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { z, type ZodError } from 'zod';

import { AppError, InputIssuesError } from '../../lib/errors/app-error';
import { billingCommandSchema } from '../../modules/billing/billing.schemas';
import { parseZodInput } from '../../modules/billing/billing.zod-errors';
import { type CanonicalConfigKey, parseConfigValue } from '../../modules/config/config-value-parser';
import { stripAnsi } from '../../ui';
import { EmissionCancelledError } from '../emission-cancelled';
import { configureUsageErrors, formatCliError, reportCliError, shouldPrintErrorAsJson } from '../error-output';

describe('shouldPrintErrorAsJson', () => {
  it('uses JSON with --json without reading the config', () => {
    expect(
      shouldPrintErrorAsJson(['node', 'arcli', 'estado', '--json'], () => {
        throw new Error('no debería leer la config');
      }),
    ).toBe(true);
  });

  it('follows json=true from the config without the flag', () => {
    expect(shouldPrintErrorAsJson(['node', 'arcli', 'estado'], () => true)).toBe(true);
    expect(shouldPrintErrorAsJson(['node', 'arcli', 'estado'], () => false)).toBe(false);
  });

  it('falls back to text when the config cannot be read', () => {
    expect(
      shouldPrintErrorAsJson(['node', 'arcli', 'estado'], () => {
        throw new Error('config inválida');
      }),
    ).toBe(false);
  });
});

function parseAndGetError(input: unknown): ZodError {
  try {
    parseZodInput(billingCommandSchema, input);
  } catch (error) {
    return error as ZodError;
  }

  throw new Error('se esperaba que la validación fallara');
}

describe('formatCliError con errores de zod', () => {
  it('avisa cuando falta un campo string obligatorio', () => {
    const error = parseAndGetError({
      concept: 'servicios',
      ivaCondition: 'consumidor-final',
      totalAmount: 100,
    });

    expect(formatCliError(error, false)).toContain('Falta el dato: shortcut.');
  });

  it('usa un mensaje especifico para montos invalidos', () => {
    const error = parseAndGetError({
      concept: 'servicios',
      ivaCondition: 'consumidor-final',
      shortcut: 'fa',
      totalAmount: -5,
    });

    expect(formatCliError(error, false)).toContain('El monto debe ser mayor a 0.');
  });

  it('marca valores no soportados con la etiqueta legible en español', () => {
    const error = parseAndGetError({
      concept: 'servicios',
      documentType: 'no-existe',
      ivaCondition: 'consumidor-final',
      shortcut: 'fa',
      totalAmount: 100,
    });

    expect(formatCliError(error, false)).toContain('Tipo de documento tiene un valor no soportado.');
    expect(stripAnsi(formatCliError(error, false)).replace(/[│┃\s]+/g, ' ')).toContain(
      'Valores válidos: consumidor-final, cuil, cuit, dni.',
    );
  });

  it('serializa el detalle en JSON traduciendo la ruta a los nombres publicos', () => {
    const error = parseAndGetError({
      concept: 'servicios',
      shortcut: 'fa',
      totalAmount: 100,
    });

    const parsed = JSON.parse(formatCliError(error, true)) as {
      codigo: string;
      detalles: Array<{ mensaje: string; ruta: string[] }>;
      error: string;
    };

    expect(parsed.codigo).toBe('INPUT_VALIDATION_ERROR');
    expect(parsed.detalles).toContainEqual(expect.objectContaining({ ruta: ['ivaReceptor'] }));
  });

  it('un punto de venta negativo dice lo mismo que en las consultas', () => {
    const error = parseAndGetError({
      concept: 'servicios',
      ivaCondition: 'consumidor-final',
      pointOfSale: -3,
      shortcut: 'fa',
      totalAmount: 100,
    });

    expect(formatCliError(error, false)).toContain('El punto de venta tiene que ser un número entero positivo.');
  });

  it('traduce a la clave del JSON tambien los campos que solo usa el PDF', () => {
    const error = parseAndGetError({
      concept: 'servicios',
      ivaCondition: 'consumidor-final',
      pdfDescription: 'x'.repeat(201),
      shortcut: 'fa',
      totalAmount: 100,
    });

    const parsed = JSON.parse(formatCliError(error, true)) as { detalles: Array<{ ruta: string[] }> };

    expect(parsed.detalles).toContainEqual(expect.objectContaining({ ruta: ['descripcion'] }));
  });
});

describe('formatCliError', () => {
  it('siempre incluye sugerencia en el JSON de un error de zod, null porque no hay', () => {
    const error = z.object({ monto: z.number() }).safeParse({}).error as ZodError;
    const json = JSON.parse(formatCliError(error, true)) as Record<string, unknown>;

    expect(Object.keys(json).sort()).toEqual(['codigo', 'detalles', 'error', 'sugerencia']);
    expect(json.sugerencia).toBeNull();
  });
});

/** Un programa chico con los casos de commander que el CLI real no produce con un solo comando. */
function createUsageProgram(): Command {
  const program = new Command('arcli');

  configureUsageErrors(program);
  program
    .command('emitir')
    .requiredOption('--pv <numero>', 'punto de venta')
    .option('--monto <numero>', 'monto', () => {
      throw new InvalidArgumentError('no es un número.');
    })
    .addOption(new Option('--testing', 'testing').conflicts('produccion'))
    .option('--produccion', 'producción')
    .action(() => undefined);
  program.command('tabla').action(() => undefined);
  program.command('tablo').action(() => undefined);

  return program;
}

/** Corre el programa y devuelve el JSON de error que imprime `reportCliError`. */
function usageErrorJson(argv: string[]): { readonly exitCode: number; readonly json: Record<string, unknown> } {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  try {
    let thrown: unknown;

    try {
      createUsageProgram().parse(['node', 'arcli', ...argv]);
    } catch (error) {
      thrown = error;
    }

    if (thrown === undefined) {
      throw new Error('se esperaba un error de uso');
    }

    const exitCode = reportCliError(thrown, true);
    const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');

    return { exitCode, json: JSON.parse(output) as Record<string, unknown> };
  } finally {
    stderr.mockRestore();
  }
}

describe('traducción de los errores de uso de commander', () => {
  it.each([
    [['emitir'], 'falta la opción obligatoria `--pv <numero>`'],
    [
      ['emitir', '--pv', '1', '--monto', 'x'],
      "el valor 'x' de la opción `--monto <numero>` no es válido. no es un número.",
    ],
    [
      ['emitir', '--pv', '1', '--testing', '--produccion'],
      'la opción `--testing` no se puede usar junto con la opción `--produccion`',
    ],
    [['tabl'], 'comando desconocido `tabl` (¿quisiste decir alguno de `tabla`, `tablo`?)'],
  ])('%j', (argv, message) => {
    const { exitCode, json } = usageErrorJson(argv);

    expect(json).toMatchObject({ codigo: 'INPUT_VALIDATION_ERROR', error: message });
    expect(exitCode).toBe(1);
  });
});

describe('formatCliError: errores de config establecer', () => {
  function jsonError(key: CanonicalConfigKey, value: string, displayKey: string): Record<string, unknown> {
    try {
      parseConfigValue(key, value, displayKey);
    } catch (error) {
      return JSON.parse(formatCliError(error, true)) as Record<string, unknown>;
    }

    throw new Error('debería fallar');
  }

  it('mejora el mensaje sin cambiar la forma de `detalles` del --json (contrato)', () => {
    expect(jsonError('entornoPorDefecto', 'demo', 'entorno')).toEqual({
      codigo: 'INPUT_VALIDATION_ERROR',
      detalles: [{ mensaje: 'El valor no está entre los soportados. Valores válidos: testing, produccion.', ruta: [] }],
      error: '`entorno` no acepta "demo". Valores válidos: testing, produccion.',
      sugerencia: null,
    });
    expect(jsonError('monedaPorDefecto', '', 'moneda').detalles).toEqual([
      { mensaje: '`monedaPorDefecto` tiene que tener 3 caracteres.', ruta: ['monedaPorDefecto'] },
    ]);
  });

  it('en texto muestra el mensaje y la sugerencia, sin la lista de zod', () => {
    const error = new InputIssuesError('`pdf` no acepta "a".', [{ label: 'x', mensaje: 'zod', ruta: [] }], 'Mirá');
    const panel = stripAnsi(formatCliError(error, false));

    expect(panel).toContain('`pdf` no acepta "a".');
    expect(panel).toContain('Mirá');
    expect(panel).not.toContain('zod');
  });
});

describe('Ctrl+C en una pregunta que nadie atrapó', () => {
  function report(asJson: boolean): { code: number; stderr: string } {
    let stderr = '';
    const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);

      return true;
    });

    try {
      const error = Object.assign(new Error('User force closed the prompt with SIGINT'), { name: 'ExitPromptError' });

      return { code: reportCliError(error, asJson), stderr: stripAnsi(stderr) };
    } finally {
      write.mockRestore();
    }
  }

  it('en texto dice "Cancelado." sin afirmar nada sobre la emisión, y sale con 1', () => {
    const { code, stderr } = report(false);

    expect(code).toBe(1);
    expect(stderr).toContain('Cancelado.');
    expect(stderr).toContain('┌');
    expect(stderr).not.toMatch(/emiti|inesperado|User force closed/i);
  });

  it('en JSON no cambia', () => {
    const { code, stderr } = report(true);

    expect(code).toBe(1);
    expect(JSON.parse(stderr)).toEqual({
      codigo: 'UNEXPECTED_ERROR',
      detalles: null,
      error: 'User force closed the prompt with SIGINT',
      sugerencia: null,
    });
  });
});

describe('el JSON de error, byte a byte (REV-49)', () => {
  const app = (details?: Record<string, unknown>, suggestion?: string) =>
    new AppError('Falló.', { code: 'CONFIGURATION_ERROR', details, suggestion });
  const json = (codigo: string, detalles: string, error: string, sugerencia: string) =>
    `\n{\n  "codigo": "${codigo}",\n  "detalles": ${detalles},\n  "error": ${error},\n  "sugerencia": ${sugerencia}\n}\n\n`;
  const config = (detalles: string, sugerencia = 'null') =>
    json('CONFIGURATION_ERROR', detalles, '"Falló."', sugerencia);

  it.each<[string, unknown, string]>([
    ['sin detalles', app(), config('null')],
    ['detalles vacíos', app({}), config('{}')],
    ['todos los detalles vacíos', app({ a: null, b: undefined, c: '' }), config('{}')],
    [
      'cero, false y listas vacías quedan, en su orden',
      app({ z: 0, a: false, m: [] }),
      config('{\n    "z": 0,\n    "a": false,\n    "m": []\n  }'),
    ],
    [
      'path es ruta en su lugar, y solo en el primer nivel',
      app({ a: 1, path: '/x.json', z: { path: null, vacio: '' } }),
      config('{\n    "a": 1,\n    "ruta": "/x.json",\n    "z": {\n      "path": null,\n      "vacio": ""\n    }\n  }'),
    ],
    ['una sugerencia vacía', app(undefined, ''), config('null', '""')],
    [
      'InputIssuesError sin problemas',
      new InputIssuesError('Mal.', []),
      json('INPUT_VALIDATION_ERROR', '[]', '"Mal."', 'null'),
    ],
    [
      'un problema no muestra su etiqueta',
      new InputIssuesError('Mal.', [{ label: 'Monto', mensaje: 'Falta', ruta: ['items', 0] as never }], 'Mirá.'),
      json(
        'INPUT_VALIDATION_ERROR',
        '[\n    {\n      "mensaje": "Falta",\n      "ruta": [\n        "items",\n        0\n      ]\n    }\n  ]',
        '"Mal."',
        '"Mirá."',
      ),
    ],
    ['algo que no es un Error', 'texto', json('UNEXPECTED_ERROR', 'null', '"Ocurrió un error inesperado."', 'null')],
    ['sin mensaje', new Error(''), json('UNEXPECTED_ERROR', 'null', '""', 'null')],
    [
      'cancelado',
      new EmissionCancelledError(),
      json('UNEXPECTED_ERROR', 'null', JSON.stringify(new EmissionCancelledError().message), 'null'),
    ],
  ])('%s', (_name, error, expected) => {
    let stderr = '';
    const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => ((stderr += String(chunk)), true));

    vi.stubEnv('NO_COLOR', '1');

    try {
      expect(reportCliError(error, true)).toBe(1);
    } finally {
      write.mockRestore();
      vi.stubEnv('NO_COLOR', undefined);
    }

    expect(stderr).toBe(expected);
  });
});
