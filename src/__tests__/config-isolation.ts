import { isAbsolute, relative, resolve } from 'node:path';

/** Si `path` queda dentro de `root` (o es `root`). Compara rutas, no prefijos: `/tmp/a-b` no está dentro de `/tmp/a`. */
export function isInsideDirectory(root: string, path: string): boolean {
  const fromRoot = relative(resolve(root), resolve(path));

  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot));
}

/**
 * Lanza un error si alguna de las rutas queda fuera de `root`. El setup de los tests lo usa con la carpeta temporal
 * y las rutas de config y tickets resueltas: si un cambio (o un pool de vitest que no aplica el entorno) las manda a
 * la carpeta real, la suite falla antes de que un test la escriba (TEST-14).
 */
export function assertConfigIsolated(root: string, paths: Readonly<Record<string, string>>): void {
  const outside = Object.entries(paths).filter(([, path]) => !isInsideDirectory(root, path));

  if (outside.length > 0) {
    const list = outside.map(([name, path]) => `${name}: ${path}`).join(', ');

    throw new Error(
      `Los tests no pueden usar la config real: ${list} no está dentro de la carpeta temporal ${root}. Revisá ARCLI_CONFIG_DIR en src/__tests__/setup.ts.`,
    );
  }
}
