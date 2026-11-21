import { BILLING_RULES } from '../../../modules/billing/billing.rules';
import type { BillingCommandInput } from '../../../modules/billing/billing.schemas';
import type { BillingRuleScope } from '../../../modules/interactive/billing-optionals';
import { completeDateInput } from '../../../modules/interactive/date-input';
import { scopedRuleValidator } from '../../../modules/interactive/rule-validator';
import type { Lens } from '../../../modules/interactive/steps/lens';
import { BACK, type WizardDependency, type WizardStep } from '../../../modules/interactive/wizard';
import { askTextStep } from '../prompts';
import { validateDate } from '../validators';

export interface DateStepDef<S> {
  readonly name: string;
  readonly message: string | ((state: S) => string);
  readonly date: Lens<S, string>;
  /**
   * El formato y las reglas de la fecha, con lo que el flujo sabe (lo respondido hasta ahi). `retry`: se volvio a la
   * pregunta por un error de `finalize`, con todas las respuestas a la vista.
   */
  readonly validate: (state: S, retry: boolean) => (value: string) => string | true;
  /** Enter la deja sin fecha (como sin el flag), en lugar de ser un error del validador. */
  readonly optional?: boolean;
  /** Lo que escribe ademas de la fecha. */
  readonly write?: (date: string | undefined, state: S) => Partial<S>;
  readonly dependsOn?: readonly WizardDependency[];
  readonly skip?: (state: S) => boolean;
  /** Los campos de la entrada que escribe, para `finalize`. */
  readonly writes?: readonly string[];
}

/** La ayuda de toda pregunta de fecha: lo que se puede escribir ademas de la fecha (TUI-18). */
const DATE_INPUT_HINT = 'hoy, ayer, +N o -N';

/**
 * Una fecha, escrita como en los flags (`10`, `15/11`, `15/11/2026`, `hoy`, `-3`) y guardada completa en dd/mm/aaaa
 * (REV-74, #13): el comando equivalente pegado otro dia u otro mes sigue dando la misma fecha, y la linea de
 * respuesta muestra esa fecha, no la palabra. Al volver arranca escrita.
 */
export function dateStep<S>(def: DateStepDef<S>): WizardStep<S> {
  return {
    dependsOn: def.dependsOn,
    name: def.name,
    run: async (state, { error, previous }) => {
      const answer = await askTextStep(typeof def.message === 'string' ? def.message : def.message(state), {
        answered: (value) => (value ? completeDateInput(value) : value),
        inputHelp: DATE_INPUT_HINT,
        previousAnswer: previous ? def.date.get(previous as S) : undefined,
        validate: def.validate(state, error !== undefined),
      });

      if (answer === BACK) {
        return BACK;
      }

      const date = def.optional && !answer.trim() ? undefined : completeDateInput(answer);

      return def.write ? def.write(date, state) : def.date.set(date, state);
    },
    skip: def.skip,
    writes: def.writes,
  };
}

export interface ServicePeriodStepsDef<S> {
  /** Prefijo de los dos pasos: `servicio` da `servicio-desde` y `servicio-hasta`. */
  readonly prefix: string;
  readonly from: Lens<S, string>;
  readonly to: Lens<S, string>;
  /** Las reglas del flujo, para el orden de las fechas (10032). */
  readonly rules: (state: S) => BillingRuleScope;
  /** Lo respondido hasta ahi de la entrada (el otro extremo del periodo, la fecha del comprobante). */
  readonly answered: (state: S) => Partial<BillingCommandInput>;
  readonly skip?: (state: S) => boolean;
}

/**
 * "Servicio desde:" y "Servicio hasta:", con la regla del orden (10032) sobre lo respondido hasta ahi. Lo comparten el
 * opcional "Período del servicio" y "Otro período" en "Repetir".
 */
export function servicePeriodSteps<S>(def: ServicePeriodStepsDef<S>): Array<WizardStep<S>> {
  const end = (side: 'desde' | 'hasta', field: 'serviceEndDate' | 'serviceStartDate', date: Lens<S, string>) =>
    dateStep<S>({
      date,
      message: `Servicio ${side}:`,
      name: `${def.prefix}-${side}`,
      skip: def.skip,
      validate: (state) =>
        scopedRuleValidator(
          BILLING_RULES,
          field,
          def.rules(state),
          (value) => ({ ...def.answered(state), [field]: completeDateInput(value) }),
          validateDate,
        ),
      writes: [field],
    });

  return [end('desde', 'serviceStartDate', def.from), end('hasta', 'serviceEndDate', def.to)];
}
