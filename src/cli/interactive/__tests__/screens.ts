import { Separator } from '@inquirer/select';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { expect, vi } from 'vitest';

import { BillingService } from '../../../modules/billing/billing.service';
import { ExportService } from '../../../modules/export/export.service';
import type { ResolvedExportVoucher } from '../../../modules/export/export.types';
import type { RowEdits } from '../../../modules/interactive/row-marks';
import { BACK } from '../../../modules/interactive/wizard';
import { type RowActionsListRow, stripAnsi } from '../../../ui';
import type { Choice, ChooseOrTypeStepOptions, EditRowsOptions, FilterListRow, TextStepOptions } from '../prompts';
import { SKIP_ROW } from '../text-hints';

import { chooseOrTypeInitialTerm, createScript, type ScriptedAnswer } from './script';

/**
 * Golden de pantallas del asistente (NAV-0): un camino guionado con `createScript` graba, en orden, cada pregunta (tipo,
 * mensaje, opciones con las deshabilitadas y su motivo, lo que arranca marcado o escrito, los intentos rechazados y la
 * respuesta), lo que se escribe en la terminal (la vista previa), el comando equivalente y la solicitud a ARCA. La
 * transcripcion se compara con un archivo de `__golden__/pantallas/`, como los golden del `--json`
 * (`src/cli/__tests__/json-golden.test.ts`): para regenerarlos a proposito, `yarn test <archivo> -u` y revisar el diff.
 *
 * Es texto plano: sin color, sin ancho de terminal (los paneles salen con su ancho por defecto), con `\n` y sin la
 * carpeta temporal del sistema, asi da lo mismo en Windows, Linux y macOS.
 */

type Event =
  | { readonly kind: 'output'; readonly text: string }
  | { readonly kind: 'prompt'; readonly lines: readonly string[] }
  | { readonly kind: 'section'; readonly lines: readonly string[]; readonly title: string };

/** Texto de terminal comparable entre sistemas: sin ANSI, con `\n`, sin espacios al final ni la carpeta temporal. */
function normalizeScreen(text: string): string {
  return stripAnsi(text)
    .replace(/\r\n?/g, '\n')
    .split(tmpdir())
    .join('<tmp>')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
}

function describeValue(value: unknown): string {
  if (value === BACK) {
    return '← Volver';
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  return JSON.stringify(value) ?? String(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || isDeepStrictEqual(a, b);
}

function choiceLabel<T>(choice: Choice<T>): string {
  return normalizeScreen(choice.name);
}

/** Una opcion de lista, con su descripcion y, si esta deshabilitada, el motivo. */
function formatChoice<T>(item: Choice<T> | Separator, mark: string): string {
  if (Separator.isSeparator(item)) {
    const text = normalizeScreen(item.separator).trim();

    return `    ${text ? `--- ${text}` : '---'}`;
  }

  const description = item.description ? ` — ${normalizeScreen(item.description)}` : '';
  const disabled =
    item.disabled === undefined || item.disabled === false
      ? ''
      : ` (deshabilitada${typeof item.disabled === 'string' ? `: ${normalizeScreen(item.disabled)}` : ''})`;

  return `  ${mark} ${choiceLabel(item)}${description}${disabled}`;
}

function nameOf<T>(choices: ReadonlyArray<Choice<T> | Separator>, value: unknown): string {
  if (value === BACK) {
    return '← Volver';
  }

  const choice = choices.find(
    (item): item is Choice<T> => !Separator.isSeparator(item) && sameValue(item.value, value),
  );

  return choice ? choiceLabel(choice) : `(fuera de la lista: ${describeValue(value)})`;
}

/** JSON con las claves ordenadas: un cambio en el orden en que se arma la solicitud no es un cambio de lo que va. */
function stableJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, inner: unknown) =>
      inner && typeof inner === 'object' && !Array.isArray(inner)
        ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
        : inner,
    2,
  );
}

/**
 * Un guion que graba la pantalla. `prompts` reemplaza a `../prompts` en el `vi.mock` del archivo de tests; `write`, a
 * `process.stdout.write`. Al terminar, `section` agrega el comando equivalente y la solicitud, y `transcript` da el
 * texto que se compara.
 */
