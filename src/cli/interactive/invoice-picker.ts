import { Separator } from '@inquirer/select';

import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import { formatNoVouchersEmitted, formatVoucherWithArticle } from '../../modules/billing/billing.mappers';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { BACK, type Back } from '../../modules/interactive/wizard';
import {
  fetchVouchersBackwards,
  type IssuedVoucher,
  RECENT_VOUCHERS_LIMIT,
} from '../../modules/vouchers/voucher-history';
import { formatVoucherNumber, formatVoucherPickerRows } from '../../modules/vouchers/voucher-history.presenter';
import { colorize, noticePanel, statusBarWidth, uiSymbol, writeTerminalOutput } from '../../ui';
import { withSpinner } from '../spinner';

import { askTextStep, type Choice, chooseStep, chooseStepWhileLoading, eraseLastAnswer, fitPageSize } from './prompts';
import type { InteractiveSession } from './session';

/** Comprobante elegido y el punto de venta donde se emitio (a mano puede ser otro que el configurado). */
export interface PickedVoucher<T> {
  readonly invoice: T;
  readonly pointOfSale: number;
}

export type PickedInvoice = PickedVoucher<IssuedVoucher>;

/**
 * De donde salen los comprobantes de la lista: wsfe para A, B y C, wsfex para la E. Cada uno sabe pedir el ultimo
 * numero, pedir uno y armar las filas.
 */
export interface VoucherSource<T extends { readonly number: number }> {
  getLastNumber(pointOfSale: number): Promise<number>;
  getVoucher(number: number, pointOfSale: number): Promise<T | null | undefined>;
  formatRows(pointOfSale: number, vouchers: readonly T[], separator: string, width: number): string[];
}

/** Solo el nombre y la familia: tambien la E, que no es un VoucherKindDefinition. */
type PickerVoucherKind = Pick<VoucherKindDefinition, 'family'> & { readonly displayName: string };

interface PickVoucherOptions<T> {
  readonly message: string;
  /**
   * Modo explorar: en vez de devolver el elegido, lo pasa aca y vuelve a mostrar la lista sin perder lo cargado.
   * Solo se sale con "Volver".
   */
  readonly onPick?: (picked: PickedVoucher<T>) => Promise<void> | void;
  readonly pointOfSale: number;
  readonly voucherKind: PickerVoucherKind;
}

interface PickInvoiceOptions extends PickVoucherOptions<IssuedVoucher> {
  readonly voucherKind: VoucherKindDefinition;
}

const LOAD_MORE = 'cargar-mas';
const BY_NUMBER = 'a-mano';

type PickerChoice<T> = T | typeof BY_NUMBER | typeof LOAD_MORE;

/** Separa las columnas de cada fila del listado. */
const COLUMN_SEPARATOR = ` ${uiSymbol('separator')} `;

/**
 * Linea punteada tenue que enmarca el listado, del mismo ancho que la barra de estado de ARCA.
 * @inquirer deja un espacio antes de cada separador; por eso se resta uno al ancho.
 */
function listRule(): Separator {
  return new Separator(colorize(uiSymbol('rule').repeat(statusBarWidth() - 1), 'muted'));
}

function validatePositiveInteger(label: string): (value: string) => string | true {
  return (value) => {
    const number = parseStrictInteger(value);

    return number !== undefined && number > 0 ? true : `${label} tiene que ser un número entero mayor a 0.`;
  };
}

/** Pide punto de venta y numero, y lo busca en ARCA. Volver o un comprobante inexistente vuelven a la lista. */
async function askVoucherByNumber<T extends { readonly number: number }>(
  source: VoucherSource<T>,
  voucherKind: PickerVoucherKind,
  defaultPointOfSale: number,
): Promise<Back | PickedVoucher<T>> {
  const pointOfSaleAnswer = await askTextStep('Punto de venta:', {
    defaultValue: String(defaultPointOfSale),
    validate: validatePositiveInteger('El punto de venta'),
  });

  if (pointOfSaleAnswer === BACK) {
    return BACK;
  }

  const numberAnswer = await askTextStep('Número:', { validate: validatePositiveInteger('El número') });

  if (numberAnswer === BACK) {
    return BACK;
  }

  const pointOfSale = Number(pointOfSaleAnswer.trim());
  const number = Number(numberAnswer.trim());
  const invoice = await withSpinner('Buscando en ARCA...', () => source.getVoucher(number, pointOfSale));

  if (!invoice) {
    writeTerminalOutput(
      noticePanel(
        `No existe ${formatVoucherWithArticle(voucherKind)} N° ${formatVoucherNumber(pointOfSale, number)}.`,
        'warning',
      ),
    );

    return BACK;
  }

  return { invoice, pointOfSale };
}

