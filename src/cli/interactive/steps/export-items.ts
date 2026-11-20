import { formatMoneyLabel } from '../../../modules/billing/billing.labels';
import { sumExportItems } from '../../../modules/export/export.items';
import { exportTextFieldError } from '../../../modules/export/export.mappers';
import {
  DEFAULT_EXPORT_UNIT_CODE,
  EXPORT_TOTAL_ONLY_UNIT_CODES,
  type ExportItemInput,
  type ExportUnit,
} from '../../../modules/export/export.types';
import { amountInputText, parseExchangeRateInput } from '../../../modules/interactive/amount-input';
import {
  applyExportItemEdits,
  describeExportItem,
  FIRST_EXPORT_ITEM_DEFAULTS,
} from '../../../modules/interactive/export-items';
import type { RowEdits } from '../../../modules/interactive/row-marks';
import { amountQuestion } from '../../../modules/interactive/steps/amount';
import type { Lens } from '../../../modules/interactive/steps/lens';
import { BACK, type Back, type WizardDependency, type WizardStep } from '../../../modules/interactive/wizard';
import { withSpinner } from '../../spinner';
import { askTextStep, chooseFromFilterList, chooseStep, editRowsStep } from '../prompts';
import { validateItemNumber } from '../validators';

export interface ExportItemsStepDef<S> {
  readonly items: Lens<S, readonly ExportItemInput[]>;
  /** La moneda de los precios, como la nombran las preguntas ("Precio unitario en USD:"). */
  readonly currency: (state: S) => string;
  /** La tabla de unidades de WSFEX: se consulta una vez por flujo. */
  readonly units: () => Promise<readonly ExportUnit[]>;
  /**
   * Los items con los que arranca el editor, si todavia no se cargaron: los de la factura que se repite o los del
   * asociado de una nota. Sin esto, se pregunta el primero.
   */
  readonly initial?: (state: S) => readonly ExportItemInput[];
  /** Si el total se puede confirmar (por ejemplo, el tope de una NC); si no, el motivo. */
  readonly validateTotal?: (state: S) => (total: number) => string | true;
  /** Lo que nombra el total: "la factura", "la nota de crédito". */
  readonly voucher: string;
  readonly dependsOn?: readonly WizardDependency[];
}

/** Como en `--item`: sin `|` (separa las partes) y hasta 4000 caracteres (1770). */
function validateItemDescription(value: string, allowEmpty: boolean): string | true {
  if (!value.trim()) {
    return allowEmpty ? true : 'Cada ítem necesita una descripción.';
  }

  if (value.includes('|')) {
    return 'La descripción no puede llevar "|".';
  }

  return exportTextFieldError('description', value) ?? true;
}

/** Como se carga un item: el primero (con valores por defecto), uno mas (Enter vacio termina) o uno que se modifica. */
type ItemMode = 'edit' | 'first' | 'more';

interface ItemQuestion {
  readonly currency: string;
  readonly mode: ItemMode;
  /** El numero del item, desde 1. */
  readonly position: number;
  /** Lo que tenia, si se modifica. */
  readonly start?: ExportItemInput;
  readonly units: readonly ExportUnit[];
}

function descriptionQuestion(question: ItemQuestion): string {
  return question.mode === 'more'
    ? `Descripción del ítem ${question.position} (Enter para terminar):`
    : `Descripción del ítem ${question.position}:`;
}

/**
 * Sin 0, 97 (sena o anticipo) ni 99 (bonificacion): van sin cantidad ni precio (1775) y ARCLI todavia no las acepta.
 * Se busca por nombre o por codigo.
 */
function unitRows(units: readonly ExportUnit[]) {
  return units
    .filter((entry) => !EXPORT_TOTAL_ONLY_UNIT_CODES.includes(entry.id))
    .map((entry) => ({ keywords: String(entry.id), label: entry.name, value: entry.id }));
}

/**
 * Un item, pregunta por pregunta: descripcion, cantidad, unidad y precio unitario. Esc vuelve a la pregunta anterior
 * del item, con lo escrito; desde la descripcion, devuelve BACK. En `more`, Enter vacio en la descripcion termina
 * (`done`).
 */
