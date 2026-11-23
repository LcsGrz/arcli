export type DniParseResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string };

/**
 * DNI de 6 a 8 dígitos, con o sin puntos (`30.123.456`). Regla propia: ARCA acepta cualquier DocNro de hasta 11
 * dígitos (WSFEv1, p. 28) y testing aprobó una B a DNI 543210. Desde 6 dígitos entran las LE y LC viejas; menos es
 * casi seguro un error de tipeo. Devuelve los dígitos o el motivo.
 */
export function parseDni(raw: number | string): DniParseResult {
  const value = String(raw).trim().replace(/\./g, '');

  if (!/^\d{6,8}$/.test(value)) {
    return { ok: false, reason: 'debe tener de 6 a 8 dígitos' };
  }

  return { ok: true, value };
}
