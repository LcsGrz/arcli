import { HELP_SUGGESTION } from '../../lib/errors/app-error';
import type { InputIssue } from '../../lib/errors/input-issue';
import { saysWhatToDo } from '../../lib/text/says-what-to-do';
import { errorPanel } from '../components/errorPanel';
import { renderJson } from '../primitives/renderJson';
import { bold } from '../primitives/text';

const INPUT_ISSUES_MESSAGE = 'Hay parámetros inválidos o incompletos en la entrada.';

/**
 * Los problemas de una entrada que no pasó el esquema (un `ZodError` ya descripto por el dominio). Con `message`, el
 * error lo explica el dominio: el panel muestra ese texto y su sugerencia, y `detalles` sigue con los problemas.
 */
export function formatInputIssues(
  issues: readonly InputIssue[],
  useJson: boolean,
  options: { readonly message?: string; readonly suggestion?: string } = {},
): string {
  if (useJson) {
    return renderJson({
      codigo: 'INPUT_VALIDATION_ERROR',
      detalles: issues.map((issue) => ({ mensaje: issue.mensaje, ruta: issue.ruta })),
      error: options.message ?? INPUT_ISSUES_MESSAGE,
      sugerencia: options.suggestion ?? null,
    });
  }

  if (options.message) {
    return errorPanel(
      'Error de entrada',
      options.message,
      [],
      options.suggestion ?? (saysWhatToDo(options.message) ? undefined : HELP_SUGGESTION),
    );
  }

  return errorPanel(
    'Error de entrada',
    INPUT_ISSUES_MESSAGE,
    issues.map((issue) => `${bold(`${issue.label}:`)} ${issue.mensaje}`),
    HELP_SUGGESTION,
  );
}
