import { Separator } from '@inquirer/core';
import { beforeEach, expect, it, vi } from 'vitest';

import type { ConfigField } from '../../../modules/interactive/config-fields';
import { BACK } from '../../../modules/interactive/wizard';
import { stripAnsi } from '../../../ui';
import { normalize, saveFullConfig, useConfigKeysFixture } from '../../__tests__/config-keys.fixture';
import { runConfigMenu } from '../config.flow';
import { askTextStep, chooseOne, chooseOrTypeStep, chooseStep } from '../prompts';

/**
 * "Modificar configuración" con cada clave (REV-37): las secciones, el orden, la etiqueta y el valor de la lista, y la
 * pregunta de cada dato con su aclaración, sus opciones y lo que propone. No es contrato. Para regenerarlo a propósito:
 * `yarn test src/cli/interactive/__tests__/config.flow.characterization.test.ts -u`, y revisar el diff.
 */

vi.mock('../prompts', () => ({
  askTextStep: vi.fn(),
  chooseOne: vi.fn(),
  chooseOrTypeStep: vi.fn(),
  chooseStep: vi.fn(),
  confirm: vi.fn(),
  fitPageSize: () => 12,
}));

// Sin la tabla de actividades de WSFEX, que se consulta a ARCA: la actividad se escribe.
vi.mock('../../arca-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../arca-runtime')>()),
  loadArcaRuntime: () => {
    throw new Error('sin ARCA');
  },
}));

const FIELD_LIST = '¿Qué querés modificar?';

useConfigKeysFixture();

beforeEach(() => {
  [askTextStep, chooseOne, chooseOrTypeStep, chooseStep].forEach((prompt) => vi.mocked(prompt).mockReset());
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

/** Un valor interno ("Borrar", "Dejar sin configurar") por su nombre. */
const shown = (value: unknown) =>
  typeof value === 'symbol' ? String(value) : value === undefined ? 'nada' : `"${String(value)}"`;

/** Recorre la lista: entra en cada dato y vuelve sin cambiarlo. */
async function describeMenu(): Promise<string[]> {
  const lines: string[] = [];
  const questions: string[] = [];
  let fields: ConfigField[] = [];
  let next = 0;

  const ask = (...question: readonly string[]) => {
    questions.push(...question);

    return Promise.resolve(BACK);
  };

  vi.mocked(chooseOne).mockResolvedValueOnce('cambiar').mockResolvedValueOnce('volver');
  vi.mocked(askTextStep).mockImplementation((message, options) =>
    ask(`    escribe: ${message}`, `      propone ${shown(options?.defaultValue)}`),
  );
  vi.mocked(chooseOrTypeStep).mockImplementation((message, rows, options) => {
    // La tabla de monedas entera no: las primeras y la cuenta.
    const listed = rows.length > 20 ? [...rows.slice(0, 3), ...rows.slice(-1)] : rows;

    return ask(
      `    elige o escribe: ${message}`,
      ...listed.map((row) => `      ${shown(row.value)} ${row.label}`),
      ...(rows.length > 20 ? [`      (${rows.length} filas)`] : []),
      `      propone ${shown(options.previous)}`,
    );
  });
  vi.mocked(chooseStep).mockImplementation(async (message, choices, defaultValue) => {
    if (message !== FIELD_LIST) {
      return ask(
        `    elige: ${message}`,
        ...choices.map((choice) =>
          Separator.isSeparator(choice) ? '      ---' : `      ${shown(choice.value)} ${choice.name}`,
        ),
        `      propone ${shown(defaultValue)}`,
      );
    }

    if (next === 0) {
      fields = choices.flatMap((choice) => (Separator.isSeparator(choice) ? [] : [choice.value as ConfigField]));
      lines.push(
        ...choices.map((choice) =>
          Separator.isSeparator(choice)
            ? stripAnsi(choice.separator).trim()
            : `  ${choice.name}: ${choice.description} [${(choice.value as ConfigField).key}]`,
        ),
      );
    }

    next += 1;

    const field = fields[next - 1];

    if (!field) {
      return BACK;
    }

    questions.push(`  ${field.key}`);

    return field as never;
  });

  await runConfigMenu();

  return [...lines, '', 'Preguntas', ...questions];
}

it('la lista y la pregunta de cada dato, sin nada guardado y con todo', async () => {
  const lines = ['# Ninguna clave', ...(await describeMenu())];

  saveFullConfig();
  lines.push('', '# Todas las claves', ...(await describeMenu()), '');

  await expect(normalize(lines.join('\n'))).toMatchFileSnapshot('config.flow.characterization.txt');
});
