import { parseCbu } from '../../lib/identity/cbu';
import { parseCbuAlias } from '../../lib/identity/cbu-alias';
import { isSameCbu } from '../billing/billing.defaults';

/** Lo guardado que importa al cambiar el CBU. Puede venir de un archivo sin validar. */
interface SavedCbu {
  readonly aliasCbu?: unknown;
  readonly cbu?: unknown;
}

/** El CBU y el alias guardados, como se muestran en `arcli config` y en el asistente. */
export function formatSavedAccount({
  aliasCbu,
  cbu,
}: {
  readonly aliasCbu?: string;
  readonly cbu?: string;
}): string | undefined {
  return aliasCbu ? `${cbu ?? 'sin CBU'} (${aliasCbu})` : cbu;
}

export interface CbuAliasChange {
  /** El alias guardado es de otro CBU: se borra en el mismo cambio. */
  readonly removesAlias: boolean;
  readonly warning: string;
}

/**
 * Que pasa con el alias guardado al guardar `cbu`: con otro CBU se borra, porque es el alias de la cuenta anterior. Sin
 * CBU guardado, o con uno invalido, puede ser el del nuevo: queda, con un aviso. Con el mismo CBU no pasa nada.
 */
export function cbuAliasChange({ aliasCbu, cbu: savedCbu }: SavedCbu, cbu: string): CbuAliasChange | undefined {
  if (typeof aliasCbu !== 'string') {
    return undefined;
  }

  if (typeof savedCbu !== 'string' || !parseCbu(savedCbu).ok) {
    // Un alias invalido no se usa: frena, y su problema ya se avisa.
    if (!parseCbuAlias(aliasCbu).ok) {
      return undefined;
    }

    return {
      removesAlias: false,
      warning: `El alias guardado (${aliasCbu}) se va a usar con este CBU. Si es de otro, guardá la cuenta de nuevo con \`arcli config establecer cuenta <CBU> [ALIAS]\`: sin alias, borra el guardado.`,
    };
  }

  return isSameCbu(savedCbu, cbu)
    ? undefined
    : {
        removesAlias: true,
        warning: `Se borró el alias ${aliasCbu} de la config, que era del CBU anterior. Si el nuevo tiene alias, guardá los dos con \`arcli config establecer cuenta <CBU> <ALIAS>\`.`,
      };
}

/** Un alias que no se puede leer se borra igual, sin nombrarlo. */
function aliasLabel(aliasCbu: unknown): string {
  return typeof aliasCbu === 'string' && aliasCbu.trim() ? `alias ${aliasCbu}` : 'alias';
}

/** El aviso de `config establecer cuenta <CBU>`: sin alias, el guardado se borra aunque el CBU sea el mismo. */
export function accountAliasRemovedWarning({ aliasCbu }: SavedCbu): string | undefined {
  return aliasCbu === undefined
    ? undefined
    : `Se borró el ${aliasLabel(aliasCbu)} de la config: la cuenta quedó sin alias. Si lo tiene, guardá los dos con \`arcli config establecer cuenta <CBU> <ALIAS>\`.`;
}

/** El aviso de `config eliminar cbu` (deprecada), que borra tambien el alias. */
export function cbuRemovalWarning({ aliasCbu }: SavedCbu): string | undefined {
  return aliasCbu === undefined
    ? undefined
    : `Se borró también el ${aliasLabel(aliasCbu)} de la config: sin el CBU no se usa.`;
}
