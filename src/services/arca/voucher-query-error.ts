import type { ErrorCode } from '../../lib/errors/error-codes';
import { ARCA_QUERY_ERROR_SUGGESTION, VERIFY_BEFORE_RETRY } from '../../lib/errors/query-error';
import { ISSUES_URL } from '../../lib/links';
import { VoucherQueryError, voucherQueryErrorMessage } from '../../modules/vouchers/voucher-history';
import { formatVoucherNumber } from '../../modules/vouchers/voucher-number';

import { toDetailErrors } from './arca-error-details';

/**
 * ARCA contesto, pero no se sabe si el comprobante existe. No puede parecer "no existe": con esta consulta se
 * verifica una emision incierta, y reintentarla la duplicaria.
 */
export function voucherQueryError(query: {
  /** Vacio: ARCA contesto otra cosa, sin un error que se pueda leer. */
  readonly errors: ReadonlyArray<{ readonly code: number | null; readonly msg: string }>;
  /** La `E`, con su codigo y su `detalles` de siempre. Sin esto, los de A, B y C. */
  readonly as?: { readonly code: ErrorCode; readonly details: Record<string, unknown> };
  readonly number: number;
  readonly pointOfSale: number;
}): VoucherQueryError {
  const { as, errors, number, pointOfSale } = query;
  const voucher = `el comprobante ${formatVoucherNumber(pointOfSale, number)}`;
  const reasons = errors.map(({ code, msg }) => [code ?? '', msg].join(' ').trim()).join('; ');

  return new VoucherQueryError(
    reasons
      ? voucherQueryErrorMessage(voucher, reasons)
      : `ARCA devolvió una respuesta inesperada al consultar ${voucher} y no se sabe si existe.`,
    as?.details ?? { errores: toDetailErrors(errors) },
    reasons
      ? ARCA_QUERY_ERROR_SUGGESTION
      : `Volvé a consultar en unos minutos. Si se repite, no insistas. ${VERIFY_BEFORE_RETRY}`,
    reasons || 'respuesta inesperada',
    { code: as?.code },
  );
}

/** Existe (vino con su numero y su CAE), pero sin un dato que ARCLI necesita o con uno que no conoce. */
export function unreadableVoucherError(voucher: {
  readonly cae: string;
  readonly number: number;
  readonly pointOfSale: number;
}): VoucherQueryError {
  const label = formatVoucherNumber(voucher.pointOfSale, voucher.number);

  return new VoucherQueryError(
    `El comprobante ${label} existe, con el CAE ${voucher.cae}, pero ARCLI no pudo leer los datos que devolvió ARCA.`,
    { errores: [] },
    `Si estabas verificando una emisión, ya está emitido: no lo repitas. Miralo en ARCA y avisanos en ${ISSUES_URL}.`,
    'existe, pero ARCLI no pudo leer sus datos',
    { exists: true },
  );
}