export function createScreens(steps: ReadonlyArray<readonly [RegExp, ScriptedAnswer]>) {
  const script = createScript(steps);
  const events: Event[] = [];

  async function chooseStep<T>(
    message: string,
    choices: ReadonlyArray<Choice<T> | Separator>,
    defaultValue?: T,
  ): Promise<T | typeof BACK> {
    const answer = (await script.chooseStep(message, choices, defaultValue)) as T | typeof BACK;
    const marked = defaultValue === undefined ? '(ninguna)' : nameOf(choices, defaultValue);

    events.push({
      kind: 'prompt',
      lines: [
        `? [lista] ${normalizeScreen(message)}`,
        `  arranca en: ${marked}`,
        ...choices.map((item) =>
          formatChoice(item, !Separator.isSeparator(item) && sameValue(item.value, defaultValue) ? '>' : '·'),
        ),
        `  = ${nameOf(choices, answer)}`,
      ],
    });

    return answer;
  }

  async function chooseManyStep<T>(
    message: string,
    choices: ReadonlyArray<Choice<T>>,
    selected: readonly T[] = [],
  ): Promise<T[] | typeof BACK> {
    const answer = (await script.chooseManyStep(message, choices, selected)) as T[] | typeof BACK;
    const isSelected = (value: T) => selected.some((item) => sameValue(item, value));

    events.push({
      kind: 'prompt',
      lines: [
        `? [seleccion multiple] ${normalizeScreen(message)}`,
        ...choices.map((item) => formatChoice(item, isSelected(item.value) ? '[x]' : '[ ]')),
        `  = ${
          answer === BACK
            ? '← Volver'
            : answer.length === 0
              ? '(nada marcado)'
              : answer.map((value) => nameOf(choices, value)).join(', ')
        }`,
      ],
    });

    return answer;
  }

  async function askTextStep(message: string, options: TextStepOptions = {}): Promise<string | typeof BACK> {
    const rejected: string[] = [];
    const validate = options.validate;
    const answer = (await script.askTextStep(message, {
      ...options,
      validate: validate
        ? (value) => {
            const result = validate(value);

            if (result !== true) {
              rejected.push(`  rechaza ${JSON.stringify(value)}: ${normalizeScreen(result)}`);
            }

            return result;
          }
        : undefined,
    })) as string | typeof BACK;

    events.push({
      kind: 'prompt',
      lines: [
        `? [texto] ${normalizeScreen(message)}`,
        // Se ve solo mientras se responde: la linea de la respuesta queda con la pregunta sola.
        ...(options.hint ? [`  aclara al preguntar: ${options.hint}`] : []),
        ...(options.inputHelp ? [`  ayuda: ${options.inputHelp}`] : []),
        ...(options.previousAnswer?.trim() ? [`  arranca escrito: ${JSON.stringify(options.previousAnswer)}`] : []),
        ...(options.defaultValue === undefined ? [] : [`  por defecto: ${JSON.stringify(options.defaultValue)}`]),
        ...(validate ? [] : ['  sin validacion']),
        ...rejected,
        `  = ${answer === BACK ? '← Volver' : JSON.stringify(answer)}`,
        ...(answer !== BACK && options.answered && options.answered(answer) !== answer
          ? [`  queda: ${JSON.stringify(options.answered(answer))}`]
          : []),
      ],
    });

    return answer;
  }

  async function chooseFromFilterList<T>(
    message: string,
    rows: ReadonlyArray<FilterListRow<T>>,
    options: { readonly defaultValue?: T } = {},
  ): Promise<T | typeof BACK> {
    const answer = (await script.chooseFromFilterList(message, rows, options)) as T | typeof BACK;
    const label = (value: unknown) =>
      value === BACK
        ? '← Volver'
        : normalizeScreen(
            rows.find((row) => sameValue(row.value, value))?.label ?? `(fuera de la lista: ${describeValue(value)})`,
          );

    events.push({
      kind: 'prompt',
      lines: [
        `? [lista con filtro] ${normalizeScreen(message)}`,
        `  arranca en: ${options.defaultValue === undefined ? '(ninguna)' : label(options.defaultValue)}`,
        ...rows.map(
          (row) =>
            `  ${sameValue(row.value, options.defaultValue) ? '>' : '·'} ${normalizeScreen(row.label)}${row.keywords ? ` (busca tambien: ${row.keywords})` : ''}`,
        ),
        `  = ${label(answer)}`,
      ],
    });

    return answer;
  }

  /**
   * La lista donde tambien se escribe (TUI-35): las filas (en una opcional, primero la de "sin valor"), lo que arranca
   * marcado o escrito, lo escrito que se rechaza y la respuesta, que puede ser una fila, lo escrito o "sin valor".
   */
  async function chooseOrTypeStep<T>(
    message: string,
    rows: ReadonlyArray<FilterListRow<T>>,
    options: ChooseOrTypeStepOptions<T>,
  ): Promise<T | typeof BACK | undefined> {
    const rejected: string[] = [];
    const { validate } = options;
    const answer = (await script.chooseOrTypeStep(message, rows, {
      ...options,
      validate: validate
        ? (value) => {
            const result = validate(value);

            if (result !== true) {
              rejected.push(`  rechaza ${JSON.stringify(value)}: ${normalizeScreen(result)}`);
            }

            return result;
          }
        : undefined,
    })) as T | typeof BACK | undefined;
    const emptyLabel = options.optional && rows.length > 0 ? (options.emptyLabel ?? SKIP_ROW) : undefined;
    const typed = chooseOrTypeInitialTerm(rows, options);
    const previousRow = rows.find((row) => sameValue(row.value, options.previous));
    // Sin `previous` de la lista, la primera fila: en una opcional, la de "sin valor".
    const marked = previousRow ? previousRow.label : (emptyLabel ?? rows[0]?.label);
    const label = (value: unknown) => {
      if (value === BACK) return '← Volver';
      if (value === undefined) return emptyLabel ?? '(sin valor)';

      const row = rows.find((item) => sameValue(item.value, value));

      return row ? normalizeScreen(row.label) : `(escrito: ${describeValue(value)})`;
    };

    events.push({
      kind: 'prompt',
      lines: [
        `? [${rows.length > 0 ? 'lista o texto' : 'texto, sin filas'}] ${normalizeScreen(message)}`,
        ...(options.header ? [`  encabezado: ${normalizeScreen(options.header)}`] : []),
        ...(options.help ? [`  ayuda: ${normalizeScreen(options.help)}`] : []),
        ...(typed
          ? [`  arranca escrito: ${JSON.stringify(typed)}`]
          : rows.length > 0
            ? [`  arranca en: ${marked === undefined ? '(ninguna)' : normalizeScreen(marked)}`]
            : []),
        ...(emptyLabel ? [`  ${!typed && marked === emptyLabel ? '>' : '·'} ${emptyLabel}`] : []),
        ...rows.map(
          (row) =>
            `  ${!typed && row.label === marked ? '>' : '·'} ${normalizeScreen(row.label)}${row.keywords ? ` (busca tambien: ${row.keywords})` : ''}`,
        ),
        ...(validate ? [] : ['  sin validacion']),
        ...rejected,
        `  = ${label(answer)}`,
      ],
    });

    return answer;
  }

  async function editRowsStep(
    message: string,
    rows: ReadonlyArray<Omit<RowActionsListRow, 'mark'>>,
    options: EditRowsOptions,
  ): Promise<RowEdits | typeof BACK> {
    const answer = await script.editRowsStep(message, rows, options);
    const marked = (index: number) => {
      if (answer === BACK) return '·';
      if (answer.remove.includes(index)) return '[borrar]';

      return answer.edit.includes(index) ? '[modificar]' : '·';
    };

    events.push({
      kind: 'prompt',
      lines: [
        `? [editor] ${normalizeScreen(message)}`,
        ...rows.map(
          (row, index) =>
            `  ${marked(index)} ${normalizeScreen(row.title)} — ${normalizeScreen(row.detail)} = ${normalizeScreen(row.total)}`,
        ),
        `  ${answer !== BACK && answer.add ? '[agregar]' : '·'} ${normalizeScreen(options.addLabel)}`,
        `  = ${answer === BACK ? '← Volver' : answer.add || answer.edit.length > 0 || answer.remove.length > 0 ? 'aplicar' : 'sin cambios'}`,
      ],
    });

    return answer;
  }

  /** La lista que se ve mientras carga: no consume el guion (ver `createScript`). */
  async function chooseStepWhileLoading<T, L>(
    message: string,
    choices: ReadonlyArray<Choice<T> | Separator>,
    defaultValue: T | undefined,
    pageSize: number,
    loading: Promise<L>,
  ): Promise<{ loaded: L }> {
    events.push({
      kind: 'prompt',
      lines: [`? [lista mientras carga] ${normalizeScreen(message)}`, '  = (sigue cuando termina la carga)'],
    });

    return { loaded: await loading };
  }

  return {
    /** Las preguntas, en orden, como las ve `createScript`. */
    asked: script.asked,
    prompts: {
      askTextStep,
      chooseFromFilterList,
      chooseManyStep,
      chooseOrTypeStep,
      chooseOne: <T>(message: string, choices: ReadonlyArray<Choice<T> | Separator>, defaultValue?: T) =>
        chooseStep(message, choices, defaultValue),
      chooseStep,
      chooseStepWhileLoading,
      confirm: (message: string, yesLabel: string, noLabel = 'Cancelar') =>
        chooseStep(message, [
          { name: yesLabel, value: true },
          { name: noLabel, value: false },
        ]),
      editRowsStep,
    },
    remaining: script.remaining,
    /** El guion de abajo: sus `mock.calls` tienen lo que recibio cada pregunta (opciones, validador, lo marcado). */
    script,
    section(title: string, text: string): void {
      events.push({ kind: 'section', lines: normalizeScreen(text).split('\n'), title });
    },
    transcript(): string {
      const out: string[] = [];
      let screen: string[] = [];
      const flush = () => {
        if (screen.length > 0) {
          out.push(
            '== pantalla ==',
            ...normalizeScreen(screen.join(''))
              .replace(/^\n+|\n+$/g, '')
              .split('\n'),
            '',
          );
          screen = [];
        }
      };

      for (const event of events) {
        if (event.kind === 'output') {
          screen.push(event.text);
          continue;
        }

        flush();
        out.push(...(event.kind === 'section' ? [`== ${event.title} ==`, ...event.lines] : event.lines), '');
      }

      flush();

      return `${out.join('\n').trimEnd()}\n`;
    },
    /** Reemplazo de `process.stdout.write`: lo escrito entra en la transcripcion entre las preguntas. */
    write(chunk: unknown): boolean {
      events.push({ kind: 'output', text: String(chunk) });

      return true;
    },
  };
}

