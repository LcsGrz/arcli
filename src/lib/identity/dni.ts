export type DniParseResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string };

/**
 * DNI de 6 a 8 dígitos, con o sin puntos (`30.123.456`). Regla propia: ARCA acepta cualquier DocNro de hasta 11
 * dígitos (WSFEv1, p. 28) y testing aprobó una B a DNI 543210. Desde 6 dígitos entran las LE y LC viejas; menos es
 * casi seguro un error de tipeo. Devuelve los dígitos o el motivo.
 */
/**
 * El motivo de un DNI invalido. Es un complemento ("de 6 a 8 dígitos") y no una oracion, para que cada superficie
 * ponga su verbo: "`--dni` debe tener …" en los flags, "El DNI tiene …" en el asistente.
 */
const DNI_LENGTH_REASON = 'de 6 a 8 dígitos';

export function parseDni(raw: number | string): DniParseResult {
  const value = String(raw).trim().replace(/\./g, '');

  if (!/^\d{6,8}$/.test(value)) {
    return { ok: false, reason: DNI_LENGTH_REASON };
  }

  return { ok: true, value };
}
