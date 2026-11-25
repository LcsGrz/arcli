import type { ExportGateway } from '../modules/export/export.gateway';
import { cacheExportTables } from '../modules/export/export.table-cache';
import { ArcaClientFactory } from '../services/arca/arca-client.factory';

import type { CliArcaRuntime } from './arca-runtime';

/**
 * El WSFEX de un comprobante E, con sus tablas en memoria. Se crea uno por corrida del comando y uno por comprobante del
 * asistente: el siguiente vuelve a consultar las tablas.
 */
export function createExportVoucherGateway(runtime: CliArcaRuntime): ExportGateway {
  return cacheExportTables(new ArcaClientFactory().createExportGateway(runtime));
}
