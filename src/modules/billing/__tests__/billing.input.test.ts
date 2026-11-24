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

  it('`anulacion` y `mismaMoneda` en `false` también le ganan al `true` del archivo', () => {
    expect(
      resolve({ file: { ...FILE, anulacion: true }, flags: { anulacion: false }, shortcut: 'ncea' }).input.cancellation,
    ).toBe(false);

    const foreign = { ...FILE, codigoMoneda: 'USD' };

    expect(resolve({ file: { ...foreign, mismaMoneda: true }, flags: { mismaMoneda: false } }).input.sameCurrency).toBe(
      false,
    );
    // Sin misma moneda, la cotización del archivo vale.
    expect(
      resolve({ file: { ...foreign, cotizacionMoneda: 1400 }, flags: { mismaMoneda: false } }).input,
    ).toMatchObject({ exchangeRate: 1400, fromFile: ['exchangeRate'], sameCurrency: false });
  });

  it('`mismaMoneda` descarta la cotización del archivo y nada más', () => {
    expect(
      resolve({
        file: { ...FILE, codigoMoneda: 'USD', cotizacionMoneda: 1400, descripcion: 'Horas', dia: 5 },
        flags: { mismaMoneda: true },
      }).input,
    ).toMatchObject({ dueDay: 5, exchangeRate: undefined, fromFile: ['dueDay', 'pdfDescription'], sameCurrency: true });
  });

  it('un mes en el período asociado va del primer día al último', () => {
    expect(
      resolve({ file: { ...FILE, periodoAsociado: { desde: 'mes-pasado', hasta: 'mes-pasado' } }, shortcut: 'ncb' })
        .input.associatedPeriod,
    ).toEqual({ desde: '01/10/2026', hasta: '31/10/2026' });
  });

  it('una moneda vacía en los flags no descarta la cotización', () => {
    const errors = () =>
      resolve({ file: { ...FILE, codigoMoneda: 'USD', cotizacionMoneda: -1 }, flags: { codigoMoneda: '' } });

    // Los dos datos llegan a la validación.
    expect(errors).toThrow(/exchangeRate/);
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
