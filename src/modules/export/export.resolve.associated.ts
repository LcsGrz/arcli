import type { ArcliConfig } from '../config/config.schemas';

import type { ExportPreviewGateway } from './export.gateway';
import { type ExportVoucherKind, getExportVoucherKindByArcaType, isExportNote } from './export.kinds';
import {
  exportNoteHasAssociated,
  fetchExportAssociatedVoucher,
  missingExportAssociatedVoucherError,
  resolveExportAssociatedQuery,
} from './export.notes';
import { resolveExportPointOfSale } from './export.numbering';
import type {
  ExportAssociatedVoucherPayload,
  ExportDisplayInfo,
  ExportIssuedVoucher,
  ExportVoucherInput,
} from './export.types';

export interface ResolvedAssociatedVoucher {
  readonly payload: ExportAssociatedVoucherPayload;
  readonly voucher: ExportIssuedVoucher;
}

/**
 * El comprobante que ajusta la nota: el que ya leyo quien llama, si es el de la entrada, o el que se consulta en ARCA.
 * Es una lectura: no emite nada.
 */
async function fetchAssociated(
  input: ExportVoucherInput,
  gateway: ExportPreviewGateway,
  runtime: { readonly config: ArcliConfig; readonly cuit: number },
  kind: ExportVoucherKind,
  read: ExportIssuedVoucher | undefined,
): Promise<ResolvedAssociatedVoucher> {
  const query = resolveExportAssociatedQuery({
    emitterCuit: runtime.cuit,
    input: input.associatedVoucher,
    kind,
    pointOfSale: resolveExportPointOfSale(input.pointOfSale, runtime.config),
  });
  const isRead =
    read?.arcaType === query.arcaType && read.number === query.number && read.pointOfSale === query.pointOfSale;
  const voucher = isRead ? read : await fetchExportAssociatedVoucher(gateway, query);

  if (!voucher) {
    throw missingExportAssociatedVoucherError(query);
  }

  return {
    payload: {
      Cbte_cuit: runtime.cuit,
      Cbte_nro: query.number,
      Cbte_punto_vta: query.pointOfSale,
      Cbte_tipo: query.arcaType,
    },
    voucher,
  };
}

/** El asociado de una nota que lleva uno. La nota de bienes y otros puede no llevarlo (2047); la factura, nunca. */
export async function resolveExportAssociated(
  input: ExportVoucherInput,
  gateway: ExportPreviewGateway,
  runtime: { readonly config: ArcliConfig; readonly cuit: number },
  kind: ExportVoucherKind,
  read: ExportIssuedVoucher | undefined,
): Promise<ResolvedAssociatedVoucher | undefined> {
  return isExportNote(kind) && exportNoteHasAssociated(input, kind)
    ? await fetchAssociated(input, gateway, runtime, kind, read)
    : undefined;
}

export function describeAssociated(voucher: ExportIssuedVoucher): ExportDisplayInfo['associatedVoucher'] {
  return {
    currencyCode: voucher.currencyCode,
    date: voucher.date,
    displayName:
      getExportVoucherKindByArcaType(voucher.arcaType)?.displayName ?? `Comprobante tipo ${voucher.arcaType}`,
    total: voucher.total,
  };
}
