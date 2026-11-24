/** El XML de ARCA a veces trae un solo elemento donde el WSDL promete un array, o ninguno. */
export function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}
