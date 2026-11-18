/**
 * `generated/comprobantes.json`: los comprobantes de `docs/comprobantes/` (que salen de `scripts/docs/comprobantes.ts`),
 * en su orden, con lo que necesita la portada para las filas y los atajos de `data/landing.ts`.
 */
export function vouchersData(vouchers) {
  return vouchers.map(({ atajo, comando, familia, letra, slug, titulo }) => ({
    atajo,
    comando,
    familia,
    letra,
    slug,
    titulo,
  }));
}
