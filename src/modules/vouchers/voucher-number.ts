/**
 * El número completo de un comprobante, como lo muestra ARCA: punto de venta de 5 dígitos y número de 8
 * (`00003-00000045`). Lo usan las reglas de las notas y las vistas; el nombre del PDF arma el suyo, con 4 dígitos.
 */
export function formatVoucherNumber(pointOfSale: number, number: number): string {
  return `${String(pointOfSale).padStart(5, '0')}-${String(number).padStart(8, '0')}`;
}
