function lineAndColumn(content: string, position: number): string {
  const before = content.slice(0, position).split('\n');

  return `en la línea ${before.length}, columna ${(before.at(-1)?.length ?? 0) + 1}`;
}

/**
 * La posicion que da V8, si la da. Va al final del texto y sola: un mensaje que cita el archivo (`Unexpected token 'h',
 * "hola" is not valid JSON`) termina de otra forma, asi que lo citado no se puede leer como posicion.
 */
function readPosition(message: string, content: string): number | undefined {
  const match = / JSON at position (\d+)(?: \(line \d+ column \d+\))?$/.exec(message);
  const position = match ? Number(match[1]) : undefined;

  return position !== undefined && position <= content.length ? position : undefined;
}

/**
 * Por que un texto no es JSON, en castellano y sin nada de su contenido: el mensaje de V8 cita un trozo, que puede ser
 * de un archivo sensible pasado por error.
 */
export function describeJsonError(error: unknown, content: string): string {
  // `trim` tambien saca la marca de orden de bytes (BOM).
  if (content.trim() === '') {
    return 'el archivo está vacío';
  }

  const message = error instanceof Error ? error.message : '';
  const position = readPosition(message, content);
  const end = content.trimEnd().length;

  if (message === 'Unexpected end of JSON input' || (position !== undefined && position >= end)) {
    return `el JSON se corta ${lineAndColumn(content, end)}: falta el final`;
  }

  return `el JSON está mal escrito${position === undefined ? '' : ` ${lineAndColumn(content, position)}`}`;
}
