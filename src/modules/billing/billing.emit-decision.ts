import { InputValidationError } from '../../lib/errors/app-error';

/** Qué nivel decidió emitir o no: los flags, el archivo de `--cargar` o la config. */
export type EmitDecisionSource = 'default' | 'file' | 'flags';

export interface EmitDecision {
  readonly emit: boolean;
  readonly source: EmitDecisionSource;
}

/** Lo que pide un nivel: `true` en `emitir` o `previsualizar`, o nada (`undefined`). */
interface EmitLevel {
  readonly emitir?: boolean;
  readonly previsualizar?: boolean;
}

export interface EmitDecisionInput {
  /** `emitir` de la config (`output.emitirPorDefecto`). */
  readonly defaultEmit?: boolean;
  /** Las claves `emitir` y `previsualizar` del JSON de `--cargar`. */
  readonly file?: EmitLevel;
  /** `--emitir` y `--previsualizar`, solo si se escribieron en el comando. */
  readonly flags: EmitLevel;
  /**
   * El error de `--emitir` con `--previsualizar`. Cada familia tiene el suyo y sale en el `error` del `--json`, así
   * que se unifica con REV-58, no acá.
   */
  readonly bothFlagsMessage: string;
}

const BOTH_IN_FILE_MESSAGE = 'En el archivo usá "emitir" o "previsualizar", pero no ambos en true.';

/**
 * Emitir o no, por nivel: los flags, después el archivo de `--cargar` y por último la config. Decide el primer nivel
 * que diga algo; es error que un mismo nivel pida las dos cosas. Es la regla de seguridad de AGENTS.md: sin nada que
 * pida emitir, no se emite.
 *
 * `previsualizar: false` no pide emitir: en el archivo no dice nada (decide la config) y en los flags, que commander
 * nunca pone en `false`, cuenta como decisión de no emitir.
 */
export function resolveEmitDecision(input: EmitDecisionInput): EmitDecision {
  const { file, flags } = input;

  if (flags.emitir === true && flags.previsualizar === true) {
    throw new InputValidationError(input.bothFlagsMessage);
  }

  if (flags.emitir !== undefined || flags.previsualizar !== undefined) {
    return { emit: flags.emitir === true, source: 'flags' };
  }

  if (file?.emitir === true && file.previsualizar === true) {
    throw new InputValidationError(BOTH_IN_FILE_MESSAGE);
  }

  if (file?.emitir !== undefined) {
    return { emit: file.emitir, source: 'file' };
  }

  if (file?.previsualizar === true) {
    return { emit: false, source: 'file' };
  }

  return { emit: input.defaultEmit === true, source: 'default' };
}
