/** Columnas de la terminal, o null si no se conocen (pipes, tests, CI). */
export function resolveTerminalColumns(): number | null {
  const columns = process.stdout.columns || process.stderr.columns;

  return columns && columns > 0 ? columns : null;
}

/** `width` limitado al ancho de la terminal, si se conoce. */
export function fitToTerminal(width: number, minimum = 24): number {
  const columns = resolveTerminalColumns();

  return columns === null ? width : Math.min(width, Math.max(minimum, columns));
}
