import type { Command } from 'commander';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { configPublicKeySchema } from '../../modules/config/config.schemas';
import { DEPRECATED_CONFIG_KEYS } from '../../modules/config/config.service';
import { createProgram } from '../program';

/**
 * Comandos, flags (también los alias ocultos) y claves de config son contrato público (ver AGENTS.md). Este test
 * los compara con la lista commiteada en `public-contract.txt`: docs-sync.test.ts revisa que lo del código esté en
 * los docs, y este, que lo que ya se publicó no desaparezca del código sin que se note.
 *
 * Para actualizar la lista después de agregar algo: `yarn contrato:actualizar`.
 */
const CONTRACT_FILE = new URL('public-contract.txt', import.meta.url);
const UPDATE = process.env.ARCLI_ACTUALIZAR_CONTRATO === '1';

const UPDATE_COMMAND = '`yarn contrato:actualizar`';

const HEADER = [
  '# Contrato público de ARCLI: comandos, flags (incluidos los alias ocultos) y claves de config.',
  '# Lo genera `yarn contrato:actualizar` desde commander y el esquema de config; no se edita a mano.',
  '# Una línea que se va es un cambio que rompe: ver "Contrato público" en AGENTS.md.',
];

function collectCommands(program: Command): string[] {
  const entries: string[] = [];
  const walk = (command: Command, path: string[]) => {
    const name = ['arcli', ...path].join(' ');
    entries.push(`comando ${name}`);
    for (const alias of command.aliases()) {
      entries.push(`comando ${['arcli', ...path.slice(0, -1), alias].join(' ')}`);
    }
    for (const option of command.options) {
      for (const flag of [option.short, option.long]) {
        if (flag) entries.push(`flag ${name} ${flag}`);
      }
    }
    for (const sub of command.commands) walk(sub, [...path, sub.name()]);
  };
  walk(program, []);
  return entries;
}

function currentContract(): string[] {
  const configKeys = [...configPublicKeySchema.options, ...Object.keys(DEPRECATED_CONFIG_KEYS)].map(
    (key) => `clave ${key}`,
  );
  return [...new Set([...collectCommands(createProgram()), ...configKeys])].sort();
}

function savedContract(): string[] {
  try {
    return readFileSync(CONTRACT_FILE, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
  } catch {
    return [];
  }
}

const current = currentContract();
if (UPDATE) writeFileSync(CONTRACT_FILE, `${[...HEADER, ...current].join('\n')}\n`);
const saved = UPDATE ? current : savedContract();

const list = (entries: string[]) => entries.map((entry) => `  - ${entry}`).join('\n');

describe('contrato público', () => {
  it('encuentra comandos, flags y claves', () => {
    expect(current.filter((entry) => entry.startsWith('comando ')).length).toBeGreaterThan(10);
    expect(current.filter((entry) => entry.startsWith('flag ')).length).toBeGreaterThan(10);
    expect(current.filter((entry) => entry.startsWith('clave ')).length).toBeGreaterThan(10);
  });

  it('no saca comandos, flags ni claves de config', () => {
    const removed = saved.filter((entry) => !current.includes(entry));

    if (removed.length > 0) {
      expect.fail(
        [
          'Desapareció del código algo que es contrato público:',
          list(removed),
          '',
          'Comandos, flags (también los alias ocultos) y claves de config los usan scripts y agentes de terceros.',
          'Lo viejo no se saca ni se renombra en silencio: tiene que seguir andando, deprecado, hasta la próxima',
          'versión mayor (ver "Contrato público" en AGENTS.md). Si fue sin querer, volvé a agregarlo. Si es una',
          `salida planeada para una versión mayor, corré ${UPDATE_COMMAND} y explicalo en el PR y en CHANGELOG.md.`,
        ].join('\n'),
      );
    }
  });

  it('la lista incluye todo lo nuevo', () => {
    const added = current.filter((entry) => !saved.includes(entry));

    if (added.length > 0) {
      expect.fail(
        [
          'Hay comandos, flags o claves que no están en src/cli/__tests__/public-contract.txt:',
          list(added),
          '',
          `Corré ${UPDATE_COMMAND} para sumarlos y commiteá la lista: así lo nuevo queda en el diff del PR y pasa a`,
          'ser contrato público (ver AGENTS.md).',
        ].join('\n'),
      );
    }
  });
});

/**
 * Los códigos de error son contrato del JSON (`codigo`): cada uno de la tabla de docs/input-output.md tiene que
 * existir en `src/` y cada uno de `src/`, estar en la tabla. La fila `PDF_*` cubre los códigos que lista la sección
 * "Errores del PDF".
 */
const NOT_ERROR_CODES = new Set([
  'PUPPETEER_EXECUTABLE_PATH', // variable de entorno que se muestra en el diagnóstico del PDF
]);

const root = new URL('../../../', import.meta.url);
const inputOutput = readFileSync(new URL('docs/input-output.md', root), 'utf8');

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n${heading}\n`);
  if (start === -1) throw new Error(`No está la sección "${heading}" en docs/input-output.md`);
  const rest = markdown.slice(start + heading.length + 2);
  const end = rest.search(/\n#{1,3} /);
  return end === -1 ? rest : rest.slice(0, end);
}

function documentedErrorCodes(): string[] {
  const codes = section(inputOutput, '### Códigos de error')
    .split('\n')
    .map((line) => /^\| `([A-Z][A-Z0-9_]*(?:\*)?)`/.exec(line)?.[1])
    .filter((code): code is string => code !== undefined);
  const pdfCodes = [...section(inputOutput, '### Errores del PDF').matchAll(/`(PDF_[A-Z0-9_]+)`/g)].map(
    (match) => match[1] ?? '',
  );

  return [...new Set(codes.flatMap((code) => (code === 'PDF_*' ? pdfCodes : [code])))].sort();
}

function sourceFiles(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(new URL(`${entry.name}/`, dir));
    return entry.name.endsWith('.ts') ? [new URL(entry.name, dir)] : [];
  });
}

function sourceErrorCodes(): string[] {
  const codes = sourceFiles(new URL('src/', root)).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)'/g)].map((match) => match[1] ?? ''),
  );

  return [...new Set(codes)].filter((code) => !NOT_ERROR_CODES.has(code)).sort();
}

describe('códigos de error documentados', () => {
  const documented = documentedErrorCodes();
  const inSource = sourceErrorCodes();

  it('encuentra códigos para revisar', () => {
    expect(documented.length).toBeGreaterThan(10);
    expect(inSource.length).toBeGreaterThan(10);
  });

  it('cada código de la tabla de docs/input-output.md existe en src/', () => {
    expect(documented.filter((code) => !inSource.includes(code))).toEqual([]);
  });

  it('cada código de src/ está en la tabla de docs/input-output.md', () => {
    // Si el literal no es un código de error (una variable de entorno, por ejemplo), sumalo a NOT_ERROR_CODES.
    expect(inSource.filter((code) => !documented.includes(code))).toEqual([]);
  });
});
