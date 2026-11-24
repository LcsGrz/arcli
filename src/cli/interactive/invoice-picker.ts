import { Separator } from '@inquirer/core';

import { classifyAssociatedPointOfSale } from '../../modules/billing/billing.associated-lookup';
import { formatNoVouchersEmitted, formatVoucherWithArticle } from '../../modules/billing/billing.mappers';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { resolveRowsPerList } from '../../modules/config/config.schemas';
import { formatExportVoucherPickerRows } from '../../modules/export/export.history.presenter';
import type { ExportGateway, ExportIssuedVoucher, ExportVoucherKind } from '../../modules/export/export.types';
import type { OtherSystemInvoice } from '../../modules/interactive/note-input';
import { validatePositiveInteger } from '../../modules/interactive/validators';
import { BACK, type Back } from '../../modules/interactive/wizard';
import { fetchVouchersBackwards, type IssuedVoucher, VoucherQueryError } from '../../modules/vouchers/voucher-history';
import { formatVoucherPickerRows } from '../../modules/vouchers/voucher-history.presenter';
import { formatVoucherNumber } from '../../modules/vouchers/voucher-number';
import { ArcaParametersGateway } from '../../services/arca/arca-parameters.gateway';
import { colorize, noticePanel, statusBarWidth, uiSymbol, writeTerminalError, writeTerminalOutput } from '../../ui';
import { formatCliError } from '../error-output';
import { withSpinner } from '../spinner';

import { PinnedSeparator } from './list-select';
import {
  askTextStep,
  type Choice,
  chooseStep,
  chooseStepWhileLoading,
  eraseLastAnswer,
  fitPageSize,
  type ListSelectState,
  type LoadingResult,
} from './prompts';
import type { InteractiveSession } from './session';

/** Comprobante elegido y el punto de venta donde se emitio (a mano puede ser otro que el configurado). */
export interface PickedVoucher<T> {
  readonly invoice: T;
  readonly pointOfSale: number;
}

export type PickedInvoice = PickedVoucher<IssuedVoucher>;

/** Lo que pasa con un comprobante ingresado a mano que no existe: el aviso y, si igual sirve, lo que se devuelve. */
interface MissingVoucher<M> {
  readonly accepted?: M;
  readonly notice: string;
}

/**
 * De donde salen los comprobantes de la lista: wsfe para A, B y C, wsfex para la E. Cada uno sabe pedir el ultimo
 * numero, pedir uno y armar las filas. `M` es lo que se devuelve si un comprobante que no existe igual sirve.
 */
