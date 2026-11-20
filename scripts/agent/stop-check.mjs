#!/usr/bin/env node
// Hook Stop de Claude Code. Si src/ cambió desde la última verificación verde de la sesión, corre
// ESLint --fix y los tests relacionados sobre los archivos cambiados, y typecheck del proyecto.
// También corre al terminar un agente que lo declara en su frontmatter (SubagentStop): ahí compara contra
// origin/dev y no contra HEAD, porque el agente suele commitear antes de terminar, en su propio worktree.
// Si algo falla, sale con 2 y Claude sigue trabajando; nunca bloquea dos veces por el mismo diff.
// Detalle y cómo desactivarlo: docs/development.md#trabajar-con-agentes.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const MAX_LINES = 40;
const LINTABLE = /\.(?:[cm]?[jt]sx?|json)$/;
const TESTABLE = /\.(?:[cm]?[jt]sx?)$/;
// Lo que ve quien usa el CLI: comandos (src/cli) y las validaciones y textos de cada módulo. Quedan afuera
// los tests, la storybook (solo desarrollo) y los tipos internos (*.internal.ts).
const CONTRACT = /^src\/(?:cli|modules\/(?!storybook\/)[^/]+)\/(?!(?:.*\/)?__tests__\/)(?!.*\.internal\.ts$)/;
const DOCS = ['CHANGELOG.md', 'README.md', 'llms.txt', 'docs'];

const input = readInput();
const root = run('git', ['rev-parse', '--show-toplevel'], input.cwd ?? process.cwd()).stdout.trim();
if (!root) process.exit(0);

const event = input.hook_event_name === 'SubagentStop' ? 'SubagentStop' : 'Stop';
const base = event === 'SubagentStop' ? mergeBase() || 'HEAD' : 'HEAD';

const changed = changedSourceFiles();
if (changed.length === 0) process.exit(0);

const stampPath = join(
  tmpdir(),
  `arcli-stop-check-${input.session_id ?? 'sin-sesion'}${input.agent_id ? `-${input.agent_id}` : ''}.json`,
);
const stamp = readJson(stampPath);
const before = fingerprint(changed);
if (stamp.green === before) process.exit(0);
if (stamp.failed === before) {
  // Ya se bloqueó una vez por este mismo diff: no insistir, avisarle a la persona.
  writeOutput({ systemMessage: `La verificación de src/ sigue fallando con este diff (hook ${event}).` });
  process.exit(0);
}

const existing = changed.filter((file) => existsSync(join(root, file)));
const lintable = existing.filter((file) => LINTABLE.test(file));
const testable = existing.filter((file) => TESTABLE.test(file));
const failures = [
  lintable.length > 0 && check('ESLint', 'eslint', ['--fix', ...lintable]),
  check('typecheck', 'tsc', ['--project', 'tsconfig.typecheck.json', '--pretty', 'false']),
  testable.length > 0 && check('tests relacionados', 'vitest', ['related', '--run', '--passWithNoTests', ...testable]),
].filter(Boolean);

// ESLint --fix puede haber reformateado: la huella que se guarda es la de después.
const after = fingerprint(changedSourceFiles());

if (failures.length > 0) {
  saveStamp({ ...stamp, failed: after });
  if (event === 'SubagentStop') {
    // Si el agente termina con su informe, el bloqueo puede no llegarle: el aviso le llega igual a quien lo lanzó.
    writeOutput({
      systemMessage: `El agente ${input.agent_type ?? ''} terminó con la verificación de src/ fallida en ${root}: no mergear sin revisarlo.`,
    });
  }
  process.stderr.write(
    `Verificación de src/ fallida (hook ${event}, scripts/agent/stop-check.mjs):\n\n${failures.join('\n\n')}\n\n` +
      'Arreglalo antes de terminar; si el error no lo causó tu cambio, decilo.\n',
  );
  process.exit(2);
}

// El aviso de docs sale una sola vez por sesión: si el cambio era interno, no vuelve a molestar.
const remind = !stamp.reminded && needsDocsReminder(changed);
saveStamp({ ...stamp, green: after, reminded: stamp.reminded || remind });
if (remind) {
  writeOutput({
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext:
        'Cambió src/cli o src/modules (validaciones, mensajes o JSON) y en esta rama no se tocó ningún doc. Si hay un cambio visible para quien ' +
        'usa el CLI, corré la skill sincronizar-docs (tabla de CONTRIBUTING.md#documentación). Si es interno, decilo y seguí.',
    },
  });
}
process.exit(0);

function changedSourceFiles() {
  const tracked = lines(git('diff', '--name-only', base, '--', 'src'));
  return [...new Set([...tracked, ...untracked('src')])].sort();
}

function fingerprint(files) {
  if (files.length === 0) return '';
  const hash = createHash('sha256').update(git('diff', base, '--', 'src'));
  for (const file of untracked('src')) hash.update(file).update(readText(join(root, file)));
  return hash.digest('hex');
}

function needsDocsReminder(files) {
  if (!files.some((file) => CONTRACT.test(file))) return false;
  const branchBase = mergeBase();
  if (!branchBase) return false;
  return lines(git('diff', '--name-only', branchBase, '--', ...DOCS)).length === 0 && untracked(...DOCS).length === 0;
}

function mergeBase() {
  return git('merge-base', 'HEAD', 'origin/dev').trim() || git('merge-base', 'HEAD', 'dev').trim();
}

function check(label, bin, args) {
  const result = run(binPath(bin), args, root);
  if (result.status === 0) return false;
  const output = `${result.stdout}${result.stderr}`.trim().split('\n');
  const shown = output.slice(0, MAX_LINES).join('\n');
  const rest = output.length > MAX_LINES ? `\n… ${output.length - MAX_LINES} líneas más` : '';
  return `## ${label}\n${shown || result.error?.message || 'falló sin salida'}${rest}`;
}

// Un worktree de agente sin `yarn install` usa las herramientas del checkout principal.
function binPath(bin) {
  const local = join(root, 'node_modules', '.bin', bin);
  const main = process.env.CLAUDE_PROJECT_DIR && join(process.env.CLAUDE_PROJECT_DIR, 'node_modules', '.bin', bin);
  return existsSync(local) || !main ? local : main;
}

function untracked(...paths) {
  return lines(git('ls-files', '--others', '--exclude-standard', '--', ...paths));
}

function git(...args) {
  return run('git', args, root).stdout;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { ...result, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function lines(text) {
  return text.split('\n').filter(Boolean);
}

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function readText(path) {
  try {
    return readFileSync(path);
  } catch {
    return '';
  }
}

function saveStamp(value) {
  try {
    writeFileSync(stampPath, JSON.stringify(value));
  } catch {
    // Sin sello solo se pierde el atajo: la próxima vez se vuelve a verificar.
  }
}

function writeOutput(value) {
  process.stdout.write(JSON.stringify(value));
}
