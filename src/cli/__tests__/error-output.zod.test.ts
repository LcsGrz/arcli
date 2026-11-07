import { describe, expect, it } from 'vitest';
import { z, type ZodError } from 'zod';

import { billingCommandSchema } from '../../modules/billing/billing.schemas';
import { stripAnsi } from '../../ui';
import { formatCliError } from '../error-output';

function parseAndGetError(input: unknown): ZodError {
  const result = billingCommandSchema.safeParse(input);

  if (result.success) {
    throw new Error('se esperaba que la validación fallara');
  }

  return result.error;
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
