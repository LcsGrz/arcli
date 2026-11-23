import { describe, expect, it } from 'vitest';

import { getConfigField } from '../config-fields';
import {
  changesArcaAccess,
  configCurrencyOptions,
  configListKind,
  configListPrefersTyped,
  configListPrevious,
  isSameConfigChoice,
} from '../config-lists';

describe('listas de "Modificar configuración" (TUI-39)', () => {
  it('la condición de venta es texto libre con sugerencias; la moneda y la actividad, tablas', () => {
    expect(configListKind(getConfigField('condicionVenta'))).toBe('choices');
    expect(configListKind(getConfigField('moneda'))).toBe('currency');
    expect(configListKind(getConfigField('exportacion.actividad'))).toBe('activity');
    expect(configListKind(getConfigField('cuit'))).toBeUndefined();
    expect(configListPrefersTyped('choices')).toBe(true);
    expect(configListPrefersTyped('currency')).toBe(false);
    expect(configListPrefersTyped('activity')).toBe(false);
  });

  it('una moneda guardada con su ISO es la fila de su código de ARCA, y elegirla no es un cambio', () => {
    expect(configListPrevious('currency', 'usd')).toBe('DOL');
    expect(configListPrevious('activity', '6201')).toBe('6201');
    expect(isSameConfigChoice('currency', { label: 'DOL', value: 'DOL' }, 'USD')).toBe(true);
    expect(isSameConfigChoice('currency', { label: '060', value: '060' }, 'USD')).toBe(false);
    expect(isSameConfigChoice('choices', { label: 'Contado', value: 'contado' }, 'contado')).toBe(true);
    expect(isSameConfigChoice('activity', { label: '620100', value: '620100' }, '6201')).toBe(false);
  });

  it('las monedas guardan el código de ARCA y se buscan también por el ISO', () => {
    expect(configCurrencyOptions().slice(0, 2)).toEqual([
      { code: 'PES', keywords: 'PES ARS', name: 'Pesos argentinos' },
      { code: 'DOL', keywords: 'DOL USD', name: 'Dólares estadounidenses' },
    ]);
    expect(configCurrencyOptions().find((option) => option.code === 'NZD')?.keywords).toBe('NZD');
  });

  it('el entorno y los certificados y claves cambian con qué se consulta ARCA', () => {
    for (const key of ['entorno', 'cert.testing', 'key.produccion', 'exportacion.cert.testing'] as const) {
      expect(changesArcaAccess(key)).toBe(true);
    }

    expect(changesArcaAccess('moneda')).toBe(false);
    expect(changesArcaAccess('exportacion.actividad')).toBe(false);
  });
});
