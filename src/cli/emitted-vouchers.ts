import type { BillingExecutionResult } from '../modules/billing/billing.types.internal';
import type { ExportExecutionResult } from '../modules/export/export.types';
import type { PdfOutcome } from '../modules/pdf/pdf.types';
import { MAX_RECENT_VOUCHERS } from '../modules/vouchers/voucher-history';

/** Lo que alcanza para nombrar un comprobante con CAE y volver a encontrarlo. */
interface EmittedVoucher {
  readonly environment: 'produccion' | 'testing';
  readonly number: number;
  readonly pointOfSale: number;
  readonly shortcut: string;
}

/** A, B, C, FCE y recibos: los de `results` que tienen CAE. Una vista previa o un rechazo no se emitieron. */
export function listEmittedVouchers(results: readonly BillingExecutionResult[]): EmittedVoucher[] {
  return results.flatMap(({ dryRun, environment, payload, response, voucherKind, voucherNumber }) =>
    !dryRun && response.cae && voucherNumber !== undefined
      ? [{ environment, number: voucherNumber, pointOfSale: payload.PtoVta, shortcut: voucherKind.shortcut }]
      : [],
  );
}

const emittedInThisRun: EmittedVoucher[] = [];
/** Emitidos con el PDF elegido que se quedaron sin el: fallo, o no se pudo preguntar. */
const withoutPdf: EmittedVoucher[] = [];
/** Cuantos de los primeros ya nombro un aviso en stderr. */
let announced = 0;

/** Lo emitido hasta aca ya se dijo en stderr (`writePartialResultsFailure`). */
export function markEmissionsAnnounced(): void {
  announced = emittedInThisRun.length;
}

/** @internal Para los tests: el registro es del proceso. */
export function resetEmittedInThisRun(): void {
  emittedInThisRun.length = 0;
  withoutPdf.length = 0;
  announced = 0;
}

/**
 * Anota lo emitido apenas ARCA responde, antes de mostrarlo: si despues no se puede escribir la salida, el aviso lo
 * dice (`reportOutputFailure`). Devuelve el resultado, para no cortar la expresion que emite.
 */
export function recordEmission(result: BillingExecutionResult): BillingExecutionResult {
  emittedInThisRun.push(...listEmittedVouchers([result]));

  return result;
}

/** La E: su numero va en el payload, porque lo elige quien emite. */
export function recordExportEmission(result: ExportExecutionResult): ExportExecutionResult {
  emittedInThisRun.push(...listEmittedExport(result));

  return result;
}

function listEmittedExport(result: ExportExecutionResult): EmittedVoucher[] {
  const { dryRun, environment, payload, response, voucherKind } = result;

  return !dryRun && response.cae
    ? [{ environment, number: payload.Cbte_nro, pointOfSale: payload.Punto_vta, shortcut: voucherKind.shortcut }]
    : [];
}

/** El PDF que se eligio al emitir no se genero: lo dice el aviso, porque no se puede generar despues. */
export function recordMissingPdf(result: BillingExecutionResult): void {
  addWithoutPdf(listEmittedVouchers([result]));
}

export function recordMissingExportPdf(result: ExportExecutionResult): void {
  addWithoutPdf(listEmittedExport(result));
}

/** Los PDF de `results` que fallaron. Va antes de mostrarlos: la salida puede ser lo que falla. */
export function recordFailedPdfs(results: readonly BillingExecutionResult[]): void {
  results.filter(hasFailedPdf).forEach(recordMissingPdf);
}

export function recordFailedExportPdf(result: ExportExecutionResult): void {
  if (hasFailedPdf(result)) {
    recordMissingExportPdf(result);
  }
}

function hasFailedPdf({ pdf }: { readonly pdf?: PdfOutcome }): boolean {
  return pdf !== undefined && 'error' in pdf;
}

/** Cada uno una vez: dos caminos que lo anoten no pueden dar `42 y 42`. */
function addWithoutPdf(vouchers: readonly EmittedVoucher[]): void {
  withoutPdf.push(
    ...vouchers.filter(
      ({ environment, number, pointOfSale, shortcut }) =>
        !withoutPdf.some(
          (known) =>
            known.environment === environment &&
            known.number === number &&
            known.pointOfSale === pointOfSale &&
            known.shortcut === shortcut,
        ),
    ),
  );
}

/**
 * Una linea por tipo, entorno y punto de venta de lo emitido en esta corrida; vacia si no se emitio nada. Con
 * `no-avisado`, sin lo que ya se dijo en stderr: para otro aviso que va ahi mismo.
 */
export function describeEmittedInThisRun(scope: 'no-avisado' | 'todo' = 'todo'): string[] {
  return [
    ...describeEmittedVouchers(scope === 'todo' ? emittedInThisRun : emittedInThisRun.slice(announced)),
    ...groupVouchers(withoutPdf).map((group) => `No se generó el PDF: ${formatGroupNumbers(group)}.`),
  ];
}

export function describeEmittedVouchers(vouchers: readonly EmittedVoucher[]): string[] {
  return groupVouchers(vouchers).map(formatEmittedGroup);
}

function groupVouchers(vouchers: readonly EmittedVoucher[]): EmittedVoucher[][] {
  const groups = new Map<string, EmittedVoucher[]>();

  for (const voucher of vouchers) {
    const key = `${voucher.environment} ${voucher.shortcut} ${voucher.pointOfSale}`;

    groups.set(key, [...(groups.get(key) ?? []), voucher]);
  }

  return [...groups.values()];
}

/** Numeros ordenados, con los seguidos juntos: `del 42 al 61`, `42 y 43` o `7 y del 10 al 14`. */
function formatNumberRuns(numbers: readonly number[]): string {
  const runs: Array<{ from: number; to: number }> = [];

  for (const number of [...numbers].sort((left, right) => left - right)) {
    const last = runs.at(-1);

    if (last && number === last.to + 1) {
      last.to = number;
    } else {
      runs.push({ from: number, to: number });
    }
  }

  const labels = runs.flatMap(({ from, to }) =>
    to - from > 1 ? [`del ${from} al ${to}`] : from === to ? [String(from)] : [String(from), String(to)],
  );

  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} y ${labels.at(-1)}` : labels.join('');
}

/** `fc del punto de venta 3, 42 y 43`. */
function formatGroupNumbers(group: readonly EmittedVoucher[]): string {
  return `${group[0].shortcut} del punto de venta ${group[0].pointOfSale}, ${formatNumberRuns(group.map(({ number }) => number))}`;
}

/** Que se emitio en un punto de venta y con que verlo: con mas de los que lista `ultimos`, de a uno. */
function formatEmittedGroup(group: readonly EmittedVoucher[]): string {
  const { environment, pointOfSale, shortcut } = group[0];
  const numbers = group.map(({ number }) => number);
  // Uno mas: el que corto el lote puede haberse emitido despues y correr la lista.
  const quantity = Math.max(...numbers) - Math.min(...numbers) + 2;
  const scope = `--pv ${pointOfSale}`;
  const command =
    quantity <= MAX_RECENT_VOUCHERS
      ? `arcli ultimos ${shortcut} ${scope} --cantidad ${quantity} --${environment}`
      : `arcli consultar ${shortcut} <número> ${scope} --${environment}`;

  const [emitted, verify] = numbers.length === 1 ? ['Se emitió', 'Verificalo'] : ['Se emitieron', 'Verificalos'];

  return `${emitted}: ${formatGroupNumbers(group)}. ${verify} con \`${command}\`.`;
}
