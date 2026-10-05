import type { ParametersGateway, SalesPoint, ServerStatus } from './parameters';

export type PointOfSaleCheck =
  | { readonly kind: 'habilitado'; readonly point: SalesPoint }
  | { readonly kind: 'bloqueado' | 'de-baja'; readonly point: SalesPoint }
  | { readonly kind: 'no-encontrado' }
  /** En testing ARCA no informa puntos de venta (error 602): no se puede verificar. */
  | { readonly kind: 'sin-datos' }
  | { readonly kind: 'sin-configurar' };

export interface StatusReport {
  readonly environment: 'produccion' | 'testing';
  readonly latencyMs: number;
  readonly pointOfSale: PointOfSaleCheck;
  readonly pointOfSaleNumber?: number;
  readonly servers: ServerStatus;
  /** Se puede emitir: servidores OK y punto de venta habilitado (o no verificable en testing). */
  readonly ready: boolean;
}

const SERVER_OK = 'OK';

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
  readonly now?: () => number;
  readonly pointOfSale?: number;
}): Promise<StatusReport> {
  const now = options.now ?? Date.now;
  const start = now();
  const servers = await options.gateway.getServerStatus();
  const latencyMs = now() - start;
  const points = await options.gateway.getSalesPoints();
  const pointOfSale = checkPointOfSale(points, options.pointOfSale);
  const serversOk = [servers.app, servers.db, servers.auth].every((value) => value === SERVER_OK);

  return {
    environment: options.environment,
    latencyMs,
    pointOfSale,
    pointOfSaleNumber: options.pointOfSale,
    ready: serversOk && (pointOfSale.kind === 'habilitado' || pointOfSale.kind === 'sin-datos'),
    servers,
  };
}
