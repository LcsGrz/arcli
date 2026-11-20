import { describe, expect, it } from 'vitest';

import { decide } from '../guard-bash.mjs';

describe('guard-bash', () => {
  describe('Stryker', () => {
    it.each([
      'npx stryker run',
      'npx @stryker-mutator/core run stryker.config.mjs',
      'yarn stryker run',
      'cd /tmp && HOME=/tmp/x npx stryker run',
      'node_modules/.cache/arcli-stryker/node_modules/.bin/stryker run reports/stryker/stryker.config.json',
    ])('bloquea la corrida directa: %s', (command) => {
      expect(decide(command)?.decision).toBe('deny');
    });

    it.each([
      'node scripts/agent/stryker.mjs src/lib/identity',
      'grep -n "stryker run" docs/backlog/test12-stryker.md',
      'npx stryker --version',
      "python3 - <<'EOF'\ns = '| `stryker run` directo'\nnpx stryker run\nEOF\necho listo",
      'cat > notas.md <<EOF\nnpx stryker run\nEOF',
      'git commit -m "docs: stryker run solo con el script; npx stryker run está bloqueado"',
    ])('deja pasar: %s', (command) => {
      expect(decide(command)).toBeUndefined();
    });
  });

  describe('gh pr create', () => {
    it.each([
      ['gh pr create --title x --body y', 'fix/algo'],
      ['gh pr create --base main --title x', 'fix/algo'],
      ['gh pr create --base fix/otro-pr --title x', 'fix/algo'],
      ['git push -u origin HEAD && gh pr create -B main', 'feat/x'],
    ])('bloquea %s desde %s', (command, branch) => {
      expect(decide(command, branch)?.decision).toBe('deny');
    });

    it.each([
      ['gh pr create --base dev --title x', 'fix/algo'],
      ['gh pr create --base=dev', 'fix/algo'],
      ['gh pr create --base main --title v2.6.0', 'release/v2.6.0'],
      ['gh pr create --base main --head hotfix/tls', 'dev'],
      ['gh pr create --base dev --head main --title "chore: main → dev"', 'dev'],
      ['gh pr create -R autor/arcli --base su-rama --head LcsGrz:fix/x-revision', 'fix/x-revision'],
      ['gh pr view 12 --json base', 'fix/algo'],
    ])('deja pasar %s desde %s', (command, branch) => {
      expect(decide(command, branch)).toBeUndefined();
    });
  });

  describe('producción', () => {
    it.each([
      'arcli fe factura c --entorno produccion',
      'yarn dev config set entorno produccion',
      'yarn -s dev ultimo --entorno=produccion',
      'ARCLI_CONFIG_DIR=/tmp/x node dist/cli/index.js estado --entorno producción',
      'npx arcli padron 20111111112 --entorno produccion',
    ])('pregunta antes de: %s', (command) => {
      expect(decide(command)?.decision).toBe('ask');
    });

    it.each(['arcli fe factura c --entorno testing', 'grep -rn "produccion" docs', 'yarn test src/modules/config'])(
      'deja pasar: %s',
      (command) => {
        expect(decide(command)).toBeUndefined();
      },
    );
  });
});
