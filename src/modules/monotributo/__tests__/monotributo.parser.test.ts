import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { checkMonotributoTable } from '../monotributo';
import { BUNDLED_MONOTRIBUTO_TABLE } from '../monotributo.bundled';
import { parseMonotributoPage, parsePageMoney, parsePageQuantity } from '../monotributo.parser';

/** La pagina real de ARCA, guardada el 18/11/2026 (valores desde el 1/08/2026). */
const PAGE = readFileSync(new URL('fixtures/categorias.html', import.meta.url), 'utf8');

/** La fila de una categoria en el HTML, desde su `<tr>` hasta el cierre. */
function rowOf(html: string, letter: string): string {
  const start = html.lastIndexOf('<tr>', html.indexOf(`id="th_${letter}_t15"`));

  return html.slice(start, html.indexOf('</tr>', start) + '</tr>'.length);
}

describe('parseMonotributoPage', () => {
  it('lee las 11 categorías y la vigencia de la página real', () => {
    const result = parseMonotributoPage(PAGE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.table.validFrom).toBe('20260801');
    expect(result.table.categories.map((category) => category.letter).join('')).toBe('ABCDEFGHIJK');
    expect(result.table.categories[0]).toEqual({
      areaLimitM2: 30,
      energyLimitKwh: 3330,
      grossIncomeLimit: 12_009_410.45,
      healthInsurance: 25_694.55,
      integratedTax: { sales: 5585.77, services: 5585.77 },
      letter: 'A',
      maxUnitPrice: 716_840.77,
      monthlyFee: { sales: 49_527.18, services: 49_527.18 },
      pensionContribution: 18_246.86,
      rentLimit: 2_792_886.15,
    });
    // La izquierda es servicios y la derecha ventas.
    expect(result.table.categories[10]).toMatchObject({
      grossIncomeLimit: 126_610_838.75,
      integratedTax: { sales: 456_171.4, services: 1_368_514.2 },
      letter: 'K',
      monthlyFee: { sales: 702_103.24, services: 1_614_446.04 },
    });
  });

  it('no lee las columnas comentadas ("Actividad")', () => {
    const result = parseMonotributoPage(PAGE);

    expect(result.ok && result.table.categories.every((category) => category.areaLimitM2 > 0)).toBe(true);
  });

  it('descarta la página si falta una categoría', () => {
    const result = parseMonotributoPage(PAGE.replace(rowOf(PAGE, 'K'), ''));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems.join(' ')).toContain('A a K');
  });

  it('descarta la página si los topes no crecen', () => {
    const result = parseMonotributoPage(PAGE.replace('$36.028.231,33', '$1.000,00'));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems.join(' ')).toContain('el tope de E no es mayor que el de D');
  });

  it('descarta la página si un total no es la suma de impuesto, SIPA y obra social', () => {
    const result = parseMonotributoPage(PAGE.replace('$119.811,45', '$119.811,46'));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems).toContain('la cuota de servicios de E no suma');
  });

  it('descarta la página si se invierten servicios y ventas en el total', () => {
    const swapped = rowOf(PAGE, 'E')
      .replace('$119.811,45', '$X')
      .replace('$108.267,51', '$119.811,45')
      .replace('$X', '$108.267,51');
    const result = parseMonotributoPage(PAGE.replace(rowOf(PAGE, 'E'), swapped));

    expect(result.ok).toBe(false);
  });

  it('descarta la página si un importe no se puede leer', () => {
    expect(parseMonotributoPage(PAGE.replace('$2.792.886,15', 'consultar')).ok).toBe(false);
  });

  it('descarta la página sin la vigencia o sin la tabla', () => {
    expect(parseMonotributoPage(PAGE.replace('Valores de aplicación desde el 1/08/2026', 'Valores vigentes')).ok).toBe(
      false,
    );
    expect(parseMonotributoPage('<html><body>Mantenimiento</body></html>')).toEqual({
      ok: false,
      problems: ['no se encontró la vigencia o la tabla'],
    });
  });

  it('acepta las entidades HTML en la vigencia', () => {
    const result = parseMonotributoPage(PAGE.replace('aplicación', 'aplicaci&oacute;n'));

    expect(result.ok && result.table.validFrom).toBe('20260801');
  });
});

describe('parsePageMoney y parsePageQuantity', () => {
  it.each([
    ['$12.009.410,45 ', 12_009_410.45],
    ['$716.840,77', 716_840.77],
    ['$ 1.000', 1000],
    ['$1.000,5', 1000.5],
  ])('%s → %s', (text, value) => {
    expect(parsePageMoney(text)).toBe(value);
  });

  it.each(['', '-', 'consultar', '1,000.50', '$12009410.45'])('"%s" no es un importe', (text) => {
    expect(parsePageMoney(text)).toBeNaN();
  });

  it.each([
    ['Hasta 30 m²', 30],
    ['Hasta 13000 kWh', 13_000],
    ['Hasta 13.000 kWh', 13_000],
  ])('%s → %s', (text, value) => {
    expect(parsePageQuantity(text)).toBe(value);
  });
});

describe('la tabla incluida', () => {
  it('pasa el mismo control que una leída de ARCA', () => {
    expect(checkMonotributoTable(BUNDLED_MONOTRIBUTO_TABLE)).toEqual([]);
  });
});
