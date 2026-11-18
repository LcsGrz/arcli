import { z } from 'zod';

import {
  checkMonotributoTable,
  MONOTRIBUTO_CATEGORY_LETTERS,
  type MonotributoCategory,
  type MonotributoTable,
} from './monotributo';

/**
 * Una categoria con los nombres del `--json` (contrato publico). La tabla guardada en la carpeta de config usa la
 * misma forma, asi se lee con el mismo esquema.
 */
export interface MonotributoCategoryJson {
  readonly alquileresHasta: number;
  readonly aporteSipa: number;
  readonly categoria: string;
  readonly cuotaMensual: { readonly servicios: number; readonly ventas: number };
  readonly energiaHastaKwh: number;
  readonly impuestoIntegrado: { readonly servicios: number; readonly ventas: number };
  readonly ingresosBrutosHasta: number;
  readonly obraSocial: number;
  readonly precioUnitarioMaximo: number;
  readonly superficieHastaM2: number;
}

export function serializeMonotributoCategory(category: MonotributoCategory): MonotributoCategoryJson {
  return {
    categoria: category.letter,
    ingresosBrutosHasta: category.grossIncomeLimit,
    superficieHastaM2: category.areaLimitM2,
    energiaHastaKwh: category.energyLimitKwh,
    alquileresHasta: category.rentLimit,
    precioUnitarioMaximo: category.maxUnitPrice,
    impuestoIntegrado: { servicios: category.integratedTax.services, ventas: category.integratedTax.sales },
    aporteSipa: category.pensionContribution,
    obraSocial: category.healthInsurance,
    cuotaMensual: { servicios: category.monthlyFee.services, ventas: category.monthlyFee.sales },
  };
}

const amount = z.number();
const servicesAndSales = z.object({ servicios: amount, ventas: amount });

const categoryJsonSchema = z.object({
  alquileresHasta: amount,
  aporteSipa: amount,
  categoria: z.enum(MONOTRIBUTO_CATEGORY_LETTERS),
  cuotaMensual: servicesAndSales,
  energiaHastaKwh: amount,
  impuestoIntegrado: servicesAndSales,
  ingresosBrutosHasta: amount,
  obraSocial: amount,
  precioUnitarioMaximo: amount,
  superficieHastaM2: amount,
});

export const monotributoTableJsonSchema = z.object({
  categorias: z.array(categoryJsonSchema),
  vigenteDesde: z.string().regex(/^\d{8}$/),
});

export type MonotributoTableJson = z.infer<typeof monotributoTableJsonSchema>;

export function serializeMonotributoTable(table: MonotributoTable): MonotributoTableJson {
  return {
    categorias: table.categories.map(serializeMonotributoCategory) as MonotributoTableJson['categorias'],
    vigenteDesde: table.validFrom,
  };
}

/** Una tabla guardada, o undefined si no tiene la forma o no pasa el control de consistencia. */
export function deserializeMonotributoTable(value: unknown): MonotributoTable | undefined {
  const result = monotributoTableJsonSchema.safeParse(value);

  if (!result.success) return undefined;

  const table: MonotributoTable = {
    categories: result.data.categorias.map((item) => ({
      areaLimitM2: item.superficieHastaM2,
      energyLimitKwh: item.energiaHastaKwh,
      grossIncomeLimit: item.ingresosBrutosHasta,
      healthInsurance: item.obraSocial,
      integratedTax: { sales: item.impuestoIntegrado.ventas, services: item.impuestoIntegrado.servicios },
      letter: item.categoria,
      maxUnitPrice: item.precioUnitarioMaximo,
      monthlyFee: { sales: item.cuotaMensual.ventas, services: item.cuotaMensual.servicios },
      pensionContribution: item.aporteSipa,
      rentLimit: item.alquileresHasta,
    })),
    validFrom: result.data.vigenteDesde,
  };

  return checkMonotributoTable(table).length === 0 ? table : undefined;
}
