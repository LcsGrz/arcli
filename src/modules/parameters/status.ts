import type { ParametersGateway, SalesPoint, ServerStatus } from './parameters';
import { areServersOk, probeServers } from './server-status';

export type PointOfSaleCheck =
  | { readonly kind: 'habilitado'; readonly point: SalesPoint }
  | { readonly kind: 'bloqueado' | 'de-baja'; readonly point: SalesPoint }
  | { readonly kind: 'no-encontrado' }
  /** En testing ARCA no informa puntos de venta (error 602): no se puede verificar. */
  | { readonly kind: 'sin-datos' }
  | { readonly kind: 'sin-configurar' };

export interface StatusReport {
  readonly environment: 'produccion' | 'testing';
  /** Los de WSFEX; sin definir si no respondieron. No cambian `ready`. */
  readonly exportServers?: ServerStatus;
  readonly latencyMs: number;
  readonly pointOfSale: PointOfSaleCheck;
  readonly pointOfSaleNumber?: number;
  readonly servers: ServerStatus;
  /** Se puede emitir: servidores OK y punto de venta habilitado (o no verificable en testing). */
  readonly ready: boolean;
}

function checkPointOfSale(points: readonly SalesPoint[], number: number | undefined): PointOfSaleCheck {
  if (!number) {
    return { kind: 'sin-configurar' };
  }

  if (points.length === 0) {
    return { kind: 'sin-datos' };
  }

  const point = points.find((candidate) => candidate.number === number);

  if (!point) {
    return { kind: 'no-encontrado' };
  }

  if (point.blocked) {
    return { kind: 'bloqueado', point };
  }

  return point.closedOn ? { kind: 'de-baja', point } : { kind: 'habilitado', point };
}

export async function buildStatusReport(options: {
  readonly environment: 'produccion' | 'testing';
  readonly gateway: ParametersGateway;
  readonly now: () => number;
  readonly pointOfSale?: number;
  /** Cuanto esperar a WSFEX. */
  readonly timeoutMs?: number;
}): Promise<StatusReport> {
  // A la par: si WSFEX falla o no contesta, lo demas no cambia.
  const exportProbe = probeServers(async () => options.gateway.getExportServerStatus(), options.timeoutMs);
  const start = options.now();
  const servers = await options.gateway.getServerStatus();
  const latencyMs = options.now() - start;
  const points = await options.gateway.getSalesPoints();
  const pointOfSale = checkPointOfSale(points, options.pointOfSale);

  return {
    environment: options.environment,
    exportServers: await exportProbe,
    latencyMs,
    pointOfSale,
    pointOfSaleNumber: options.pointOfSale,
    ready: areServersOk(servers) && (pointOfSale.kind === 'habilitado' || pointOfSale.kind === 'sin-datos'),
    servers,
  };
}