async function askItem(question: ItemQuestion): Promise<Back | ExportItemInput | 'done'> {
  const { mode, start } = question;
  const typed: TypedItem = {
    description: start?.description,
    quantity: start ? amountInputText(start.quantity) : undefined,
    unit: typeof start?.unit === 'number' ? start.unit : undefined,
    unitPrice: start ? amountInputText(start.unitPrice) : undefined,
  };
  const rows = unitRows(question.units);
  let index = 0;

  while (index < 4) {
    const answer = await askItemPart(index, question, typed, rows);

    if (answer === BACK) {
      if (index === 0) {
        return BACK;
      }

      // La unidad sin tabla no se pregunta: Esc en el precio vuelve a la cantidad.
      index -= index === 3 && rows.length === 0 ? 2 : 1;
      continue;
    }

    if (index === 0 && mode === 'more' && !typed.description?.trim()) {
      return 'done';
    }

    index += 1;
  }

  return {
    ...(start?.code ? { code: start.code } : {}),
    description: (typed.description ?? '').trim(),
    quantity: parseExchangeRateInput(typed.quantity ?? '') ?? 0,
    unit: typed.unit ?? DEFAULT_EXPORT_UNIT_CODE,
    unitPrice: parseExchangeRateInput(typed.unitPrice ?? '') ?? 0,
  };
}

/** Lo escrito en cada pregunta de un item, como se tipea. */
interface TypedItem {
  description?: string;
  quantity?: string;
  unit?: number;
  unitPrice?: string;
}

/**
 * Una pregunta de texto del item: arranca con lo escrito y, vacia, es lo escrito o el valor por defecto (como lo
 * devuelve el prompt, que con algo escrito o un valor por defecto no devuelve vacio).
 */
async function askTextPart(
  message: string,
  key: 'description' | 'quantity' | 'unitPrice',
  typed: TypedItem,
  options: { readonly defaultValue?: string; readonly validate: (value: string) => string | true },
): Promise<Back | true> {
  const { defaultValue } = options;
  const fallback = typed[key]?.trim() || defaultValue;
  const answer = await askTextStep(message, {
    defaultValue,
    previousAnswer: typed[key],
    validate: (value) => (!value.trim() && fallback !== undefined ? true : options.validate(value)),
  });

  if (answer === BACK) {
    return BACK;
  }

  typed[key] = answer.trim() || fallback || '';

  return true;
}

/** Una pregunta del item (`index`): descripcion, cantidad, unidad o precio. Escribe lo respondido en `typed`. */
async function askItemPart(
  index: number,
  question: ItemQuestion,
  typed: TypedItem,
  rows: ReturnType<typeof unitRows>,
): Promise<Back | true> {
  const first = question.mode === 'first';

  if (index === 0) {
    return askTextPart(descriptionQuestion(question), 'description', typed, {
      defaultValue: first ? FIRST_EXPORT_ITEM_DEFAULTS.description : undefined,
      validate: (value) => validateItemDescription(value, question.mode === 'more'),
    });
  }

  if (index === 1) {
    return askTextPart('Cantidad:', 'quantity', typed, {
      defaultValue: first ? String(FIRST_EXPORT_ITEM_DEFAULTS.quantity) : undefined,
      validate: validateItemNumber('La cantidad'),
    });
  }

  if (index === 3) {
    // Con cantidad 1 el precio es el importe del renglon: el camino rapido de un servicio (descripcion, Enter, Enter,
    // importe).
    const label = parseExchangeRateInput(typed.quantity ?? '') === 1 ? 'Importe' : 'Precio unitario';

    return askTextPart(amountQuestion(label, question.currency), 'unitPrice', typed, {
      validate: validateItemNumber('El precio'),
    });
  }

  // Sin la tabla de ARCA, la unidad por defecto, como el CLI sin la quinta parte de `--item`.
  if (rows.length === 0) {
    typed.unit = DEFAULT_EXPORT_UNIT_CODE;

    return true;
  }

  const unit = await chooseFromFilterList('Unidad:', rows, {
    defaultValue: typed.unit ?? FIRST_EXPORT_ITEM_DEFAULTS.unit,
    help: 'Escribí el nombre o el código de ARCA, por ejemplo "litros" o "5".',
  });

  if (unit === BACK) {
    return BACK;
  }

  typed.unit = unit;

  return true;
}

/**
 * Del item `items.length + 1` en adelante, hasta Enter vacio en la descripcion. BACK si se vuelve desde la descripcion
 * de uno nuevo; `onChange` recibe la lista cada vez que se suma uno.
 */
async function askMoreItems(
  items: readonly ExportItemInput[],
  question: Omit<ItemQuestion, 'mode' | 'position' | 'start'>,
  onChange: (items: readonly ExportItemInput[]) => void = () => undefined,
): Promise<Back | ExportItemInput[]> {
  const loaded = [...items];

  for (;;) {
    const item = await askItem({ ...question, mode: 'more', position: loaded.length + 1 });

    if (item === BACK) {
      return BACK;
    }

    if (item === 'done') {
      return loaded;
    }

    loaded.push(item);
    onChange(loaded);
  }
}

/**
 * Lo marcado en el editor, aplicado: se borran los rojos, se vuelve a preguntar cada uno marcado para modificar
 * (arrancando con sus valores) y, si se eligio, se agregan nuevos. Esc en cualquier pregunta deja todo como estaba.
 */
