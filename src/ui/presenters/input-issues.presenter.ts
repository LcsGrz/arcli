import { HELP_SUGGESTION } from '../../lib/errors/app-error';
import type { InputIssue } from '../../lib/errors/input-issue';
import { errorPanel } from '../components/errorPanel';
import { renderJson } from '../primitives/renderJson';
import { bold } from '../primitives/text';

const INPUT_ISSUES_MESSAGE = 'Hay parámetros inválidos o incompletos en la entrada.';

/** Los problemas de una entrada que no pasó el esquema (un `ZodError` ya descripto por el dominio). */
export function formatInputIssues(issues: readonly InputIssue[], useJson: boolean): string {
  if (useJson) {
    return renderJson({
      codigo: 'INPUT_VALIDATION_ERROR',
      detalles: issues.map((issue) => ({ mensaje: issue.mensaje, ruta: issue.ruta })),
      error: INPUT_ISSUES_MESSAGE,
      sugerencia: null,
    });
  }

  return errorPanel(
    'Error de entrada',
    INPUT_ISSUES_MESSAGE,
    issues.map((issue) => `${bold(`${issue.label}:`)} ${issue.mensaje}`),
    HELP_SUGGESTION,
  );
}
