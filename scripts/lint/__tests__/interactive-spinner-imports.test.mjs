import { ESLint, Linter } from 'eslint';
import eslintTS from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

/**
 * ARQ-11 PR 5: en el asistente una espera a ARCA nueva no puede quedar sin Ctrl+C, asi que sus archivos no importan el
 * spinner directo (la espera va por la del asistente). Se mira la config que ESLint calcula para cada archivo y se
 * corren solo sus `no-restricted-imports`, sin lint tipado, sobre un import de ejemplo.
 */
const eslint = new ESLint();

async function restrictedImports(file, code) {
  const { rules = {} } = await eslint.calculateConfigForFile(file);
  const restricting = Object.fromEntries(
    Object.entries(rules).filter(([name]) => name.endsWith('no-restricted-imports')),
  );

  return new Linter()
    .verify(
      code,
      [
        {
          files: ['**/*.ts'],
          languageOptions: { parser: eslintTS.parser },
          plugins: { '@typescript-eslint': eslintTS.plugin },
          rules: restricting,
        },
      ],
      file,
    )
    .map(({ message, ruleId }) => `${ruleId}: ${message}`);
}

describe('el spinner en el asistente', () => {
  it.each([
    ['src/cli/interactive/queries.flow.ts', "import { withSpinner } from '../spinner';"],
    ['src/cli/interactive/status.flow.ts', "import { queryWithSpinner } from '../spinner';"],
    ['src/cli/interactive/session.ts', "import { withPendingSpinner } from '../pending-spinner';"],
    ['src/cli/interactive/steps/export.ts', "import { withSpinner } from '../../spinner';"],
  ])('%s no lo importa directo', async (file, code) => {
    expect(await restrictedImports(file, code)).not.toEqual([]);
  });

  it.each([
    ['src/cli/commands/billing.command.shared.ts', "import { withSpinner } from '../spinner';"],
    ['src/cli/monotributo-report.ts', "import { withSpinner } from './spinner';"],
  ])('fuera del asistente, %s lo sigue importando', async (file, code) => {
    expect(await restrictedImports(file, code)).toEqual([]);
  });
});
