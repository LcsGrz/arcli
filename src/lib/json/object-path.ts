/** Guarda un valor en una ruta con puntos (`emisor.logo`), creando los grupos que falten. */
export function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop() as string;
  let node = target;

  for (const key of keys) {
    const next = node[key];
    // Una lista donde va un grupo (editada a mano) no se puede completar: se reemplaza.
    node = (next && typeof next === 'object' && !Array.isArray(next) ? next : (node[key] = {})) as Record<
      string,
      unknown
    >;
  }

  node[last] = value;
}

/** Borra lo que hay en una ruta con puntos; si no está, no hace nada. */
export function deleteAtPath(target: Record<string, unknown>, path: string): void {
  const keys = path.split('.');
  const last = keys.pop() as string;
  const parent = keys.reduce<unknown>(
    (node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
    target,
  );

  if (parent && typeof parent === 'object') {
    delete (parent as Record<string, unknown>)[last];
  }
}
