import { describe, expect, it } from 'vitest';

import {
  exportOptionals,
  type ExportOptionalsContext,
  type ExportOptionKey,
  type ExportOptions,
  isCountryCuitMissing,
} from '../export-optionals';
import { composeOptionals } from '../optional-group';
import type { WizardStep } from '../wizard';

/** Una pregunta por opcional que responde `answer`: alcanza para componer sin `prompts`. */
const answering = (name: string, answer: ExportOptions = {}): (() => Array<WizardStep<ExportOptions>>) => {
  return () => [{ name, run: async () => answer }];
};

/** El catalogo, armado en cada test (no al cargar el archivo): asi Stryker ve sus mutantes. */
const catalog = () =>
  exportOptionals({
    cotizacion: answering('cotizacion'),
    'cuit-pais': answering('cuit-pais'),
    fecha: answering('fecha'),
    idioma: answering('idioma'),
    incoterm: answering('incoterm'),
    items: answering('items'),
    observaciones: answering('observaciones'),
  });

const US = { code: 212, name: 'ESTADOS UNIDOS' };
const ATLANTIDA = { code: 999, name: 'ATLANTIDA' };
const COUNTRY_CUITS = [{ countryName: 'ESTADOS UNIDOS - Persona Jurídica', cuit: 55000002126 }];

function context(overrides: Partial<ExportOptionalsContext> = {}): ExportOptionalsContext {
  return {
    amount: 1500,
    currencyCode: 'DOL',
    defaultLanguage: 'Español',
    exportType: 2,
    languageNames: new Map([[2, 'Inglés']]),
    languages: async () => [],
    units: async () => [],
    ...overrides,
  };
}

const offered = (current: ExportOptionalsContext): ExportOptionKey[] =>
  catalog()
    .filter((option) => option.available(current))
    .map((option) => option.key);

const describeOf = (key: ExportOptionKey, current: ExportOptions, at = context()): string =>
  catalog()
    .find((option) => option.key === key)!
    .describe(current, at);

describe('exportOptionals', () => {
  it('ofrece el CUIT del país, el incoterm y la cotización solo cuando el contexto los tiene, en orden', () => {
    expect(offered(context())).toEqual(['fecha', 'items', 'idioma', 'observaciones']);
    expect(
      offered(
        context({
          countryCuit: { country: US, countryCuits: COUNTRY_CUITS },
          defaultExchangeRate: 'la de aduana que publica ARCA',
          incoterm: { code: 'FOB' },
        }),
      ),
    ).toEqual(['fecha', 'items', 'idioma', 'cuit-pais', 'observaciones', 'incoterm', 'cotizacion']);
  });

  it('describe lo aplicado y, sin nada, lo que va por defecto', () => {
    const withIncoterm = context({ defaultExchangeRate: '1.400', incoterm: { code: 'FOB', description: 'Free' } });

    expect(Object.fromEntries(catalog().map((option) => [option.key, option.describe({}, withIncoterm)]))).toEqual({
      cotizacion: '1.400',
      'cuit-pais': 'el de la tabla de ARCA',
      fecha: 'hoy',
      idioma: 'Español',
      incoterm: 'Free',
      items: 'un renglón con el monto total',
      observaciones: 'sin observaciones',
    });
    expect(describeOf('incoterm', {}, context({ incoterm: { code: 'FOB' } }))).toBe('FOB');
    expect(describeOf('idioma', { language: 2 })).toBe('Inglés');
    expect(describeOf('idioma', { language: 3 })).toBe('3');
    expect(describeOf('cotizacion', { exchangeRate: 1450.25 })).toBe('1.450,25');
    expect(describeOf('fecha', { voucherDate: '17/11/2026' })).toBe('17/11/2026');
    expect(describeOf('cuit-pais', { clientCountryCuit: 55000002118 })).toBe('55000002118');
    expect(describeOf('observaciones', { observations: 'a' })).toBe('con observaciones');
    expect(describeOf('observaciones', { commercialObservations: 'b' })).toBe('con comerciales');
    expect(describeOf('observaciones', { commercialObservations: 'b', observations: 'a' })).toBe(
      'con observaciones y comerciales',
    );
    const item = { description: 'a', quantity: 1, unit: 7, unitPrice: 1 };

    expect(describeOf('items', { items: [item] })).toBe('1 ítem');
    expect(describeOf('items', { items: [item, item] })).toBe('2 ítems');
  });

  // #9 de la auditoria del 19/11: sin CUIT publicado ni escrito, la E va solo con el ID impositivo.
  it('"CUIT del país" sin CUIT de ARCA dice que va el ID impositivo', () => {
    const missing = context({ countryCuit: { country: ATLANTIDA, countryCuits: COUNTRY_CUITS } });

    expect(isCountryCuitMissing({ country: ATLANTIDA, countryCuits: COUNTRY_CUITS })).toBe(true);
    expect(describeOf('cuit-pais', {}, missing)).toBe('sin CUIT (va el ID impositivo)');
    expect(describeOf('cuit-pais', { clientCountryCuit: 55000002126 }, missing)).toBe('55000002126');
    expect(describeOf('cuit-pais', {}, context({ countryCuit: { country: US, countryCuits: COUNTRY_CUITS } }))).toBe(
      'el de la tabla de ARCA',
    );
  });

  it('lo copiado en "Repetir" (ítems, idioma, CUIT del país e incoterm) sigue a la factura; en la nota, solo el incoterm sigue al asociado; los ítems, también al monto', () => {
    const keys = (overrides: Partial<ExportOptionalsContext>) =>
      Object.fromEntries(
        catalog()
          .filter((option) => option.resetWhen)
          .map((option) => [option.key, option.resetWhen?.(context(overrides))]),
      );

    expect(keys({ copiedFrom: '3:7' })).toEqual({
      'cuit-pais': '3:7',
      idioma: '3:7',
      incoterm: '3:7|',
      items: '3:7|1500',
    });
    expect(keys({ amount: 800, associated: '21:3:7' })).toEqual({
      'cuit-pais': '',
      idioma: '',
      incoterm: '|21:3:7',
      items: '|800',
    });
  });

  // REV-67: lo desmarcado vuelve a lo inicial (en "Repetir", lo copiado).
  it('lo desmarcado vuelve a lo inicial, y lo que no se ofrece también', () => {
    const initial: ExportOptions = { incotermDescription: 'Copiada', language: 3 };
    const answers = new Map<string, Partial<ExportOptions>>([
      ['fecha', { voucherDate: '17/11/2026' }],
      ['idioma', { language: 2 }],
      ['incoterm', { incotermDescription: 'Otra' }],
      ['cotizacion', { exchangeRate: 1200 }],
    ]);
    const current = context({ defaultExchangeRate: '1.400', incoterm: { code: 'FOB' } });

    expect(composeOptionals(initial, ['idioma'], catalog(), current, answers)).toEqual({
      ...initial,
      language: 2,
    });
    expect(composeOptionals(initial, [], catalog(), current, answers)).toEqual(initial);
    // Sin incoterm ni cotización en el contexto (por ejemplo, se cambió a servicios), quedan como al inicio.
    expect(composeOptionals(initial, ['incoterm', 'cotizacion', 'fecha'], catalog(), context(), answers)).toEqual({
      ...initial,
      voucherDate: '17/11/2026',
    });
  });
});