export type Screens = ReturnType<typeof createScreens>;

/**
 * Sin color ni ancho de terminal conocido, como en un pipe: los colores y el ancho de los paneles no dependen de donde
 * corre la suite. Devuelve como restaurarlo.
 */
export function withoutTerminal(): () => void {
  const streams = [process.stdout, process.stderr];
  const saved = streams.map((stream) => ({
    columns: Object.getOwnPropertyDescriptor(stream, 'columns'),
    isTTY: Object.getOwnPropertyDescriptor(stream, 'isTTY'),
    stream,
  }));

  for (const stream of streams) {
    Object.defineProperty(stream, 'columns', { configurable: true, value: undefined, writable: true });
    Object.defineProperty(stream, 'isTTY', { configurable: true, value: false, writable: true });
  }

  return () => {
    for (const { columns, isTTY, stream } of saved) {
      for (const [key, descriptor] of [
        ['columns', columns],
        ['isTTY', isTTY],
      ] as const) {
        if (descriptor) {
          Object.defineProperty(stream, key, descriptor);
        } else {
          delete (stream as unknown as Record<string, unknown>)[key];
        }
      }
    }
  };
}

/** Compara la transcripcion con su golden: `__golden__/pantallas/<nombre>.txt`, al lado del archivo de tests. */
export async function expectScreens(screens: Screens, name: string): Promise<void> {
  expect(screens.remaining(), 'quedaron respuestas del guion sin preguntar').toBe(0);
  await expect(screens.transcript()).toMatchFileSnapshot(`__golden__/pantallas/${name}.txt`);
}

