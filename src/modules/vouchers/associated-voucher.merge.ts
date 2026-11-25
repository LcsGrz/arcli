import type { z } from 'zod';

import type { associatedVoucherJsonSchema } from './associated-voucher.json-input';

type AssociatedVoucherJson = z.infer<typeof associatedVoucherJsonSchema>;

/** El tipo de ARCA de un atajo (`fb` → 6), para comparar `--ac` con `tipo` y `--at` con `atajo`. */
type ArcaTypeOf = (shortcut: string) => number | undefined;

/** El tipo que dice un nivel, por atajo o por código; un atajo que no existe se compara tal cual. */
function typeOf({ atajo, tipo }: AssociatedVoucherJson, arcaTypeOf: ArcaTypeOf): number | string | undefined {
  return atajo === undefined ? tipo : (arcaTypeOf(atajo) ?? atajo);
}

const differs = <T>(flag: T | undefined, file: T | undefined): boolean =>
  flag !== undefined && file !== undefined && flag !== file;

const digits = (cuit: string | undefined): string | undefined => cuit?.replace(/\D/g, '');

/** De otro emisor: el punto de venta de la nota no dice nada del suyo. Sin CUIT es del propio. */
export function isForeignAssociated(cuit: string | undefined, emitterCuit: number | undefined): boolean {
  return cuit !== undefined && digits(cuit) !== String(emitterCuit);
}

export interface MergedAssociatedVoucher {
  /** Los flags descartaron el CUIT ajeno del archivo y no dicen otro: el punto de venta no se puede suponer. */
  readonly ownerUnknown: boolean;
  readonly voucher: AssociatedVoucherJson | undefined;
}

/**
 * Los flags del asociado ganan campo por campo sobre `comprobanteAsociado` del archivo, en A, B, C y la E: un `--acuit`
 * solo no descarta el resto. Si un flag identifica el tipo (`--ac` o `--at`), el del archivo no se mezcla con el. Y si
 * apuntan a otro comprobante que el del archivo (otro tipo, numero o punto de venta), su fecha y su CUIT no van; si ese
 * CUIT era ajeno, tampoco su punto de venta, que era del otro emisor.
 */
export function mergeAssociatedVoucher(
  flags: AssociatedVoucherJson | undefined,
  file: AssociatedVoucherJson | undefined,
  options: { readonly arcaTypeOf: ArcaTypeOf; readonly emitterCuit: number | undefined },
): MergedAssociatedVoucher {
  const { arcaTypeOf, emitterCuit } = options;

  if (!flags || !file) {
    return { ownerUnknown: false, voucher: flags ?? file };
  }

  const identified = flags.atajo !== undefined || flags.tipo !== undefined ? flags : file;
  const pointsElsewhere =
    differs(typeOf(flags, arcaTypeOf), typeOf(file, arcaTypeOf)) ||
    differs(flags.numero, file.numero) ||
    differs(flags.puntoVenta, file.puntoVenta);
  const { cuit, fecha } = pointsElsewhere ? {} : file;
  const losesForeign =
    pointsElsewhere && isForeignAssociated(file.cuit, emitterCuit) && digits(flags.cuit) !== digits(file.cuit);

  return {
    ownerUnknown: losesForeign && flags.cuit === undefined,
    voucher: {
      atajo: identified.atajo,
      cuit: flags.cuit ?? cuit,
      fecha: flags.fecha ?? fecha,
      numero: flags.numero ?? file.numero,
      puntoVenta: flags.puntoVenta ?? (losesForeign ? undefined : file.puntoVenta),
      tipo: identified.tipo,
    },
  };
}
