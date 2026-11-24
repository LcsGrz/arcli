import { afterEach, describe, expect, it, vi } from 'vitest';

import { stripAnsi, visibleWidth } from '../../../ui/primitives';
import { BUNDLED_MONOTRIBUTO_TABLE } from '../monotributo.bundled';
import {
  formatMonotributoBlockAsText,
  formatMonotributoBlockPosition,
  formatMonotributoCategoryAsText,
  formatMonotributoFullAsText,
  formatMonotributoNotices,
  formatMonotributoSummaryAsText,
  type MonotributoReport,
  serializeMonotributo,
} from '../monotributo.presenter';

function report(partial: Partial<MonotributoReport> = {}): MonotributoReport {
  return {
    consultedOn: '20261118',
    notices: [],
    ownCategory: 'E',
    source: 'arca',
    table: BUNDLED_MONOTRIBUTO_TABLE,
    version: '2.6.0',
    ...partial,
  };
}

const plain = (text: string) => stripAnsi(text);
const lines = (text: string) => plain(text).split('\n');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('serializeMonotributo', () => {
  it('trae la tabla entera con los nombres del contrato', () => {
    const json = serializeMonotributo(report({ notices: ['un aviso'] }));

    expect(Object.keys(json)).toEqual([
      'vigenteDesde',
      'fuente',
      'consultadaEl',
      'url',
      'tuCategoria',
      'categorias',
      'avisos',
    ]);
    expect(json).toMatchObject({
      avisos: ['un aviso'],
      consultadaEl: '20261118',
      fuente: 'arca',
      tuCategoria: 'E',
      url: 'https://www.afip.gob.ar/monotributo/categorias.asp',
      vigenteDesde: '20260801',
    });
    expect(json.categorias).toHaveLength(11);
    expect(json.categorias[4]).toEqual({
      categoria: 'E',
      ingresosBrutosHasta: 36_028_231.33,
      superficieHastaM2: 110,
      energiaHastaKwh: 13_000,
      alquileresHasta: 4_841_002.66,
      precioUnitarioMaximo: 716_840.77,
      impuestoIntegrado: { servicios: 55_857.73, ventas: 44_313.79 },
      aporteSipa: 26_715.24,
      obraSocial: 37_238.48,
      cuotaMensual: { servicios: 119_811.45, ventas: 108_267.51 },
    });
  });

  it('con --categoria trae solo esa', () => {
    const json = serializeMonotributo(report(), 'K');

    expect(json.categorias.map((category: { categoria: string }) => category.categoria)).toEqual(['K']);
  });

  it('la incluida sale sin fecha de consulta y sin categoría propia', () => {
    const json = serializeMonotributo(report({ consultedOn: null, ownCategory: null, source: 'incluida' }));

    expect(json).toMatchObject({ consultadaEl: null, fuente: 'incluida', tuCategoria: null });
  });
});

describe('formatMonotributoSummaryAsText', () => {
  it('muestra tope y cuotas, marca la categoría propia y sugiere los comandos', () => {
    const text = plain(formatMonotributoSummaryAsText(report(), { hints: true, width: 86 }));

    expect(text).toContain('CATEGORÍAS DEL MONOTRIBUTO · DESDE EL 01/08/2026');
    expect(text).toContain('CAT.  INGRESOS ANUALES HASTA  CUOTA SERVICIOS  CUOTA VENTAS');
    expect(text).toMatch(/❯ E +\$ 36\.028\.231,33 +\$ 119\.811,45 +\$ 108\.267,51 +tu categoría/);
    expect(text).toMatch(/ {3}A +\$ 12\.009\.410,45 +\$ 49\.527,18 +\$ 49\.527,18\s/);
    expect(text).toContain('La cuota es mensual: impuesto integrado, aporte jubilatorio (SIPA) y obra social.');
    expect(text).toContain('Tabla de ARCA, consultada el 18/11/2026.');
    expect(text).toContain('`arcli monotributo --categoria E`');
    expect(text).toContain('`arcli monotributo --completa`');
  });

  it('sin categoría propia no marca ninguna fila y sugiere la E', () => {
    const text = plain(formatMonotributoSummaryAsText(report({ ownCategory: null }), { hints: true, width: 86 }));

    expect(text).not.toContain('❯');
    expect(text).not.toContain('tu categoría');
    expect(text).toContain('--categoria E');
  });

  it('nombra la tabla incluida y el tope configurado', () => {
    const text = plain(
      formatMonotributoSummaryAsText(report({ configuredLimit: 30_000_000, consultedOn: null, source: 'incluida' }), {
        width: 86,
      }),
    );

    expect(text).toContain('Tabla incluida en ARCLI 2.6.0.');
    expect(text).toContain('Tu tope de ingresos configurado (`monotributo.tope`): $ 30.000.000.');
    expect(text).not.toContain('arcli monotributo --completa');
  });

  it('en 40 columnas, cada categoría en dos líneas y nada se corta', () => {
    const text = formatMonotributoSummaryAsText(report({ ownCategory: 'K' }), { width: 34 });
    const body = lines(text);

    expect(body.some((line) => /❯ K {2}\$ 126\.610\.838,75/.test(line))).toBe(true);
    expect(body.some((line) => /^\s+\$ 1\.614\.446,04 · \$ 702\.103,24/.test(line))).toBe(true);
    expect(text).toContain('tu categoría');
    // Las lineas de la tabla entran en el panel de una terminal de 40 columnas (34 de contenido).
    const table = body.filter((line) => line.includes('$ '));

    expect(Math.max(...table.map((line) => visibleWidth(line.trim())))).toBeLessThanOrEqual(34);
  });

  it('si la etiqueta no entra al lado de la fila, la explica abajo', () => {
    const text = plain(formatMonotributoSummaryAsText(report(), { width: 66 }));

    expect(text).toMatch(/❯ E +\$ 36\.028\.231,33/);
    expect(text).toContain('❯ tu categoría.');
  });

  it('se lee en ASCII', () => {
    vi.stubEnv('ARCLI_ASCII', '1');

    const text = plain(formatMonotributoSummaryAsText(report(), { width: 86 }));

    expect(text).toMatch(/> E +\$ 36\.028\.231,33/);
    expect(text).toContain('CATEGORÍAS DEL MONOTRIBUTO - DESDE EL 01/08/2026');
  });
});