async function applyEdits(
  items: readonly ExportItemInput[],
  edits: RowEdits,
  question: Omit<ItemQuestion, 'mode' | 'position' | 'start'>,
): Promise<Back | ExportItemInput[]> {
  const applied = applyExportItemEdits(items, edits);
  const next = [...applied.items];

  for (const index of applied.edit) {
    const item = await askItem({ ...question, mode: 'edit', position: index + 1, start: next[index] });

    if (item === BACK || item === 'done') {
      return BACK;
    }

    next[index] = item;
  }

  return edits.add ? askMoreItems(next, question) : next;
}

type TotalChoice = 'confirmar' | 'modificar';

function itemsCount(count: number): string {
  return count === 1 ? '1 ítem' : `${count} ítems`;
}

/** El total con sus dos opciones: confirmarlo o modificar los items. Si no se puede confirmar, dice por que. */
async function askTotal(
  items: readonly ExportItemInput[],
  currency: string,
  voucher: string,
  valid: string | true,
): Promise<Back | TotalChoice> {
  const total = sumExportItems(items);

  return chooseStep<TotalChoice>(
    `Importe total de ${voucher}: ${formatMoneyLabel(total, currency)} (${itemsCount(items.length)})`,
    [
      { disabled: valid === true ? false : valid, name: 'Confirmar', value: 'confirmar' },
      { description: 'Modificar, borrar o agregar ítems', name: 'Modificar los ítems', value: 'modificar' },
    ],
    valid === true ? 'confirmar' : 'modificar',
  );
}

const EDITOR_QUESTION = '¿Qué ítems cambiamos? (espacio para modificar, Backspace para borrar)';
const EDITOR_OPTIONS = {
  addLabel: '+ Agregar ítem',
  minRows: 1,
  minRowsNotice:
    'Queda al menos un ítem: ARCA no acepta un comprobante sin ítems. Para cambiarlo, modificalo con espacio.',
};

/**
 * Los items de la E (NAV-10): ARCA exige al menos uno y el total es su suma, asi que no se pregunta el monto. Si no hay
 * items cargados ni copiados, pregunta el primero (con "Según detalle", 1 y unidades por defecto) y los siguientes hasta
 * Enter vacio. Despues muestra el total: confirmarlo o modificar los items en el editor (`editRowsStep`), que vuelve al
 * total. Con items cargados (al volver al paso) o copiados (Repetir, notas), arranca en el editor.
 *
 * El memo guarda la ultima lista, terminada o a medias: al volver al paso arranca con ella.
 */
export function exportItemsStep<S>(def: ExportItemsStepDef<S>): WizardStep<S> {
  let units: Promise<readonly ExportUnit[]> | undefined;

  return {
    dependsOn: def.dependsOn,
    name: 'items',
    run: async (state, { memo, previous }) => {
      units ??= withSpinner('Consultando las unidades de WSFEX...', def.units);

      const question = { currency: def.currency(state), units: await units };
      const answered = previous ? def.items.get(previous as S) : undefined;
      let items: readonly ExportItemInput[] =
        memo.get<readonly ExportItemInput[]>() ?? answered ?? def.initial?.(state) ?? [];
      const remember = (list: readonly ExportItemInput[]) => {
        items = list;
        memo.set<readonly ExportItemInput[]>([...list]);
      };
      let screen: 'editor' | 'total' = 'editor';
      // Esc en el editor vuelve al total si se llego desde ahi; si se arranco en el editor, al paso anterior.
      let fromTotal = false;

      if (items.length === 0) {
        const first = await askItem({ ...question, mode: 'first', position: 1 });

        if (first === BACK || first === 'done') {
          return BACK;
        }

        remember([first]);

        const more = await askMoreItems(items, question, remember);

        if (more === BACK) {
          return BACK;
        }

        remember(more);
        screen = 'total';
      }

      for (;;) {
        if (screen === 'total') {
          const choice = await askTotal(
            items,
            question.currency,
            def.voucher,
            def.validateTotal?.(state)(sumExportItems(items)) ?? true,
          );

          if (choice === BACK) {
            return BACK;
          }

          if (choice === 'confirmar') {
            return def.items.set([...items], state);
          }

          screen = 'editor';
          fromTotal = true;
          continue;
        }

        const edits = await editRowsStep(
          EDITOR_QUESTION,
          items.map((item) => describeExportItem(item, question.units, question.currency)),
          EDITOR_OPTIONS,
        );

        if (edits === BACK) {
          if (!fromTotal) {
            return BACK;
          }

          screen = 'total';
          continue;
        }

        const applied = await applyEdits(items, edits, question);

        if (applied !== BACK) {
          remember(applied);
          screen = 'total';
          fromTotal = false;
        }
      }
    },
    writes: ['items'],
  };
}
