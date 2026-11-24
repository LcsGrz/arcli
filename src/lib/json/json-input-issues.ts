import type { z } from 'zod';

/**
 * Como se explican los errores de forma del JSON de `--cargar`, igual en A, B, C y en la E. Las claves y los nombres
 * de flags los pone cada familia.
 */
export interface JsonInputKeys {
  /** Claves validas en cada objeto del JSON; las de un array van sin indice y las de la raiz, en `''`. */
  readonly byParent: Readonly<Record<string, readonly string[]>>;
  /** Clave del JSON por nombre de flag (sin guiones), para los que no se parecen a su clave. */
  readonly flagHints: Readonly<Record<string, string>>;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];

    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }

    previous = current;
  }

  return previous[b.length] ?? 0;
}

/** La clave valida mas parecida, o el nombre de flag conocido; `undefined` si ninguna se parece. */
function suggestKey(unknownKey: string, parent: string, keys: JsonInputKeys): string | undefined {
  const normalized = normalizeKey(unknownKey);
  const validKeys = keys.byParent[parent] ?? [];
  const flagHint = parent === '' ? keys.flagHints[normalized] : undefined;

  if (flagHint) {
    return flagHint;
  }

  const ranked = validKeys
    .map((key) => ({ distance: editDistance(normalized, normalizeKey(key)), key }))
    .sort((left, right) => left.distance - right.distance);
  const best = ranked[0];

  return best && best.distance <= Math.max(1, Math.floor(normalized.length / 4)) ? best.key : undefined;
}

function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((segment, index) =>
      typeof segment === 'number' ? `[${segment}]` : `${index === 0 ? '' : '.'}${String(segment)}`,
    )
    .join('');
}

/** Como se nombra en un error el tipo que espera un esquema. */
export function describeExpected(expected: string): string {
  switch (expected) {
    case 'int':
      return 'un entero';
    case 'number':
      return 'un número';
    case 'string':
      return 'un texto';
    case 'boolean':
      return 'true o false';
    case 'array':
      return 'un array';
    case 'object':
      return 'un objeto';
    default:
      return expected;
  }
}

/** Como se nombra en un error el valor que llego. */
export function describeReceived(input: unknown): string {
  if (input === null) {
    return 'null';
  }

  if (Array.isArray(input)) {
    return 'un array';
  }

  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- typeof: el default nombra el tipo que llegó, cualquiera sea
  switch (typeof input) {
    case 'string':
      return `el texto ${JSON.stringify(input)}`;
    case 'number':
    case 'boolean':
      return String(input);
    case 'object':
      return 'un objeto';
    default:
      return typeof input;
  }
}

interface JsonFieldIssue {
  readonly mensaje: string;
  readonly ruta: string[];
}

/** Un problema de forma del JSON, con la clave como la escribe quien lo carga. Una clave de mas da uno por clave. */
export function describeJsonIssue(issue: z.core.$ZodIssue, keys: JsonInputKeys): JsonFieldIssue[] {
  const path = issue.path.map((segment) => (typeof segment === 'number' ? segment : String(segment)));
  const pathLabel = formatPath(path);

  if (issue.code === 'unrecognized_keys') {
    const parent = path.filter((segment) => typeof segment === 'string').join('.');

    return issue.keys.map((key) => {
      const fullKey = formatPath([...path, key]);
      const suggestion = suggestKey(key, parent, keys);

      return {
        mensaje: `La clave "${fullKey}" no existe${suggestion ? `: ¿quisiste decir "${suggestion}"?` : '.'}`,
        ruta: [...path.map(String), key],
      };
    });
  }

  if (issue.code === 'invalid_type') {
    if (issue.input === undefined) {
      return [{ mensaje: `Falta "${pathLabel}".`, ruta: path.map(String) }];
    }

    if (path.length === 0) {
      return [
        { mensaje: `Cada comprobante tiene que ser un objeto y llegó ${describeReceived(issue.input)}.`, ruta: [] },
      ];
    }

    const unquote =
      issue.expected === 'number' && typeof issue.input === 'string' && issue.input.trim() !== ''
        ? ' Escribilo sin comillas.'
        : '';

    return [
      {
        mensaje: `"${pathLabel}" tiene que ser ${describeExpected(issue.expected)} y llegó ${describeReceived(issue.input)}.${unquote}`,
        ruta: path.map(String),
      },
    ];
  }

  return [{ mensaje: `"${pathLabel}" ${issue.message}.`, ruta: path.map(String) }];
}
