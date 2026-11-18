import { formatArgentineMoney } from '../../lib/numbers/argentine-amount';
import { uiSymbol } from '../../ui/primitives';
import type { MonotributoCategoryLetter, MonotributoTable } from '../monotributo/monotributo';

/** Lo que se puede hacer despues de ver la tabla en "Categorías del monotributo". */
export type MonotributoAction = 'actualizar' | 'categoria' | 'columnas';

interface MenuChoice<T> {
  readonly description?: string;
  readonly name: string;
  readonly short?: string;
  readonly value: T;
}

/** "¿Y ahora?": las mismas vistas que `--categoria`, `--completa` y `--actualizar`. */
export function monotributoActionChoices(): ReadonlyArray<MenuChoice<MonotributoAction>> {
  return [
    {
      description: 'Límites anuales, cuota mensual y su desglose',
      name: 'Ver una categoría completa',
      value: 'categoria',
    },
    {
      description: 'Límites anuales y cuota mensual de todas, un bloque por vez',
      name: 'Ver todas las columnas',
      value: 'columnas',
    },
    {
      description: 'Volver a leer la tabla en la página de ARCA',
      name: 'Actualizar desde ARCA',
      value: 'actualizar',
    },
  ];
}

/** Una opcion por categoria, con su tope; la propia lo dice. */
export function monotributoCategoryChoices(
  table: MonotributoTable,
  ownCategory: MonotributoCategoryLetter | null,
): ReadonlyArray<MenuChoice<MonotributoCategoryLetter>> {
  const separator = uiSymbol('separator');

  return table.categories.map((category) => ({
    name: `${category.letter} ${separator} hasta ${formatArgentineMoney(category.grossIncomeLimit)}${category.letter === ownCategory ? ' (tu categoría)' : ''}`,
    short: category.letter,
    value: category.letter,
  }));
}

/** La ayuda de teclas de "Ver todas las columnas": `[tecla, accion]`. */
export function monotributoBlockKeys(): ReadonlyArray<readonly [string, string]> {
  return [
    [`${uiSymbol('moreLeft')}${uiSymbol('moreRight')}`, 'cambiar de bloque'],
    [uiSymbol('keyEnter'), 'volver al menú'],
  ];
}
