import { formatBillingResultAsJson, formatBillingResultAsText } from '../../modules/billing/billing.presenter';
import { serializeBillingBatch } from '../../modules/billing/billing.serialize';
import type { BillingExecutionResult } from '../../modules/billing/billing.types.internal';
import { formatPdfOutcomeAsText } from '../../modules/pdf/pdf.presenter';
import { MAX_RECENT_VOUCHERS } from '../../modules/vouchers/voucher-history';
import { noticePanel, writeTerminalError, writeTerminalJson, writeTerminalOutput } from '../../ui';

export function formatBillingOutputs(
  results: BillingExecutionResult[],
  options: {
    /** Entro un array en `--cargar`: se rotula como lote aunque tenga un solo resultado. */
    readonly batch?: boolean;
    readonly environment: 'produccion' | 'testing';
    readonly previewShown?: boolean;
    readonly raw: boolean;
  },
): string {
  return results
    .map((result, index) => {
      const output = formatBillingResultAsText(result, {
        environment: options.environment,
        previewShown: options.previewShown,
        raw: options.raw,
      });

      if (results.length === 1 && !options.batch) {
        return output;
      }

      return [`Lote ${index + 1}/${results.length}`, output].join('\n');
    })
    .join('\n\n');
}

export function writeBillingCommandResults(
  results: BillingExecutionResult[],
  options: {
    /** Entro un array en `--cargar`: el JSON sale como array aunque tenga un solo resultado. */
    readonly batch?: boolean;
    readonly environment: 'produccion' | 'testing';
    readonly outputJson: boolean;
    readonly previewShown?: boolean;
    readonly raw: boolean;
  },
): void {
  if (options.outputJson) {
    if (results.length === 1 && !options.batch) {
      writeTerminalJson(formatBillingResultAsJson(results[0], { raw: options.raw }));

      return;
    }

    writeTerminalJson(JSON.stringify(serializeBillingBatch(results, { raw: options.raw }), null, 2));

    return;
  }

  writeTerminalOutput(
    formatBillingOutputs(results, {
      batch: options.batch,
      environment: options.environment,
      previewShown: options.previewShown,
      raw: options.raw,
    }),
  );
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
function formatEmittedGroup(group: readonly BillingExecutionResult[]): string {
  const { environment, payload, voucherKind } = group[0];
  const numbers = group.flatMap(({ voucherNumber }) => voucherNumber ?? []);
  // Uno mas: el que corto el lote puede haberse emitido despues y correr la lista.
  const quantity = Math.max(...numbers) - Math.min(...numbers) + 2;
  const scope = `--pv ${payload.PtoVta}`;
  const command =
    quantity <= MAX_RECENT_VOUCHERS
      ? `arcli ultimos ${voucherKind.shortcut} ${scope} --cantidad ${quantity} --${environment}`
      : `arcli consultar ${voucherKind.shortcut} <número> ${scope} --${environment}`;

  const [emitted, verify] = numbers.length === 1 ? ['Se emitió', 'Verificalo'] : ['Se emitieron', 'Verificalos'];

  return `${emitted}: ${voucherKind.shortcut} del punto de venta ${payload.PtoVta}, ${formatNumberRuns(numbers)}. ${verify} con \`${command}\`.`;
}

/**
 * Fallo la entrega de los ya procesados de un lote cortado (por ejemplo, la pregunta del PDF): cuales tienen CAE y con
 * que verlos, para que nadie los vuelva a cargar. No cubre un fallo asincrono de la salida, como el disco lleno: eso
 * corta el proceso despues.
 */
export function writePartialResultsFailure(results: readonly BillingExecutionResult[]): void {
  const groups = new Map<number, BillingExecutionResult[]>();

  for (const result of results) {
    if (!result.dryRun && result.response.cae && result.voucherNumber !== undefined) {
      groups.set(result.payload.PtoVta, [...(groups.get(result.payload.PtoVta) ?? []), result]);
    }
  }

  const subject =
    results.length === 1 ? 'del comprobante ya procesado' : `de los ${results.length} comprobantes ya procesados`;
  const lines = [`No se pudieron mostrar todos los datos ${subject}.`, ...[...groups.values()].map(formatEmittedGroup)];

  writeTerminalError(() => noticePanel(lines.join('\n'), 'warning'));
}

/** En texto el comprobante ya se mostro: solo se agrega lo que paso con el PDF y los avisos nuevos. */
export function writePdfOutcomes(
  before: readonly BillingExecutionResult[],
  after: readonly BillingExecutionResult[],
): void {
  const blocks = after.flatMap((result, index) => {
    const label = after.length > 1 ? `Lote ${index + 1}/${after.length}` : undefined;
    const newWarnings = (result.warnings ?? []).slice(before[index]?.warnings?.length ?? 0);

    return [
      ...(result.pdf ? [formatPdfOutcomeAsText(result.pdf, label)] : []),
      ...newWarnings.map((warning) => noticePanel(label ? `${label}: ${warning}` : warning, 'warning')),
    ];
  });

  if (blocks.length > 0) {
    writeTerminalOutput(blocks.join('\n'));
  }
}
