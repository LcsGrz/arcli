import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { keyValuePanel, renderKeyValueRows, resolveKeyValueLabelWidth } from '../../ui';

import type { FceObligation } from './fce-obligation';

export interface FceObligationReport {
  readonly cuit: number;
  readonly environment: 'produccion' | 'testing';
  readonly issueDate: string;
  readonly obligation: FceObligation;
}

const MONEY_FORMATTER = new Intl.NumberFormat('es-AR', {
  currency: 'ARS',
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: 'currency',
});

export function formatFceObligationAsJson(report: FceObligationReport): string {
  return JSON.stringify(
    {
      cuit: report.cuit,
      entorno: report.environment,
      fecha: report.issueDate,
      montoDesde: report.obligation.minimumAmount,
      obligado: report.obligation.obligated,
    },
    null,
    2,
  );
}

export function formatFceObligationAsText(report: FceObligationReport): string {
  const rows: Array<readonly [string, string]> = [
    ['CUIT', String(report.cuit)],
    ['Fecha consultada', formatArcaDateAsArgentineDate(report.issueDate)],
    ['Obligado a recibir FCE', report.obligation.obligated ? 'si' : 'no'],
    ['Monto mínimo', MONEY_FORMATTER.format(report.obligation.minimumAmount)],
  ];
  const footer = report.obligation.obligated
    ? `Desde ese monto corresponde emitir FCE (fcea, fceb o fcec). Debajo, factura comun.`
    : 'Corresponde emitir factura comun (fa, fb o fc).';

  return keyValuePanel(
    'Régimen FCE MiPyMEs',
    renderKeyValueRows(rows, { labelWidth: resolveKeyValueLabelWidth('standard', rows) }),
    footer,
    'standard',
    undefined,
    'sheet',
  );
}
