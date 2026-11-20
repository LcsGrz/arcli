#!/usr/bin/env node
// Hook PreToolUse (Bash) de Claude Code: frena los comandos que rompen reglas del repo antes de que corran, para
// la sesión principal y para los agentes. Lo que es irreversible se bloquea; lo que a veces se pide a propósito
// (ARCLI contra producción) se pregunta. Detalle: docs/development.md#trabajar-con-agentes.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/**
 * Qué hacer con un comando. `branch` es la rama actual de quien lo corre (para `gh pr create` sin `--head`).
 * Devuelve `undefined` si no hay nada que objetar.
 * @param {string} command
 * @param {string} [branch]
 * @returns {{ decision: 'deny' | 'ask', reason: string } | undefined}
 */
export function decide(command, branch = '') {
  for (const words of segments(command)) {
    const result = stryker(words) ?? prCreate(words, branch) ?? production(words);
    if (result) return result;
  }
  return undefined;
}

function stryker(words) {
  const [first = '', second = ''] = words;
  const runner = ['npx', 'bunx', 'yarn', 'pnpm'].includes(first) ? second : first;
  const isStryker = /(?:^|\/)stryker(?:\.js)?$/.test(runner) || runner.startsWith('@stryker-mutator/core');
  if (!isStryker || !words.includes('run')) return undefined;
  return {
    decision: 'deny',
    reason:
      'Stryker se corre solo con `node scripts/agent/stryker.mjs` (HOME aislado y watchdog sobre la config real). ' +
      'Directo, el 19/11 pisó la config de quien lo corría.',
  };
}

function prCreate(words, branch) {
  if (words[0] !== 'gh' || words[1] !== 'pr' || words[2] !== 'create') return undefined;
  // Un PR de arreglos contra la rama de un tercero (skill revisar-pr) va a su fork, no a este repo.
  if (words.some((word) => word === '-R' || word.startsWith('--repo'))) return undefined;
  const base = flag(words, '--base', '-B');
  const head = flag(words, '--head', '-H') ?? branch;
  if (base === 'dev') return undefined;
  if (base === 'main' && /^(?:release|hotfix)\//.test(head)) return undefined;
  const why =
    base === undefined
      ? 'Sin `--base`, el PR va a `main` (la rama default).'
      : base === 'main'
        ? `A \`main\` solo van releases (\`release/vX.Y.Z\`) y hotfixes (\`hotfix/…\`); la rama es \`${head || 'desconocida'}\`.`
        : `La base es siempre \`dev\`, nunca la rama de otro PR (\`${base}\`).`;
  return { decision: 'deny', reason: `${why} Usá \`gh pr create --base dev\`.` };
}

function production(words) {
  const [first = '', second = '', third = ''] = words;
  const runsCli =
    /(?:^|\/)arcli$/.test(first) ||
    (['npx', 'bunx'].includes(first) && second === 'arcli') ||
    (first === 'yarn' && (second === 'dev' || (second.startsWith('-') && third === 'dev'))) ||
    (first === 'node' && words.some((word) => /(?:^|\/)dist\/cli\/index\.js$/.test(word))) ||
    (first === 'tsx' && words.some((word) => /(?:^|\/)src\/cli\/index\.ts$/.test(word)));
  if (!runsCli || !words.some((word) => /^(?:--entorno=)?producci[oó]n$/.test(word))) return undefined;
  return {
    decision: 'ask',
    reason:
      'Este comando usa ARCA producción. Solo con un pedido explícito de quien mantiene el proyecto, y nunca para emitir.',
  };
}

function flag(words, long, short) {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === long || word === short) return words[index + 1];
    if (word.startsWith(`${long}=`)) return word.slice(long.length + 1);
  }
  return undefined;
}

// Parte un comando de shell en invocaciones (por `;`, `&&`, `||`, `|`, `&`, saltos de línea, `$(` y backticks) y
// saca las asignaciones de entorno del principio. Lo que está entre comillas y el cuerpo de un heredoc son datos,
// no comandos: un `grep "stryker run"` o un texto que se escribe a un archivo no cuentan como corrida. No es un
// parser de shell completo, alcanza para reconocer el programa y sus argumentos.
function segments(command) {
  const result = [];
  let words = [];
  const finish = () => {
    let start = 0;
    const skipAssignments = () => {
      while (start < words.length && /^[A-Za-z_]\w*=/.test(words[start])) start += 1;
    };
    skipAssignments();
    if (words[start] === 'env' || words[start] === 'exec') start += 1;
    skipAssignments();
    if (start < words.length) result.push(words.slice(start));
    words = [];
  };
  const token =
    /<<-?\s*(['"]?)(\w+)\1|"(?:\\.|[^"\\])*"|'[^']*'|\$\(|&&|\|\||[;|&\n`()]|[^\s;|&`()"']+(?:(?:"(?:\\.|[^"\\])*"|'[^']*')[^\s;|&`()"']*)*/g;
  for (let match = token.exec(command); match; match = token.exec(command)) {
    const [text, , heredoc] = match;
    if (heredoc) {
      // El cuerpo va desde la línea siguiente hasta la línea que es solo el delimitador.
      const end = new RegExp(`\\n\\s*${heredoc}\\s*(?:\\n|$)`, 'g');
      const bodyStart = command.indexOf('\n', token.lastIndex);
      if (bodyStart === -1) continue;
      end.lastIndex = bodyStart;
      const close = end.exec(command);
      token.lastIndex = close ? close.index + close[0].length : command.length;
      finish();
    } else if (/^(?:\$\(|&&|\|\||[;|&\n`()])$/.test(text)) {
      finish();
    } else {
      words.push(text.replace(/"((?:\\.|[^"\\])*)"|'([^']*)'/g, (_, double, single) => double ?? single));
    }
  }
  finish();
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.exit(0);
  }
  const command = input.tool_input?.command;
  if (typeof command !== 'string') process.exit(0);
  const branch = command.includes('gh') ? currentBranch(input.cwd) : '';
  const result = decide(command, branch);
  if (result) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: result.decision,
          permissionDecisionReason: result.reason,
        },
      }),
    );
  }
  process.exit(0);
}

function currentBranch(cwd) {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: cwd ?? process.cwd(),
    encoding: 'utf8',
  });
  return result.stdout?.trim() ?? '';
}
