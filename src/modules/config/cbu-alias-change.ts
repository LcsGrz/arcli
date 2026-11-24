import { isSameCbu } from '../billing/billing.defaults';

/** Lo guardado que importa al cambiar el CBU. Puede venir de un archivo sin validar. */
interface SavedCbu {
  readonly aliasCbu?: unknown;
  readonly cbu?: unknown;
}

export interface CbuAliasChange {
  /** El alias guardado es de otro CBU: se borra en el mismo cambio. */
  readonly removesAlias: boolean;
  readonly warning: string;
}

/**
 * Que pasa con el alias guardado al guardar `cbu`: con otro CBU se borra, porque es el alias de la cuenta anterior. Sin
 * CBU guardado puede ser el del nuevo, cargado primero: queda, con un aviso. Con el mismo CBU no pasa nada.
 */
export function cbuAliasChange({ aliasCbu, cbu: savedCbu }: SavedCbu, cbu: string): CbuAliasChange | undefined {
  if (typeof aliasCbu !== 'string') {
    return undefined;
  }

  if (typeof savedCbu !== 'string') {
    return {
      removesAlias: false,
      warning: `El alias guardado (${aliasCbu}) se va a usar con este CBU. Si es de otro, cambialo con \`arcli config establecer aliasCbu <alias>\` o borralo con \`arcli config eliminar aliasCbu\`.`,
    };
  }

  return isSameCbu(savedCbu, cbu)
    ? undefined
    : {
        removesAlias: true,
        warning: `Se borró el alias ${aliasCbu} de la config, que era del CBU anterior. Si el nuevo tiene alias, cargalo con \`arcli config establecer aliasCbu <alias>\`.`,
      };
}
