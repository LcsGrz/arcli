import { ZodError } from 'zod';

import { InputIssuesError } from '../../lib/errors/app-error';
import { describeZodIssues, parseZodInput } from '../billing/billing.zod-errors';

import { arcliConfigSchema, type ConfigPublicKey } from './config.schemas';
import { CONFIG_KEY_ALIASES, DEPRECATED_CONFIG_KEYS } from './config-keys';
import type { CanonicalConfigKey } from './config-value-parser';

/**
 * Un CBU guardado que ya no pasa la validación (por ejemplo, desde que se controlan los verificadores): el error
 * dice que viene de la config, el motivo y cómo cambiarlo.
 */
export function invalidSavedCbuError(reason: string, suggestion?: string): InputIssuesError {
  return new InputIssuesError(
    `El CBU guardado en la config no es válido: ${reason}.`,
    [{ label: 'CBU', mensaje: `${reason[0]?.toUpperCase() ?? ''}${reason.slice(1)}.`, ruta: ['cbu'] }],
    suggestion ??
      'Cambialo por el correcto con `arcli config establecer cbu <CBU>`; copialo desde el home banking o la constancia del banco.',
  );
}

/** Como se llama en la config publica lo que esta en esa ruta del archivo, y con que clave se cambia. */
interface SavedKey {
  /** Con `config eliminar` tambien se arregla: no alcanza para un grupo entero, como `emisor`. */
  readonly canDelete: boolean;
  readonly key: ConfigPublicKey;
  /** Un grupo con certificados o claves: `establecer` pide un PEM que quizas no se tiene a mano. */
  readonly needsFile?: boolean;
  readonly names: readonly string[];
}

function findSavedKey(path: string): SavedKey | undefined {
  if (Object.hasOwn(DEPRECATED_CONFIG_KEYS, path)) {
    return { canDelete: false, key: DEPRECATED_CONFIG_KEYS[path].replacement, names: [path] };
  }

  const entries = Object.entries(CONFIG_KEY_ALIASES) as Array<[ConfigPublicKey, CanonicalConfigKey]>;
  const exact = entries.find(([, canonical]) => canonical === path);

  if (exact) {
    return { canDelete: true, key: exact[0], names: [exact[0]] };
  }

  const keys = entries.filter(([, canonical]) => canonical.startsWith(`${path}.`)).map(([key]) => key);

  return keys.length === 0
    ? undefined
    : {
        canDelete: false,
        key: keys[0],
        names: keys.every((key) => key.startsWith(`${path}.`)) ? [path] : keys,
        needsFile: keys.some((key) => /(^|\.)(cert|key)\./.test(key)),
      };
}

export function issuePath(issue: { readonly path: PropertyKey[] }): string {
  return issue.path.map(String).join('.');
}

/** El motivo, para despues del nombre publico: sin el interno adelante y en minuscula. */
function describeReason(mensaje: string, path: string): string {
  const subject = `\`${path}\` `;
  const reason = mensaje.startsWith(subject) ? mensaje.slice(subject.length) : mensaje;
  const text = reason.replace(/^\p{Lu}(?=\p{Ll})/u, (letter) => letter.toLowerCase());

  return text.endsWith('.') ? text : `${text}.`;
}

/** Cada problema con sus claves publicas: "`cuit`: el CUIT debe tener 11 digitos." */
function describeSavedProblems(error: ZodError): string[] {
  const issues = describeZodIssues(error);

  return error.issues.map((issue, index) => {
    const path = issuePath(issue);
    const names = findSavedKey(path)?.names ?? [path];

    return `${names.map((name) => `\`${name}\``).join(', ')}: ${describeReason(issues[index].mensaje, path)}`;
  });
}

/**
 * Datos invalidos que ya estaban en el archivo: el error dice que vienen de la config guardada, con la clave publica y
 * que hacer. `detalles` es el de siempre, con las rutas internas (contrato).
 *
 * @param saved los problemas del archivo tal como esta, para la sugerencia.
 */
export function invalidSavedConfigError(error: ZodError, saved: ZodError, configPath: string): InputIssuesError {
  const issues = describeZodIssues(error);
  const problems = describeSavedProblems(error);
  const subject = problems.length === 1 ? 'un dato inválido' : 'datos inválidos';

  return new InputIssuesError(
    `La configuración guardada tiene ${subject}. ${problems.join(' ')}`,
    issues,
    suggestConfigFix(saved, configPath),
  );
}

export function suggestConfigFix(saved: ZodError, configPath: string): string {
  const fixes = new Map<ConfigPublicKey, SavedKey>();

  for (const issue of saved.issues) {
    const key = findSavedKey(issuePath(issue));

    if (!key) {
      // La ruta va entera: hay que poder abrir el archivo, y `arcli config ruta` tampoco anda con la config rota.
      return `Corregilo en ${configPath}, o renombrá ese archivo y volvé a cargar los datos.`;
    }

    fixes.set(key.key, { ...key, canDelete: key.canDelete || (fixes.get(key.key)?.canDelete ?? false) });
  }

  const keys = [...fixes.values()];

  if (keys.length === 1) {
    return suggestKeyFix(keys[0], configPath);
  }

  const steps = keys.map(
    ({ canDelete, key, needsFile }) =>
      `\`arcli config establecer ${key} <valor>\`${canDelete ? ` o \`arcli config eliminar ${key}\`` : ''}${needsFile ? ` o a mano en ${configPath}` : ''}`,
  );

  return `Corregilos de a uno: ${steps.join('; ')}.`;
}

function suggestKeyFix({ canDelete, key, needsFile }: SavedKey, configPath: string): string {
  const set = `Corregilo con \`arcli config establecer ${key} <valor>\``;

  if (needsFile) {
    return `${set} o a mano en ${configPath}.`;
  }

  return canDelete ? `${set} o borralo con \`arcli config eliminar ${key}\`.` : `${set}.`;
}

/** Lo que sigue mal en el archivo despues de guardar una clave. */
export interface PendingConfigProblems {
  /** Como se llaman en la config publica: una clave (`cuit`) o un grupo entero (`emisor`). */
  readonly keys: readonly string[];
  /** Uno por problema, con como arreglarlo. */
  readonly warnings: readonly string[];
}

/**
 * Cada problema que queda ya estaba, igual y en la misma ruta, y ninguno es de la clave que se cambia (tampoco de su
 * grupo: eliminar `emisor.logo` no arregla un `emisor` que no es un grupo).
 */
export function onlyOldProblems(error: ZodError, saved: ZodError | undefined, changedKey: CanonicalConfigKey): boolean {
  const old = new Set(saved?.issues.map((issue) => JSON.stringify(issue)));

  return error.issues.every((issue) => {
    const path = issuePath(issue);

    return old.has(JSON.stringify(issue)) && !isSameOrInside(path, changedKey) && !isSameOrInside(changedKey, path);
  });
}

export function isSameOrInside(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}.`);
}

export function parseConfigProblems(value: unknown): ZodError | undefined {
  try {
    parseZodInput(arcliConfigSchema, value);
  } catch (error) {
    if (error instanceof ZodError) {
      return error;
    }

    throw error;
  }

  return undefined;
}

export function describePending(error: ZodError, configPath: string): PendingConfigProblems {
  const problems = describeSavedProblems(error);

  return {
    keys: error.issues.flatMap((issue) => findSavedKey(issuePath(issue))?.names ?? []),
    warnings: error.issues.map((issue, index) => {
      const fix = suggestConfigFix(new ZodError([issue]), configPath);

      return `Sigue habiendo un dato inválido en la configuración guardada. ${problems[index]} ${fix}`;
    }),
  };
}
