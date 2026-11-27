/** Los valores que ARCA manda por SOAP, sin confiar en el tipo que declara el SDK. */

/** El texto sin espacios alrededor; vacio si no es un texto (un numero tampoco lo es). */
export function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function readOptionalText(value: unknown): string | undefined {
  return readText(value) || undefined;
}

/** Un numero, escrito como numero o como texto; `undefined` si esta vacio o no es finito. */
export function readNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;

  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * El ultimo numero autorizado (`CbteNro` de WSFEv1 `FECompUltimoAutorizado`, `Cbte_nro` de WSFEX `FEXGetLast_CMP`):
 * un entero seguro >= 0, escrito como numero o como texto. El 0 es "no hay comprobantes". `undefined` si falta o no se
 * lee: el WSDL lo hace obligatorio, y tomarlo como 0 manda a pedir el 1 o a decir "No hay" (ARQ-24).
 */
export function readLastNumber(value: unknown): number | undefined {
  const parsed = readNumber(value);

  return parsed !== undefined && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
