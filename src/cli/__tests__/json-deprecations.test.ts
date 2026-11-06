import { describe, expect, it } from 'vitest';

import { serializeBillingResult } from '../../modules/billing/billing.serialize';
import type { BillingExecutionResult } from '../../modules/billing/billing.types.internal';
import { exportJsonInputWarnings, readExportJsonInput } from '../../modules/export/export.json-input';
import { serializeExportResult } from '../../modules/export/export.serialize';
import type { ExportExecutionResult } from '../../modules/export/export.types';
import { EXPORT_VOUCHER_KIND } from '../../modules/export/export.types';
import { formatFceObligationAsJson } from '../../modules/fce/fce-obligation.presenter';
import { formatPadronAsJson } from '../../modules/padron/padron.presenter';
import { formatStatusAsJson } from '../../modules/parameters/parameters.presenter';
import { toDetailErrors, withDeprecatedErrors } from '../../services/arca/arca-error-details';

function billingResult(errors: unknown[] = [], events: unknown[] = []): BillingExecutionResult {
  return {
    environment: 'produccion',
    payload: { PtoVta: 3 },
    response: { errors, events, observaciones: [], suggestions: [] },
    voucherKind: { arcaType: 6, displayName: 'Factura B', shortcut: 'fb' },
  } as unknown as BillingExecutionResult;
}

function exportResult(errors: unknown[] = []): ExportExecutionResult {
  return {
    display: { unitNames: {} },
    environment: 'testing',
    payload: { Actividades: { Actividad: [] }, Cbte_nro: 1234, Items: { Item: [] }, Punto_vta: 5 },
    response: { errors, events: [], observaciones: [], suggestions: [] },
    voucherKind: EXPORT_VOUCHER_KIND,
  } as unknown as ExportExecutionResult;
}

describe('emisiones en JSON', () => {
  it('A, B y C suman codigo y mensaje, sin sacar Code y Msg, y avisan', () => {
    const json = serializeBillingResult(billingResult([{ Code: 10016, Msg: 'Rechazado' }]));

    expect(json.errores).toEqual([{ Code: 10016, codigo: 10016, mensaje: 'Rechazado', Msg: 'Rechazado' }]);
    expect(json.deprecado).toEqual([expect.stringContaining('`Code` y `Msg`')]);
  });

  it('tambien en los eventos', () => {
    const json = serializeBillingResult(billingResult([], [{ Code: 1, Msg: 'Aviso' }]));

    expect(json.eventos).toEqual([{ Code: 1, codigo: 1, mensaje: 'Aviso', Msg: 'Aviso' }]);
    expect(json.deprecado).toHaveLength(1);
  });

  it('sin errores ni eventos no hay cartel, y siempre dice entorno y punto de venta', () => {
    const json = serializeBillingResult(billingResult());

    expect(json).not.toHaveProperty('deprecado');
    expect(json).toMatchObject({ entorno: 'produccion', puntoVenta: 3 });
  });

  it('la factura E suma codigo y mensaje, y trae numero, entorno y punto de venta', () => {
    const json = serializeExportResult(exportResult([{ code: 1, message: 'Mal' }]));

    expect(json.errores).toEqual([{ code: 1, codigo: 1, mensaje: 'Mal', message: 'Mal' }]);
    expect(json.deprecado).toEqual([expect.stringContaining('`code` y `message`')]);
    expect(json).toMatchObject({ entorno: 'testing', numero: 1234, puntoVenta: 5 });
    expect(serializeExportResult(exportResult())).not.toHaveProperty('deprecado');
  });
});

describe('consultas en JSON', () => {
  it('estado suma puntoVentaDetalle y mantiene puntoVenta como objeto', () => {
    const json = JSON.parse(
      formatStatusAsJson({
        environment: 'testing',
        latencyMs: 1,
        pointOfSale: { kind: 'sin-configurar' },
        ready: false,
        servers: { app: 'OK', auth: 'OK', db: 'OK' },
      } as never),
    );
    const detail = { estado: 'sin-configurar', numero: null, tipoEmision: null };

    expect(json.puntoVenta).toEqual(detail);
    expect(json.puntoVentaDetalle).toEqual(detail);
    expect(json.deprecado).toEqual([expect.stringContaining('`puntoVentaDetalle`')]);
  });

  it('padron y fce-obligado mantienen cuit como numero y avisan', () => {
    const padron = JSON.parse(
      formatPadronAsJson({
        environment: 'testing',
        taxpayer: { activities: [], cuit: 20201797064, notices: [], taxes: [] },
      } as never),
    );
    const fce = JSON.parse(
      formatFceObligationAsJson({
        cuit: 30546689979,
        environment: 'testing',
        issueDate: '20261019',
        obligation: { minimumAmount: 1, obligated: true },
      }),
    );

    for (const [json, cuit] of [
      [padron, 20201797064],
      [fce, 30546689979],
    ]) {
      expect(json.cuit).toBe(cuit);
      expect(json.deprecado).toEqual([expect.stringContaining('`cuit` pasa a ser texto')]);
    }
  });
});

describe('detalles de los errores de ARCA', () => {
  it('suma codigo y mensaje sin sacar lo que trae', () => {
    expect(toDetailErrors([{ code: 11002, msg: 'Mal' }])).toEqual([
      { code: 11002, codigo: 11002, mensaje: 'Mal', msg: 'Mal' },
    ]);
  });

  it('deja detalles.errors con su aviso', () => {
    expect(withDeprecatedErrors('viejo', [{ codigo: 1, mensaje: 'Mal' }])).toEqual({
      deprecado: [expect.stringContaining('`detalles.errors`')],
      errores: [{ codigo: 1, mensaje: 'Mal' }],
      errors: 'viejo',
    });
  });
});

describe('monto en el JSON de --cargar de la factura E', () => {
  it('acepta montoTotal sin aviso', () => {
    const input = readExportJsonInput({ montoTotal: 1500 });

    expect(input.montoTotal).toBe(1500);
    expect(exportJsonInputWarnings(input)).toEqual([]);
  });

  it('acepta monto con aviso', () => {
    const input = readExportJsonInput({ monto: 1500 });

    expect(input.monto).toBe(1500);
    expect(exportJsonInputWarnings(input)).toEqual([expect.stringContaining('"montoTotal"')]);
  });

  it('rechaza las dos juntas', () => {
    expect(() => readExportJsonInput({ monto: 1500, montoTotal: 1500 })).toThrow('no las dos');
  });
});
