import { describe, expect, it } from 'vitest';

import { InputValidationError } from '../../../lib/errors/app-error';
import { arcliConfigSchema } from '../../config/config.schemas';
import { billingDefaultsFromConfig } from '../billing.defaults';
import { type BillingInputOptions, resolveBillingInput } from '../billing.input';
import { resolveBillingInputPlan } from '../billing.input-plan';

/** REV-52: la entrada sin commander ni disco, como la arma quien no es el CLI. */

// El 10/11 en Argentina y ya el 11/11 en UTC.
const NOW = new Date('2026-11-11T01:00:00Z');
const FILE = { concepto: 'servicios', ivaReceptor: 'consumidor-final', montoTotal: 1000 };

const resolve = (options: Partial<BillingInputOptions> = {}) =>
  resolveBillingInput({ defaults: {}, file: FILE, now: NOW, shortcut: 'fb', ...options });

describe('resolveBillingInput', () => {
  it('con solo el archivo arma la entrada, y sin nada que pida emitir no se emite', () => {
    expect(
      resolve({
        file: { ...FILE, fechaComprobante: 'hoy', numeroDocumento: 30111222, pdf: false, tipoDocumento: 'dni' },
      }),
    ).toEqual({
      input: expect.objectContaining({
        billingDate: '10/11/2026',
        concept: 'servicios',
        documentNumber: 30111222,
        documentType: 'dni',
        dryRun: true,
        emit: false,
        ivaCondition: 'consumidor-final',
        pdf: false,
        totalAmount: 1000,
      }),
      modeSource: 'default',
    });
  });

  it('la config completa lo que el archivo no dice', () => {
    const defaults = billingDefaultsFromConfig(
      arcliConfigSchema.parse({
        conceptoPorDefecto: 'productos',
        cuit: '20111111112',
        ivaReceptorPorDefecto: 'consumidor-final',
      }),
    );

    expect(resolve({ defaults, file: { montoTotal: 1 } }).input).toMatchObject({
      concept: 'productos',
      ivaCondition: 'consumidor-final',
    });
    expect(resolve({ defaults }).input.concept).toBe('servicios');
  });

  it('los flags van con la forma del archivo y ganan, también con `false` y `null`', () => {
    expect(
      resolve({
        file: { ...FILE, condicionVenta: 'contado', emitir: true, pdf: true },
        flags: { condicionVenta: null, emitir: false, montoTotal: 5, pdf: false },
      }),
    ).toMatchObject({
      input: { emit: false, fromFile: undefined, pdf: false, saleCondition: null, totalAmount: 5 },
      modeSource: 'flags',
    });
  });

  it('los flags incompatibles salen en su lugar entre los demás errores', () => {
    const flags = { errors: { pdf: new InputValidationError('flags de PDF') } };

    expect(() => resolve({ flags })).toThrow('flags de PDF');
    expect(() => resolve({ file: {}, flags })).toThrow('Falta el concepto.');
    expect(() => resolve({ file: { ...FILE, servicioHasta: 'malo' }, flags })).toThrow('flags de PDF');
  });

  it('no cambia lo que recibe', () => {
    const file = Object.freeze({ ...FILE, periodoAsociado: Object.freeze({ desde: 'hoy' }) });

    resolve({ file, flags: Object.freeze({ montoTotal: 2 }) });

    expect(file).toEqual({ ...FILE, periodoAsociado: { desde: 'hoy' } });
  });
});

describe('resolveBillingInputPlan', () => {
  const plan = (source?: unknown) => resolveBillingInputPlan({ defaults: {}, now: NOW, shortcut: 'fb', source });

  it('un array es un lote aunque tenga uno, y junta los errores con su posición', () => {
    expect(plan([FILE])).toMatchObject({ inputIndexes: [1], isBatch: true, total: 1 });
    expect(plan([FILE, { noExiste: 1 }, { ...FILE, emitir: false }])).toMatchObject({
      inputIndexes: [1, 3],
      invalidItems: [{ code: 'INPUT_VALIDATION_ERROR', index: 2 }],
      isBatch: true,
      modeSource: 'file',
      total: 3,
    });
  });

  it('un objeto es un comprobante suelto y falla con su propio error', () => {
    expect(plan(FILE)).toMatchObject({ inputIndexes: [1], isBatch: false, total: 1 });
    expect(() => plan({ ...FILE, noExiste: 1 })).toThrow('"noExiste"');
  });

  it('`null` es un archivo con otra cosa, no la falta de archivo', () => {
    expect(() => plan(null)).toThrow('tiene que ser un objeto o un array de objetos');
    expect(() => plan()).toThrow('Falta el concepto.');
  });
});
