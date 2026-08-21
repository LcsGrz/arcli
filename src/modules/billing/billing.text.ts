import { contentPanel, renderObject } from '../../ui';

import { formatEnvironmentBanner, formatPayloadPreview, formatResultPanel, formatStatusBadge } from './billing.display';
import { formatRawBillingResponse } from './billing.serialize';
import type { BillingExecutionResult } from './billing.types.internal';

interface BillingTextOptions {
  readonly environment?: 'produccion' | 'testing';
  readonly previewShown?: boolean;
  readonly raw?: boolean;
}

function formatObservationList(observaciones: readonly string[]): string {
  return observaciones.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

export function formatBillingResultAsText(result: BillingExecutionResult, options: BillingTextOptions = {}): string {
  const environmentLines = options.previewShown
    ? []
    : formatEnvironmentBanner(options.environment ?? result.environment);

  if (options.raw) {
    if (result.dryRun) {
      return [...environmentLines, formatPayloadPreview(result)].join('\n\n');
    }

    const lines = [contentPanel('Respuesta bruta', renderObject(formatRawBillingResponse(result)), 'wide', 'info')];

    if (!options.previewShown) {
      lines.unshift(formatPayloadPreview(result));
    }

    return [...environmentLines, ...lines].join('\n\n');
  }

  if (result.dryRun) {
    return [...environmentLines, formatPayloadPreview(result)].join('\n\n');
  }

  const lines = [...environmentLines];

  if (!options.previewShown) {
    lines.push(formatPayloadPreview(result));
  }

  lines.push(formatResultPanel(result, formatStatusBadge(result)));

  if (result.response.observaciones.length > 0) {
    lines.push(
      contentPanel('Observaciones', formatObservationList(result.response.observaciones), 'standard', 'warning'),
    );
  }

  if (result.response.events.length > 0) {
    lines.push(contentPanel('Eventos', renderObject(result.response.events), 'wide', 'info'));
  }

  if (result.response.errors.length > 0) {
    lines.push(contentPanel('Errores', renderObject(result.response.errors), 'wide', 'danger'));
  }

  const suggestions = result.response.suggestions ?? [];

  if (suggestions.length > 0) {
    lines.push(contentPanel('Sugerencias', suggestions.map((item) => `• ${item}`).join('\n'), 'wide', 'info'));
  }

  return lines.join('\n\n');
}
