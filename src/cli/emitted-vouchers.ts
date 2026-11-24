import type { BillingExecutionResult } from '../modules/billing/billing.types.internal';
import type { ExportExecutionResult } from '../modules/export/export.types';
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
  const { dryRun, environment, payload, response, voucherKind } = result;

  if (!dryRun && response.cae) {
    emittedInThisRun.push({
      environment,
      number: payload.Cbte_nro,
      pointOfSale: payload.Punto_vta,
      shortcut: voucherKind.shortcut,
    });
  }

  return result;
}

/** Una linea por tipo, entorno y punto de venta de lo emitido en esta corrida; vacia si no se emitio nada. */
export function describeEmittedInThisRun(): string[] {
  return describeEmittedVouchers(emittedInThisRun);
}

export function describeEmittedVouchers(vouchers: readonly EmittedVoucher[]): string[] {
  const groups = new Map<string, EmittedVoucher[]>();

  for (const voucher of vouchers) {
    const key = `${voucher.environment} ${voucher.shortcut} ${voucher.pointOfSale}`;

    groups.set(key, [...(groups.get(key) ?? []), voucher]);
  }

  return [...groups.values()].map(formatEmittedGroup);
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

  return `${emitted}: ${shortcut} del punto de venta ${pointOfSale}, ${formatNumberRuns(numbers)}. ${verify} con \`${command}\`.`;
}