interface VoucherSource<T extends { readonly number: number }, M = never> {
  getLastNumber(pointOfSale: number): Promise<number>;
  getVoucher(number: number, pointOfSale: number): Promise<T | null | undefined>;
  formatRows(pointOfSale: number, vouchers: readonly T[], separator: string, width: number): string[];
  /**
   * Si el comprobante ingresado a mano no existe y hay algo mas que decir que "No existe", o igual sirve. Con
   * `queryFailed`, ARCA contesto con un error y no se sabe si existe: sin respuesta, se muestra ese error.
   */
  describeMissing?(pointOfSale: number, number: number, queryFailed: boolean): Promise<MissingVoucher<M> | undefined>;
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
  /** El elegido la vez anterior, al volver a la pregunta: arranca marcado (o escrito, si se ingreso a mano). */
  readonly previous?: { readonly number: number; readonly pointOfSale: number };
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

/** Punto de venta y numero, a mano: volver desde el numero vuelve al punto de venta, con lo escrito. */
async function askPointOfSaleAndNumber(
  defaultPointOfSale: number,
  previous?: { readonly number: number; readonly pointOfSale: number },
): Promise<{ readonly number: number; readonly pointOfSale: number } | undefined> {
  let typedPointOfSale = previous ? String(previous.pointOfSale) : undefined;

  for (;;) {
    const pointOfSale = await askTextStep('Punto de venta:', {
      defaultValue: String(defaultPointOfSale),
      previousAnswer: typedPointOfSale,
      validate: validatePositiveInteger('El punto de venta'),
    });

    if (pointOfSale === BACK) {
      return undefined;
    }

    typedPointOfSale = pointOfSale;

    const number = await askTextStep('Número:', {
      previousAnswer: previous ? String(previous.number) : undefined,
      validate: validatePositiveInteger('El número'),
    });

    if (number !== BACK) {
      return { number: Number(number.trim()), pointOfSale: Number(pointOfSale.trim()) };
    }
  }
}

/**
 * Con la lista en pantalla, si ARCA contesta con un error (`VoucherQueryError`) se muestra y se sigue en la
 * lista, sin perder lo cargado. Los demas errores salen al menu, como siempre.
 */
async function orShowQueryError<T>(search: () => Promise<T>): Promise<T | undefined> {
  try {
    return await search();
  } catch (error) {
    if (!(error instanceof VoucherQueryError)) {
      throw error;
    }

    writeTerminalError(() => formatCliError(error, false));

    return undefined;
  }
}

/**
 * Pide punto de venta y numero, y lo busca en ARCA. Volver, un comprobante inexistente o un error de ARCA vuelven a la
 * lista, salvo que la fuente acepte el inexistente igual (`describeMissing`).
 */
async function askVoucherByNumber<T extends { readonly number: number }, M>(
  source: VoucherSource<T, M>,
  voucherKind: PickerVoucherKind,
  defaultPointOfSale: number,
  previous?: { readonly number: number; readonly pointOfSale: number },
): Promise<Back | PickedVoucher<T> | { readonly accepted: M }> {
  const typed = await askPointOfSaleAndNumber(defaultPointOfSale, previous);

  if (!typed) {
    return BACK;
  }

  const { number, pointOfSale } = typed;
  const search = await orShowQueryError(() =>
    withSpinner('Buscando en ARCA...', async () => {
      try {
        const found = await source.getVoucher(number, pointOfSale);

        return {
          invoice: found,
          missing: found ? undefined : await source.describeMissing?.(pointOfSale, number, false),
        };
      } catch (error) {
        const missing =
          error instanceof VoucherQueryError ? await source.describeMissing?.(pointOfSale, number, true) : undefined;

        if (!missing) {
          throw error;
        }

        return { invoice: undefined, missing };
      }
    }),
  );

  if (!search) {
    return BACK;
  }

  const { invoice, missing } = search;

  if (!invoice) {
    writeTerminalOutput(
      noticePanel(
        missing?.notice ??
          `No existe ${formatVoucherWithArticle(voucherKind)} N° ${formatVoucherNumber(pointOfSale, number)}.`,
        'warning',
      ),
    );

    return missing?.accepted === undefined ? BACK : { accepted: missing.accepted };
  }

  return { invoice, pointOfSale };
}

/**
 * Una factura que ARCA no tiene, en un punto de venta que no es de web service: el asistente no puede copiar sus
 * datos, asi que los pregunta (ver `noteSteps`).
 *
 * @internal Exportado para los tests.
 */
export function missingNonWebServiceInvoiceNotice(
  voucherKind: VoucherKindDefinition,
  pointOfSale: number,
  number: number,
  origin: OtherSystemInvoice['origin'],
): string {
  const where =
    origin === 'other'
      ? `el punto de venta ${pointOfSale} no es de web service`
      : `no se pudo consultar si el punto de venta ${pointOfSale} es de web service`;

  return `ARCA no tiene ${formatVoucherWithArticle(voucherKind)} N° ${formatVoucherNumber(pointOfSale, number)} y ${where}. Si es de Comprobantes en línea o de un controlador fiscal, seguí: como no se pueden copiar sus datos, te los pregunto. Si no, volvé y revisá el número.`;
}

/** Un comprobante A, B o C emitido, por wsfe. Ver `pickVoucher`. */
export async function pickInvoice(
  session: InteractiveSession,
  options: PickInvoiceOptions,
): Promise<Back | PickedInvoice> {
  return pickVoucher(session, options, invoiceSource(session, options.voucherKind));
}

/**
 * El asociado de una nota A, B, C o FCE: como `pickInvoice`, pero si el ingresado a mano no existe (o ARCA contesta
 * con un error) y su punto de venta no es de web service (mismo criterio que `checkAssociatedInArca`), lo devuelve igual
 * para preguntar sus datos.
 */
export async function pickNoteInvoice(
  session: InteractiveSession,
  options: PickInvoiceOptions,
): Promise<Back | OtherSystemInvoice | PickedInvoice> {
  const { voucherKind } = options;

  return pickVoucher(session, options, {
    ...invoiceSource(session, voucherKind),
    describeMissing: async (pointOfSale: number, number: number, queryFailed: boolean) => {
      const origin = await classifyAssociatedPointOfSale({
        history: session.historyGateway,
        pointOfSale,
        salesPoints: new ArcaParametersGateway(session.arca),
        voucherType: voucherKind.arcaType,
      });

      return origin === 'web-service' || (queryFailed && origin === 'unknown')
        ? undefined
        : {
            accepted: { number, origin, otherSystem: true, pointOfSale },
            notice: missingNonWebServiceInvoiceNotice(voucherKind, pointOfSale, number, origin),
          };
    },
  });
}

function invoiceSource(session: InteractiveSession, voucherKind: VoucherKindDefinition): VoucherSource<IssuedVoucher> {
  const { historyGateway } = session;
  const { arcaType } = voucherKind;

  return {
    formatRows: formatVoucherPickerRows,
    getLastNumber: (pointOfSale) => historyGateway.getLastNumber(pointOfSale, arcaType),
    getVoucher: (number, pointOfSale) => historyGateway.getVoucher(number, pointOfSale, arcaType),
  };
}

/** Un comprobante E (factura o nota) emitido, por wsfex, igual que `arcli ultimos fe`. Ver `pickVoucher`. */
export async function pickExportVoucher(
  session: InteractiveSession,
  gateway: Pick<ExportGateway, 'getLastVoucherNumber' | 'getVoucher'>,
  options: PickVoucherOptions<ExportIssuedVoucher> & { readonly voucherKind: ExportVoucherKind },
): Promise<Back | PickedVoucher<ExportIssuedVoucher>> {
  const { arcaType } = options.voucherKind;

  return pickVoucher(session, options, {
    formatRows: (_pointOfSale, vouchers, separator, width) => formatExportVoucherPickerRows(vouchers, separator, width),
    getLastNumber: (pointOfSale) => gateway.getLastVoucherNumber(arcaType, pointOfSale),
    getVoucher: (number, pointOfSale) => gateway.getVoucher({ arcaType, number, pointOfSale }),
  });
}

/**
 * Elegir un comprobante emitido: los ultimos del punto de venta configurado, con opciones para cargar mas
 * o ingresar el numero a mano (por ejemplo, uno viejo o de otro punto de venta).
 */
async function pickVoucher<T extends { readonly number: number }, M = never>(
  session: InteractiveSession,
  options: PickVoucherOptions<T>,
  source: VoucherSource<T, M>,
): Promise<Back | M | PickedVoucher<T>> {
  const { message, onPick, pointOfSale, previous, voucherKind } = options;
  // Comprobantes por tanda: los primeros y cada "cargar mas".
  const pageSize = resolveRowsPerList(session.runtime.config);
  const listFrom = (fromNumber: number): Promise<T[]> =>
    fetchVouchersBackwards(fromNumber, (number) => source.getVoucher(number, pointOfSale), { limit: pageSize });
  const lastNumber = await withSpinner('Buscando en ARCA...', () => source.getLastNumber(pointOfSale));
  const firstBatch = await orShowQueryError(() => withSpinner('Buscando en ARCA...', () => listFrom(lastNumber)));
  const invoices: T[] = firstBatch ?? [];
  // La primera tanda fallo y todavia no se pudo cargar: no se sabe si hay comprobantes.
  let firstBatchPending = !firstBatch;
  // Proximo numero a consultar al cargar mas.
  let nextNumber = firstBatchPending ? lastNumber : lastNumber - pageSize;
  // Al volver a la pregunta, el elegido antes; si no esta en la lista, "a mano".
  const findPrevious = (): T | undefined =>
    previous?.pointOfSale === pointOfSale ? invoices.find((item: T) => item.number === previous.number) : undefined;
  const previousInList = findPrevious();
  let defaultChoice: Back | PickerChoice<T> | undefined =
    previous && !firstBatchPending ? (previousInList ?? BY_NUMBER) : undefined;
  // Lo escrito para filtrar y la marcada mientras la lista esta en pantalla: al terminar una carga se redibuja igual.
  // Un objeto y no dos variables: `onChange` las cambia desde el prompt, y TypeScript no lo ve.
  const onScreen: { marked?: ListSelectState<Back | PickerChoice<T>>; typed: string } = { typed: '' };
  const markedValue = () => onScreen.marked?.value;
  const listOptions = () => ({
    initialTerm: onScreen.typed,
    onChange: (state: ListSelectState<Back | PickerChoice<T>>) => {
      onScreen.typed = state.term;
      onScreen.marked = state;
    },
  });

  const warnIfEmpty = () => {
    if (invoices.length === 0) {
      writeTerminalOutput(
        noticePanel(`${formatNoVouchersEmitted(voucherKind)} en el punto de venta ${pointOfSale}.`, 'warning'),
      );
    }
  };

  if (!firstBatchPending) {
    warnIfEmpty();
  }

  // Tanda pedida a ARCA con "cargar mas" mientras la lista sigue en pantalla.
  let loading: Promise<T[]> | undefined;

  for (;;) {
    const choices: Array<Choice<PickerChoice<T>> | Separator> = [];

    // El listado y "cargar mas" van entre lineas punteadas; buscar a mano queda afuera.
    if (invoices.length > 0 || firstBatchPending) {
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
        // "Cargando…" se sigue viendo mientras se filtra.
        choices.push(new Separator(' '), new PinnedSeparator(colorize(` Cargando${uiSymbol('ellipsis')}`, 'muted')));
      } else if (nextNumber > 0) {
        choices.push(new Separator(' '), {
          name: `+ ${firstBatchPending ? 'Volver a cargar' : 'Cargar más'}${uiSymbol('ellipsis')}`,
          value: LOAD_MORE,
        });
      }

      choices.push(listRule(), new Separator(' '));
    }

    choices.push({
      description: 'Uno más viejo o de otro punto de venta',
      name: `# Ingresar el número a mano${uiSymbol('ellipsis')}`,
      value: BY_NUMBER,
    });

    const pageSizeOnScreen = fitPageSize(choices.length);
    let answer: Back | PickerChoice<T>;

    onScreen.marked = undefined;

    if (loading) {
      const batch: Promise<T[]> = loading;
      const result: LoadingResult<PickerChoice<T>, T[]> | undefined = await orShowQueryError(() =>
        chooseStepWhileLoading(message, choices, defaultChoice, pageSizeOnScreen, batch, listOptions()),
      );

      loading = undefined;

      if (!result) {
        // Como al terminar la carga, el cursor queda donde lo dejaste; si no, en el boton, para reintentar.
        defaultChoice = markedValue() ?? LOAD_MORE;
        continue;
      }

      if ('loaded' in result) {
        nextNumber -= pageSize;

        if (firstBatchPending) {
          // Como si la primera tanda llegara ahora.
          firstBatchPending = false;
          invoices.push(...result.loaded);
          warnIfEmpty();
          defaultChoice = findPrevious() ?? (previous ? BY_NUMBER : invoices[0]);
          continue;
        }

        // El cursor queda donde lo dejaste; si no lo moviste, en el primero nuevo y, si no vino ninguno, en "cargar
        // mas" o "a mano".
        defaultChoice = markedValue() ?? result.loaded[0] ?? (nextNumber > 0 ? LOAD_MORE : BY_NUMBER);
        invoices.push(...result.loaded);
        continue;
      }

      // Se eligio otra opcion antes de que terminara la carga: lo que llegue se descarta.
      answer = result.answer;
    } else {
      answer = await chooseStep(message, choices, defaultChoice, pageSizeOnScreen, listOptions());
    }

    // Lo escrito sigue solo mientras la lista se redibuja por una carga.
    if (answer !== LOAD_MORE) {
      onScreen.typed = '';
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
      const byNumber = await askVoucherByNumber(source, voucherKind, pointOfSale, previous);

      if (byNumber === BACK) {
        defaultChoice = BY_NUMBER;
        continue;
      }

      // Un comprobante que no existe pero igual sirve sale del selector, tambien en modo explorar.
      if ('accepted' in byNumber) {
        return byNumber.accepted;
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
