import Big from 'big.js';

import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { MONOTRIBUTO_CATEGORY_LETTERS, type MonotributoCategoryLetter } from '../padron/padron';

export { MONOTRIBUTO_CATEGORY_LETTERS, type MonotributoCategoryLetter };

/** La pagina de ARCA con la tabla de categorias vigente. No hay web service ni archivo para bajar. */
export const MONOTRIBUTO_CATEGORIES_URL = 'https://www.afip.gob.ar/monotributo/categorias.asp';

/** Importe con una columna para servicios (locaciones y prestaciones) y otra para venta de cosas muebles. */
export interface ServicesAndSales {
  readonly sales: number;
  readonly services: number;
}

/** Una fila de la tabla de ARCA. Topes anuales; cuota y sus partes, mensuales. */
export interface MonotributoCategory {
  readonly areaLimitM2: number;
  readonly energyLimitKwh: number;
  readonly grossIncomeLimit: number;
  readonly healthInsurance: number;
  readonly integratedTax: ServicesAndSales;
  readonly letter: MonotributoCategoryLetter;
  /** Precio unitario maximo: solo para venta de cosas muebles. */
  readonly maxUnitPrice: number;
  readonly monthlyFee: ServicesAndSales;
  readonly pensionContribution: number;
  readonly rentLimit: number;
}

export interface MonotributoTable {
  readonly categories: readonly MonotributoCategory[];
  /** Fecha ARCA (yyyymmdd) desde la que rigen los valores. */
  readonly validFrom: string;
}

/** De donde salio la tabla que se muestra. */
export type MonotributoTableSource = 'arca' | 'guardada' | 'incluida';

/**
 * Lo que falla del control de una tabla leida, o una lista vacia si esta bien: 11 filas de la A a la K, topes de
 * ingresos que crecen y cuotas que son la suma de impuesto integrado, SIPA y obra social.
 */
export function checkMonotributoTable(table: MonotributoTable): string[] {
  const problems: string[] = [];
  const letters = table.categories.map((category) => category.letter).join('');

  if (!/^\d{8}$/.test(table.validFrom)) {
    problems.push(`vigencia inválida (${table.validFrom})`);
  }

  if (letters !== MONOTRIBUTO_CATEGORY_LETTERS.join('')) {
    problems.push(`se esperaban las categorías A a K y llegaron "${letters}"`);
  }

  table.categories.forEach((category, index) => {
    const previous = table.categories[index - 1];

    if (previous && !(category.grossIncomeLimit > previous.grossIncomeLimit)) {
      problems.push(`el tope de ${category.letter} no es mayor que el de ${previous.letter}`);
    }

    const fixed = new Big(category.pensionContribution).plus(category.healthInsurance);

    for (const kind of ['services', 'sales'] as const) {
      if (!fixed.plus(category.integratedTax[kind]).eq(category.monthlyFee[kind])) {
        problems.push(`la cuota de ${kind === 'services' ? 'servicios' : 'ventas'} de ${category.letter} no suma`);
      }
    }

    const values = [
      category.areaLimitM2,
      category.energyLimitKwh,
      category.grossIncomeLimit,
      category.healthInsurance,
      category.integratedTax.sales,
      category.integratedTax.services,
      category.maxUnitPrice,
      category.pensionContribution,
      category.rentLimit,
    ];

    if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
      problems.push(`la categoría ${category.letter} tiene un valor vacío o en cero`);
    }
  });

  return problems;
}

export function findMonotributoCategory(
  table: MonotributoTable,
  letter: MonotributoCategoryLetter,
): MonotributoCategory | undefined {
  return table.categories.find((category) => category.letter === letter);
}

/** La categoria que sigue, o undefined en la K. */
export function nextMonotributoCategory(
  table: MonotributoTable,
  letter: MonotributoCategoryLetter,
): MonotributoCategory | undefined {
  const index = table.categories.findIndex((category) => category.letter === letter);

  return index < 0 ? undefined : table.categories[index + 1];
}

/** La letra escrita por la persona (`e`, ` E `), o undefined si no es una de A a K. */
export function parseMonotributoLetter(value: string): MonotributoCategoryLetter | undefined {
  const letter = value.trim().toUpperCase();

  return MONOTRIBUTO_CATEGORY_LETTERS.find((candidate) => candidate === letter);
}

/**
 * El ultimo corte en que ARCA actualiza las categorias (1/2 o 1/8) que ya paso: hoy tiene que ser posterior al
 * corte, no el mismo dia, porque ARCA publica los valores nuevos durante ese mes. Fecha ARCA (yyyymmdd).
 */
export function lastMonotributoUpdateCutoff(today: string): string {
  const year = Number(today.slice(0, 4));
  const augustFirst = `${year}0801`;
  const februaryFirst = `${year}0201`;

  if (today > augustFirst) return augustFirst;
  if (today > februaryFirst) return februaryFirst;

  return `${year - 1}0801`;
}

/**
 * El aviso de tabla vieja: hoy ya paso un corte de febrero o agosto y la tabla que se usa rige desde antes. Una
 * tabla recien leida de ARCA no lo lleva: es lo ultimo que publico ARCA, y pedir que se actualice no sirve.
 */
export function staleTableNotice(input: {
  readonly source: MonotributoTableSource;
  readonly today: string;
  readonly validFrom: string;
}): string | undefined {
  if (input.source === 'arca' || input.validFrom >= lastMonotributoUpdateCutoff(input.today)) {
    return undefined;
  }

  const which = input.source === 'guardada' ? 'La tabla guardada' : 'La tabla incluida en ARCLI';

  return `ARCA actualiza las categorías en febrero y agosto. ${which} es del ${formatArcaDateAsArgentineDate(input.validFrom)} y puede haber una nueva. Actualizala con \`arcli monotributo --actualizar\`.`;
}
