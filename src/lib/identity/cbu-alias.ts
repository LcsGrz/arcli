export type CbuAliasParseResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string };

/** Letras sin tilde, números, punto y guion, de 6 a 20: ARCA 10166 (WSFEv1, opcional 2102 de la FCE). */
const CBU_ALIAS_PATTERN = /^[A-Za-z0-9.-]{6,20}$/;

/** Alias del CBU (opcional 2102 de la FCE), sin espacios alrededor. Devuelve el alias o el motivo. */
export function parseCbuAlias(raw: string): CbuAliasParseResult {
  const value = raw.trim();

  if (!CBU_ALIAS_PATTERN.test(value)) {
    return { ok: false, reason: 'debe tener entre 6 y 20 letras, números, puntos o guiones' };
  }

  return { ok: true, value };
}

/** El mensaje de error de un alias inválido, el mismo en flags, `--cargar`, config y modo interactivo. */
export function describeInvalidCbuAlias(reason: string, value?: string): string {
  return `El alias${value === undefined ? '' : ` "${value}"`} no es válido: ${reason}.`;
}
