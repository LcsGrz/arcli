import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { formatCuit } from '../../lib/identity/format-cuit';
import { DEPRECATED_CUIT_NUMBER } from '../../lib/json/deprecations';
import { formatArgentineMoney } from '../../lib/numbers/argentine-amount';
import { keyValuePanel } from '../../ui/components';
import { renderKeyValueRows, resolveKeyValueLabelWidth } from '../../ui/primitives';

import type { FceObligation } from './fce-obligation';

export interface FceObligationReport {
  readonly cuit: number;
  readonly environment: 'produccion' | 'testing';
  readonly issueDate: string;
  readonly obligation: FceObligation;
}

export function formatFceObligationAsJson(report: FceObligationReport): string {
  return JSON.stringify(
    {
      cuit: report.cuit,
      deprecado: [DEPRECATED_CUIT_NUMBER],
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
    ['CUIT', formatCuit(report.cuit)],
    ['Fecha consultada', formatArcaDateAsArgentineDate(report.issueDate)],
    ['Obligado a recibir FCE', report.obligation.obligated ? 'sí' : 'no'],
    ['Importe mínimo', formatArgentineMoney(report.obligation.minimumAmount)],
  ];
  const footer = report.obligation.obligated
    ? `Desde ese importe corresponde emitir FCE (fcea, fceb o fcec). Debajo, factura común.`
    : 'Corresponde emitir factura común (fa, fb o fc).';

  return keyValuePanel(
    'Régimen FCE MiPyMEs',
    renderKeyValueRows(rows, { labelWidth: resolveKeyValueLabelWidth('standard', rows) }),
    footer,
    'standard',
    undefined,
    'sheet',
  );
}
