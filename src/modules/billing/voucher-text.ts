import { attentionPanel, dataPanel, errorListPanel, testingBanner, ticketPanel, tipPanel } from '../../ui/components';
import { renderKeyValueRows, renderObject, resolveKeyValueLabelWidth, toneText, uiSymbol } from '../../ui/primitives';

import { formatArcaMessages, formatResponseCountRows } from './billing.labels';

export interface VoucherTextOptions {
  readonly environment?: 'produccion' | 'testing';
  readonly previewShown?: boolean;
  readonly raw?: boolean;
}

/** Lo que muestra cualquier comprobante en la terminal: A, B, C, FCE, recibo y la factura E de exportación. */
export interface VoucherTextParts {
  readonly dryRun: boolean;
  readonly environment?: 'produccion' | 'testing';
  /** Las tablas de la vista previa. */
  readonly preview: readonly string[];
  /** La respuesta cruda, solo con `--bruto`. */
  readonly raw: () => unknown;
  readonly response: {
    readonly errors: readonly unknown[];
    readonly events: readonly unknown[];
    readonly observaciones: readonly string[];
    readonly status: 'aprobado' | 'observado' | 'rechazado';
    readonly suggestions: readonly string[];
  };
  /** CAE, vencimiento, número e importe: el resumen del resultado. */
  readonly summary: ReadonlyArray<readonly [string, string | number]>;
  readonly title: string;
  readonly warnings: readonly string[];
}

const STATUS_FOOTERS = {
  aprobado: { label: 'APROBADO', tone: 'success' },
  observado: { label: 'OBSERVADO', tone: 'warning' },
  rechazado: { label: 'RECHAZADO', tone: 'danger' },
} as const;

function bulletList(items: readonly string[]): string {
  return items.map((item) => `${uiSymbol('bullet')} ${item}`).join('\n');
}

function numberedList(items: readonly string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function previewPanel(parts: VoucherTextParts): string {
  return ticketPanel(parts.title, parts.preview, parts.dryRun ? { footer: toneText('SIN EMITIR', 'warning') } : {});
}

function resultPanel(parts: VoucherTextParts): string {
  const countRows = formatResponseCountRows(parts.response);
  const labelWidth = resolveKeyValueLabelWidth('ticket', [...parts.summary, ...countRows]);
  const rows = [
    ...renderKeyValueRows(parts.summary, { labelWidth }),
    ...(countRows.length > 0 ? ['', ...renderKeyValueRows(countRows, { labelWidth })] : []),
  ];
  const status = STATUS_FOOTERS[parts.response.status];

  return ticketPanel(parts.title, rows, { footer: toneText(status.label, status.tone), tone: status.tone });
}

/** Lo que ARCA devolvió además del resultado: observaciones, eventos, errores y sugerencias. */
function responsePanels(response: VoucherTextParts['response']): string[] {
  return [
    ...(response.observaciones.length > 0
      ? [attentionPanel('Observaciones', numberedList(response.observaciones))]
      : []),
    ...(response.events.length > 0 ? [dataPanel('Eventos', formatArcaMessages(response.events))] : []),
    ...(response.errors.length > 0 ? [errorListPanel('Errores', formatArcaMessages(response.errors))] : []),
    ...(response.suggestions.length > 0 ? [tipPanel('Sugerencias', bulletList(response.suggestions))] : []),
  ];
}

export function formatVoucherText(parts: VoucherTextParts, options: VoucherTextOptions = {}): string {
  // Con la vista previa ya mostrada (el modo interactivo la muestra antes de preguntar), no se repiten el banner,
  // los avisos ni el comprobante.
  const environment = options.environment ?? parts.environment;
  const lines = options.previewShown
    ? []
    : [
        ...(environment === 'testing' ? [testingBanner()] : []),
        ...(parts.warnings.length > 0 ? [attentionPanel('Avisos', bulletList(parts.warnings))] : []),
      ];

  if (parts.dryRun) {
    return [...lines, previewPanel(parts)].join('\n\n');
  }

  if (!options.previewShown) {
    lines.push(previewPanel(parts));
  }

  lines.push(resultPanel(parts), ...responsePanels(parts.response));

  // `--bruto` agrega la respuesta cruda al final; el resumen se muestra igual.
  if (options.raw) {
    lines.push(dataPanel('Respuesta bruta', renderObject(parts.raw())));
  }

  return lines.join('\n\n');
}
