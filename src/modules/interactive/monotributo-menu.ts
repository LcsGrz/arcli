import { formatArgentineMoney } from '../../lib/numbers/argentine-amount';
import { uiSymbol } from '../../ui/primitives';
import type { MonotributoCategoryLetter, MonotributoTable } from '../monotributo/monotributo';
import {
  enterMonotributoColumnWindow,
  type MonotributoBlock,
  type MonotributoColumnWindow,
  type MonotributoReport,
  moveMonotributoColumnWindow,
} from '../monotributo/monotributo.presenter';

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

/**
 * La ayuda de teclas de "Ver todas las columnas": `[tecla, accion]`. Con `columns` (un bloque no entra y va por
 * ventana), ←/→ tambien corren las columnas.
 */
export function monotributoBlockKeys({ columns = false } = {}): ReadonlyArray<readonly [string, string]> {
  return [
    [`${uiSymbol('moreLeft')}${uiSymbol('moreRight')}`, columns ? 'ver las otras columnas' : 'cambiar de bloque'],
    [uiSymbol('keyEnter'), 'volver al menú'],
  ];
}

/** Lo que ←/→ hacen adentro de un bloque de "Ver todas las columnas" (ver `browseBlocks`). */
export interface MonotributoColumnViews {
  readonly enter: (block: MonotributoBlock, side: 'left' | 'right') => MonotributoColumnWindow | undefined;
  readonly move: (
    block: MonotributoBlock,
    window: MonotributoColumnWindow,
    direction: 'left' | 'right',
  ) => MonotributoColumnWindow | undefined;
}

/**
 * "Ver todas las columnas" cuando un bloque no entra a lo ancho: una ventana de columnas con CAT. fija que ←/→ corren
 * de a una, con la nueva pegada al lado hacia el que te moviste. Pasada la ultima (o antes de la primera) sigue el
 * otro bloque, desde el lado por el que se entra. Sin ventana (entran todas, o ni una), ←/→ cambian de bloque.
 */
export function monotributoColumnViews(report: MonotributoReport): MonotributoColumnViews {
  return {
    enter: (block, side) => enterMonotributoColumnWindow(report, block, side),
    move: (block, window, direction) => moveMonotributoColumnWindow(report, block, window, direction),
  };
}
