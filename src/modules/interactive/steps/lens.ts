/**
 * Donde un paso compartido lee y escribe su dato en el estado de un flujo: el monto puede estar en `totalAmount`, en
 * `amount` o en `copy.amount`, y la moneda en `advanced` o en la raiz. `set` devuelve lo que cambia del estado (la
 * respuesta del paso), con el estado de antes para completar un objeto anidado.
 */
export interface Lens<S, V> {
  readonly get: (state: S) => V | undefined;
  readonly set: (value: V | undefined, state: S) => Partial<S>;
}

/** Un campo de la raiz del estado. */
export function fieldLens<S, K extends keyof S & string>(key: K): Lens<S, NonNullable<S[K]>> {
  return {
    get: (state) => (state[key] ?? undefined) as NonNullable<S[K]> | undefined,
    set: (value) => ({ [key]: value }) as unknown as Partial<S>,
  };
}

/**
 * Un campo de un objeto del estado (`advanced.serviceStartDate`, `copy.amount`): escribe el objeto entero, con lo que
 * tenia. `parent` da el objeto, o el de arranque si todavia no hay.
 */
export function nestedLens<S, P extends keyof S & string, K extends keyof NonNullable<S[P]> & string>(
  key: P,
  field: K,
  parent: (state: S) => NonNullable<S[P]> = (state) => (state[key] ?? {}) as NonNullable<S[P]>,
): Lens<S, NonNullable<NonNullable<S[P]>[K]>> {
  return {
    get: (state) => (state[key]?.[field] ?? undefined) as NonNullable<NonNullable<S[P]>[K]> | undefined,
    set: (value, state) => ({ [key]: { ...parent(state), [field]: value } }) as unknown as Partial<S>,
  };
}
