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

/**
 * Los flags del asociado ganan campo por campo sobre `comprobanteAsociado` del archivo, en A, B, C y la E: un `--acuit`
 * solo no descarta el resto. Si un flag identifica el tipo (`--ac` o `--at`), el del archivo no se mezcla con el. Y si
 * apuntan a otro comprobante que el del archivo (otro tipo, numero o punto de venta), su fecha y su CUIT no van.
 */
export function mergeAssociatedVoucher(
  flags: AssociatedVoucherJson | undefined,
  file: AssociatedVoucherJson | undefined,
  arcaTypeOf: ArcaTypeOf,
): AssociatedVoucherJson | undefined {
  if (!flags || !file) {
    return flags ?? file;
  }

  const identified = flags.atajo !== undefined || flags.tipo !== undefined ? flags : file;
  const pointsElsewhere =
    differs(typeOf(flags, arcaTypeOf), typeOf(file, arcaTypeOf)) ||
    differs(flags.numero, file.numero) ||
    differs(flags.puntoVenta, file.puntoVenta);
  const { cuit, fecha } = pointsElsewhere ? {} : file;

  return {
    atajo: identified.atajo,
    cuit: flags.cuit ?? cuit,
    fecha: flags.fecha ?? fecha,
    numero: flags.numero ?? file.numero,
    puntoVenta: flags.puntoVenta ?? file.puntoVenta,
    tipo: identified.tipo,
  };
}
