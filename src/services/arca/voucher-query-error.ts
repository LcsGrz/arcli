import { VoucherQueryError } from '../../modules/vouchers/voucher-history';
import { formatVoucherNumber } from '../../modules/vouchers/voucher-number';

import { toDetailErrors } from './arca-error-details';

/**
 * ARCA contesto, pero no se sabe si el comprobante existe. No puede parecer "no existe": con esta consulta se
 * verifica una emision incierta, y reintentarla la duplicaria.
 */
export function voucherQueryError(query: {
  /** Vacio: ARCA contesto otra cosa, sin un error que se pueda leer. */
  readonly errors: ReadonlyArray<{ readonly code: number | null; readonly msg: string }>;
  /** Vino con su numero y su CAE, pero sin un dato que ARCLI necesita o con uno que no conoce. */
  readonly exists?: boolean;
  readonly number: number;
  readonly pointOfSale: number;
}): VoucherQueryError {
  const { errors, number, pointOfSale } = query;
  const voucher = `el comprobante ${formatVoucherNumber(pointOfSale, number)} y no se sabe si existe`;
  const reasons = errors.map(({ code, msg }) => [code ?? '', msg].join(' ').trim()).join('; ');

  return new VoucherQueryError(
    reasons
      ? `ARCA devolvió un error al consultar ${voucher}: ${reasons}`
      : `ARCA devolvió una respuesta inesperada al consultar ${voucher}.`,
    { errores: toDetailErrors(errors) },
    `${
      reasons
        ? 'Revisá el mensaje de ARCA: si es pasajero, volvé a consultar en unos minutos; si no, corregí lo que dice.'
        : 'Volvé a consultar en unos minutos.'
    } Si se repite, no insistas. Si estabas verificando una emisión, no la reintentes hasta saber si el comprobante existe.`,
    reasons || 'respuesta inesperada',
    query.exists,
  );
}
