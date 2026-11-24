import { formatQuotationAsText, formatStatusAsText } from '../../modules/parameters/parameters.presenter';
import { buildStatusReport } from '../../modules/parameters/status';
import { ArcaParametersGateway } from '../../services/arca/arca-parameters.gateway';
import { fetchWsfexServerStatus } from '../../services/arca/wsfex-status';
import { writeTerminalOutput } from '../../ui';
import { withSpinner } from '../spinner';

import type { InteractiveSession } from './session';

/** Estado de los servidores de ARCA, del punto de venta y la cotizacion oficial del dolar. */
export async function runStatusFlow(session: InteractiveSession): Promise<void> {
  const gateway = new ArcaParametersGateway(session.arca);
  const { environment, pointOfSale } = session.runtime;
  const [report, quotation] = await withSpinner('Consultando ARCA...', () =>
    Promise.all([
      buildStatusReport({
        environment,
        gateway,
        getExportServerStatus: (signal) => fetchWsfexServerStatus(environment, signal),
        now: Date.now,
        pointOfSale,
      }),
      // La cotizacion es un extra: si falla, el estado se muestra igual.
      gateway.getQuotation('USD').catch(() => undefined),
    ]),
  );

  writeTerminalOutput(formatStatusAsText(report));

  if (quotation) {
    writeTerminalOutput(formatQuotationAsText(quotation, environment));
  }
}
