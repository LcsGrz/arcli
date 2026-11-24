import { HELP_SUGGESTION } from '../../lib/errors/app-error';
import { INPUT_ISSUES_MESSAGE, type InputIssue } from '../../lib/errors/input-issue';
import { errorPanel } from '../components/errorPanel';
import { bold } from '../primitives/text';

/**
 * Los problemas de una entrada que no pasó el esquema (un `ZodError` ya descripto por el dominio). Con `message`, el
 * error lo explica el dominio: el panel muestra ese texto y su sugerencia, sin la lista de problemas.
 */
export function formatInputIssues(
  issues: readonly InputIssue[],
  options: { readonly message?: string; readonly suggestion?: string } = {},
): string {
  if (options.message) {
    return errorPanel('Error de entrada', options.message, [], options.suggestion ?? HELP_SUGGESTION);
  }

  return errorPanel(
    'Error de entrada',
    INPUT_ISSUES_MESSAGE,
    issues.map((issue) => `${bold(`${issue.label}:`)} ${issue.mensaje}`),
    HELP_SUGGESTION,
  );
}