/**
 * Corre un flujo grabando la pantalla en `screens` y, al final, agrega la solicitud a ARCA: la de la vista previa de A,
 * B y C (`buildVoucherPayload`; al emitir solo se suman `CbteDesde` y `CbteHasta`) o la de la E (`FEXAuthorize`, la que
 * resuelve `ExportService`). Los golden no emiten: la respuesta a "¿Emitimos?" es no.
 */
export async function recordFlow(
  screens: Screens,
  run: () => Promise<unknown>,
): Promise<{ readonly billingPayload?: Record<string, unknown>; readonly exportPayload?: Record<string, unknown> }> {
  const billing = vi.spyOn(BillingService.prototype, 'buildVoucherPayload');
  const exported = vi.spyOn(ExportService.prototype, 'resolve');
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => screens.write(chunk));

  try {
    await run();
  } finally {
    write.mockRestore();
  }

  const billingPayload = billing.mock.results.findLast((result) => result.type === 'return')?.value as
    Record<string, unknown> | undefined;
  const exportResult = exported.mock.settledResults.findLast((result) => result.type === 'fulfilled');
  const exportPayload = (exportResult?.value as ResolvedExportVoucher | undefined)?.payload as
    Record<string, unknown> | undefined;

  billing.mockRestore();
  exported.mockRestore();

  if (billingPayload) {
    screens.section('solicitud a ARCA (FECAESolicitar, sin el numero)', stableJson(billingPayload));
  }

  if (exportPayload) {
    screens.section('solicitud a ARCA (FEXAuthorize)', stableJson(exportPayload));
  }

  return { billingPayload, exportPayload };
}