/** Un comprobante A, B o C emitido, por wsfe. Ver `pickVoucher`. */
export async function pickInvoice(
  session: InteractiveSession,
  options: PickInvoiceOptions,
): Promise<Back | PickedInvoice> {
  const { historyGateway } = session;
  const { arcaType } = options.voucherKind;

  return pickVoucher(session, options, {
    formatRows: formatVoucherPickerRows,
    getLastNumber: (pointOfSale) => historyGateway.getLastNumber(pointOfSale, arcaType),
    getVoucher: (number, pointOfSale) => historyGateway.getVoucher(number, pointOfSale, arcaType),
  });
}

/**
 * Elegir un comprobante emitido: los ultimos del punto de venta configurado, con opciones para cargar mas
 * o ingresar el numero a mano (por ejemplo, uno viejo o de otro punto de venta).
 */
export async function pickVoucher<T extends { readonly number: number }>(
  session: InteractiveSession,
  options: PickVoucherOptions<T>,
  source: VoucherSource<T>,
): Promise<Back | PickedVoucher<T>> {
  const { message, onPick, pointOfSale, voucherKind } = options;
  // Comprobantes por tanda: los primeros y cada "cargar mas".
  const pageSize = session.runtime.config.comprobantesPorLista ?? RECENT_VOUCHERS_LIMIT;
  const listFrom = (fromNumber: number): Promise<T[]> =>
    fetchVouchersBackwards(fromNumber, (number) => source.getVoucher(number, pointOfSale), { limit: pageSize });
  const { invoices, lastNumber } = await withSpinner('Buscando en ARCA...', async () => {
    const last = await source.getLastNumber(pointOfSale);

    return { invoices: await listFrom(last), lastNumber: last };
  });
  // Proximo numero a consultar al cargar mas.
  let nextNumber = lastNumber - pageSize;
  let defaultChoice: PickerChoice<T> | undefined;

  if (invoices.length === 0) {
    writeTerminalOutput(
      noticePanel(`${formatNoVouchersEmitted(voucherKind)} en el punto de venta ${pointOfSale}.`, 'warning'),
    );
  }

  // Tanda pedida a ARCA con "cargar mas" mientras la lista sigue en pantalla.
  let loading: Promise<T[]> | undefined;

  for (;;) {
    const choices: Array<Choice<PickerChoice<T>> | Separator> = [];

    // El listado y "cargar mas" van entre lineas punteadas; buscar a mano queda afuera.
    if (invoices.length > 0) {
      // Las filas llegan hasta el final de la linea punteada; el cursor "❯ " ocupa dos columnas.
      const rows = source.formatRows(pointOfSale, invoices, COLUMN_SEPARATOR, statusBarWidth() - 2);

      choices.push(
        listRule(),
        ...invoices.map((item, index) => ({
          name: rows[index] ?? '',
          // Al elegirla queda solo el numero, no la fila entera.
          short: formatVoucherNumber(pointOfSale, item.number),
          value: item,
        })),
      );

      if (loading) {
        choices.push(new Separator(' '), new Separator(colorize(` Cargando${uiSymbol('ellipsis')}`, 'muted')));
      } else if (nextNumber > 0) {
        choices.push(new Separator(' '), { name: `+ Cargar más${uiSymbol('ellipsis')}`, value: LOAD_MORE });
      }

      choices.push(listRule(), new Separator(' '));
    }

    choices.push({
      description: 'Uno más viejo o de otro punto de venta',
      name: `# Ingresar el número a mano${uiSymbol('ellipsis')}`,
      value: BY_NUMBER,
    });

    // +2: el separador y "Volver" que agrega chooseStep.
    const pageSizeOnScreen = fitPageSize(choices.length + 2);
    let answer: Back | PickerChoice<T>;

    if (loading) {
      const result = await chooseStepWhileLoading(message, choices, defaultChoice, pageSizeOnScreen, loading);

      loading = undefined;

      if ('loaded' in result) {
        nextNumber -= pageSize;
        // El cursor queda en el primero nuevo; si no vino ninguno, en "cargar mas" o "a mano".
        defaultChoice = result.loaded[0] ?? (nextNumber > 0 ? LOAD_MORE : BY_NUMBER);
        invoices.push(...result.loaded);
        continue;
      }

      // Se eligio otra opcion antes de que terminara la carga: lo que llegue se descarta.
      answer = result.answer;
    } else {
      answer = await chooseStep(message, choices, defaultChoice, pageSizeOnScreen);
    }

    if (answer === BACK) {
      return BACK;
    }

    if (answer === LOAD_MORE) {
      // La misma lista se vuelve a dibujar en su lugar, con "Cargando…" en vez del boton.
      eraseLastAnswer();
      loading = listFrom(nextNumber);
      defaultChoice = invoices.at(-1);
      continue;
    }

    let picked: PickedVoucher<T>;

    if (answer === BY_NUMBER) {
      const byNumber = await askVoucherByNumber(source, voucherKind, pointOfSale);

      if (byNumber === BACK) {
        defaultChoice = BY_NUMBER;
        continue;
      }

      picked = byNumber;
    } else {
      picked = { invoice: answer, pointOfSale };
    }

    if (!onPick) {
      return picked;
    }

    await onPick(picked);
    defaultChoice = answer;
  }
}
