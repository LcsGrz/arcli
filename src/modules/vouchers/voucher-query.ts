import { AppError, InputValidationError } from '../../lib/errors/app-error';
import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import { INVALID_POINT_OF_SALE_MESSAGE } from '../billing/billing.schemas';
import type { VoucherKindDefinition } from '../billing/billing.types';
import { getVoucherKindByShortcut, VOUCHER_SHORTCUTS } from '../billing/voucher-kind-map';
import { formatVoucherWithArticle } from '../billing/voucher-names';
import { type ArcliEnvironment, formatEnvironmentLabel, MISSING_POINT_OF_SALE_MESSAGE } from '../config/config.schemas';
import type { ExportGateway } from '../export/export.gateway';
import { listRecentExportVouchers } from '../export/export.history';
import { EXPORT_VOUCHER_KINDS, type ExportVoucherKind, getExportVoucherKindByShortcut } from '../export/export.kinds';
import type { ExportIssuedVoucher } from '../export/export.types';

import {
  type IssuedVoucher,
  type ListedVoucher,
  listRecentVouchers,
  MAX_RECENT_VOUCHERS,
  type VoucherHistoryGateway,
} from './voucher-history';
import { formatVoucherNumber } from './voucher-number';

/** A, B, C, FCE y recibos se consultan por wsfe. */
interface WsfeVoucher {
  readonly service: 'wsfe';
  readonly voucherKind: VoucherKindDefinition;
}

/** La E y sus notas, por wsfex. */
interface WsfexVoucher {
  readonly service: 'wsfex';
  readonly voucherKind: ExportVoucherKind;
}

interface VoucherScope {
  readonly environment: ArcliEnvironment;
  readonly pointOfSale: number;
}

export type QueryableVoucher = WsfeVoucher | WsfexVoucher;

/** El tipo con el gateway de su servicio. */
export type VoucherSource =
  | (WsfeVoucher & { readonly gateway: VoucherHistoryGateway })
  | (WsfexVoucher & { readonly gateway: Pick<ExportGateway, 'getLastVoucherNumber' | 'getVoucher'> });

export type VoucherList =
  | (VoucherScope & WsfeVoucher & { readonly vouchers: ReadonlyArray<ListedVoucher<IssuedVoucher>> })
  | (VoucherScope & WsfexVoucher & { readonly vouchers: ReadonlyArray<ListedVoucher<ExportIssuedVoucher>> });

export type VoucherDetail =
  | (VoucherScope & WsfeVoucher & { readonly voucher: IssuedVoucher })
  | (VoucherScope & WsfexVoucher & { readonly voucher: ExportIssuedVoucher });

/** El tipo de un atajo (`fb`, `nca`, `fe`), sin importar mayusculas ni espacios. */
export function resolveQueryableVoucher(shortcut: string): QueryableVoucher {
  const normalized = shortcut.trim().toLowerCase();
  const voucherKind = getVoucherKindByShortcut(normalized);

  if (voucherKind) {
    return { service: 'wsfe', voucherKind };
  }

  const exportKind = getExportVoucherKindByShortcut(normalized);

  if (exportKind) {
    return { service: 'wsfex', voucherKind: exportKind };
  }

  throw new InputValidationError(
    `El tipo "${shortcut}" no es válido. Usá un atajo: ${[...VOUCHER_SHORTCUTS, ...EXPORT_VOUCHER_KINDS.map((kind) => kind.shortcut)].join(', ')}.`,
  );
}

/** Cuantos listar. Sin pedir una cantidad no hay nada que validar: la decide la config. */
export function validateVoucherQuantity(quantity: number | undefined): void {
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_RECENT_VOUCHERS)) {
    throw new InputValidationError(`\`--cantidad\` tiene que ser un número entre 1 y ${MAX_RECENT_VOUCHERS}.`);
  }
}

export function parseQueriedNumber(raw: string): number {
  const number = parseStrictInteger(raw);

  if (number === undefined || number <= 0) {
    throw new InputValidationError(`El número "${raw}" no es válido: tiene que ser un entero positivo.`);
  }

  return number;
}

/** El punto de venta pedido o, si no, el de la config. */
export function resolveQueryPointOfSale(requested: number | undefined, configured: number | undefined): number {
  const pointOfSale = requested ?? configured;

  if (pointOfSale === undefined) {
    throw new InputValidationError(MISSING_POINT_OF_SALE_MESSAGE);
  }

  if (!Number.isInteger(pointOfSale) || pointOfSale <= 0) {
    throw new InputValidationError(INVALID_POINT_OF_SALE_MESSAGE);
  }

  return pointOfSale;
}

/** Los ultimos de un tipo, del mas nuevo al mas viejo. Son lecturas. */
export async function listVouchers(
  source: VoucherSource,
  { environment, limit, pointOfSale }: VoucherScope & { readonly limit: number },
): Promise<VoucherList> {
  if (source.service === 'wsfex') {
    const { gateway, service, voucherKind } = source;
    const vouchers = await listRecentExportVouchers(gateway, pointOfSale, voucherKind.arcaType, { limit });

    return { environment, pointOfSale, service, voucherKind, vouchers };
  }

  const { gateway, service, voucherKind } = source;
  const vouchers = await listRecentVouchers(gateway, pointOfSale, voucherKind.arcaType, { limit });

  return { environment, pointOfSale, service, voucherKind, vouchers };
}

/** Un comprobante emitido. Si ARCA dice que no existe, `VOUCHER_NOT_FOUND`. */
export async function getVoucher(
  source: VoucherSource,
  { environment, number, pointOfSale }: VoucherScope & { readonly number: number },
): Promise<VoucherDetail> {
  const notFound = () =>
    new AppError(
      `No existe ${formatVoucherWithArticle(source.voucherKind)} N° ${formatVoucherNumber(pointOfSale, number)} en ARCA (${formatEnvironmentLabel(environment)}).`,
      { code: 'VOUCHER_NOT_FOUND' },
    );

  if (source.service === 'wsfex') {
    const { gateway, service, voucherKind } = source;
    const voucher = await gateway.getVoucher({ arcaType: voucherKind.arcaType, number, pointOfSale });

    if (!voucher) {
      throw notFound();
    }

    return { environment, pointOfSale, service, voucher, voucherKind };
  }

  const { gateway, service, voucherKind } = source;
  const voucher = await gateway.getVoucher(number, pointOfSale, voucherKind.arcaType);

  if (!voucher) {
    throw notFound();
  }

  return { environment, pointOfSale, service, voucher, voucherKind };
}