describe('formatMonotributoCategoryAsText', () => {
  it('la ficha de la E: límites, cuota con desglose y la siguiente', () => {
    const text = plain(formatMonotributoCategoryAsText(report(), 'E'));

    expect(text).toContain('CATEGORÍA E DEL MONOTRIBUTO');
    expect(text).toMatch(/Vigente desde +01\/08\/2026/);
    expect(text).toMatch(/Tu categoría +sí/);
    expect(text).toMatch(/Ingresos brutos +\$ 36\.028\.231,33/);
    expect(text).toMatch(/Superficie +110 m²/);
    expect(text).toMatch(/Energía eléctrica +13\.000 kWh/);
    expect(text).toMatch(/Alquileres +\$ 4\.841\.002,66/);
    expect(text).toMatch(/Precio unitario máximo +\$ 716\.840,77 \(solo venta de cosas muebles\)/);
    expect(text).toMatch(/Servicios +\$ 119\.811,45/);
    expect(text).toMatch(/Ventas +\$ 108\.267,51/);
    expect(text).toMatch(/Impuesto integrado +\$ 55\.857,73 servicios · \$ 44\.313,79 ventas/);
    expect(text).toMatch(/Aporte jubilatorio \(SIPA\) +\$ 26\.715,24/);
    expect(text).toMatch(/Obra social +\$ 37\.238,48 por titular; cada adherente suma lo mismo/);
    expect(text).toContain('Categoría siguiente F, hasta $ 45.151.659,41.');
    expect(text).toContain('Tabla de ARCA, consultada el 18/11/2026.');
  });

  it('de otra categoría dice cuál es la tuya; la K no tiene siguiente', () => {
    const text = plain(formatMonotributoCategoryAsText(report(), 'K'));

    expect(text).toMatch(/Tu categoría +no \(la tuya es la E\)/);
    expect(text).toContain('Es la categoría más alta.');
  });

  it('sin categoría propia no muestra la fila', () => {
    expect(plain(formatMonotributoCategoryAsText(report({ ownCategory: null }), 'A'))).not.toContain('Tu categoría');
  });
});

describe('--completa', () => {
  it('dos bloques, uno debajo del otro, con la categoría propia marcada en los dos', () => {
    const text = plain(formatMonotributoFullAsText(report(), { width: 86 }));

    expect(text).toContain('LÍMITES ANUALES · DESDE EL 01/08/2026');
    expect(text).toContain('1/2  sigue abajo: cuota mensual ↓');
    expect(text).toMatch(/CAT\. +INGRESOS +SUPERFICIE +ENERGÍA +ALQUILERES +PRECIO UNIT\./);
    expect(text).toMatch(/❯ E +\$ 36\.028\.231,33 +110 m² +13\.000 kWh +\$ 4\.841\.002,66 +\$ 716\.840,77/);
    expect(text).toContain('CUOTA MENSUAL EN PESOS · DESDE EL 01/08/2026');
    expect(text).toContain('2/2  ↑ arriba: límites anuales');
    expect(text).toMatch(/CAT\. +IMP\. SERV\. +IMP\. VENTAS +SIPA +OBRA SOCIAL +TOTAL SERV\. +TOTAL VENTAS/);
    expect(text).toMatch(/❯ E +55\.857,73 +44\.313,79 +26\.715,24 +37\.238,48 +119\.811,45 +108\.267,51/);
    expect(text.indexOf('LÍMITES ANUALES')).toBeLessThan(text.indexOf('CUOTA MENSUAL'));
  });

  it('sin lugar para las columnas, cada categoría apilada', () => {
    const text = plain(formatMonotributoBlockAsText(report(), 'cuota', { navigation: 'apilados', width: 34 }));

    expect(text).toMatch(/❯ E\s*\n +imp\. serv\. +55\.857,73/);
    expect(text).toMatch(/total ventas +702\.103,24/);
  });

  it('con flechas, la posición dice hacia dónde está el otro bloque', () => {
    expect(formatMonotributoBlockPosition('limites', 'flechas')).toBe('1/2  cuota mensual →');
    expect(formatMonotributoBlockPosition('cuota', 'flechas')).toBe('← límites anuales  2/2');

    vi.stubEnv('ARCLI_ASCII', '1');

    expect(formatMonotributoBlockPosition('limites', 'flechas')).toBe('1/2  cuota mensual >');
    expect(formatMonotributoBlockPosition('cuota', 'apilados')).toBe('2/2  ^ arriba: límites anuales');
  });
});

describe('formatMonotributoNotices', () => {
  it('los avisos van en el panel de avisos; sin avisos, nada', () => {
    expect(formatMonotributoNotices([])).toBeUndefined();
    expect(plain(formatMonotributoNotices(['La tabla puede estar vieja.']) ?? '')).toMatch(
      /AVISOS[\s\S]*• La tabla puede estar vieja\./,
    );
  });
});
