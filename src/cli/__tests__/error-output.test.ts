import { Command, InvalidArgumentError, Option } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { z, type ZodError } from 'zod';

import { InputIssuesError } from '../../lib/errors/app-error';
import { billingCommandSchema } from '../../modules/billing/billing.schemas';
import { parseZodInput } from '../../modules/billing/billing.zod-errors';
import { type CanonicalConfigKey, parseConfigValue } from '../../modules/config/config-value-parser';
import { stripAnsi } from '../../ui';
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

  it('cae al mensaje original de zod cuando no hay una regla especial', () => {
    const error = parseAndGetError({
      concept: 'servicios',
      ivaCondition: 'consumidor-final',
      pointOfSale: -3,
      shortcut: 'fa',
      totalAmount: 100,
    });

    expect(formatCliError(error, false)).toContain('Punto de venta debe ser mayor a');
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
