import { Command } from 'commander';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { OPTIONS, VOUCHER_PAGES } from './comprobantes';
import { renderAll } from './comprobantes-md';
import { EXPORT_VOUCHER_KINDS } from '../../src/modules/export/export.types';
import { registerBillingOptions } from '../../src/cli/commands/billing.command.options';
import { registerExportOptions } from '../../src/cli/commands/export.command.options';
import { registerGlobalOptions } from '../../src/cli/global-options';

/**
 * `docs/comprobantes/` se genera desde `scripts/docs/comprobantes.ts`, la única fuente de las opciones de cada
 * comprobante. Si falla: `yarn docs:comprobantes`, o sumá a `comprobantes.ts` el flag que falta.
 */
const dir = new URL('../../docs/comprobantes/', import.meta.url);

/** Flags que no van en las páginas de comprobantes, con el motivo. */
const NOT_IN_VOUCHER_PAGES = new Set([
  '--dia', // deprecado: --vencimiento
]);

function cliFlags(): Set<string> {
  const command = new Command();

  registerBillingOptions(command);
  registerGlobalOptions(command);
  for (const kind of EXPORT_VOUCHER_KINDS) registerExportOptions(command, kind);

  return new Set(
    command.options.flatMap((option) => [option.long, option.short]).filter((flag): flag is string => Boolean(flag)),
  );
}

function documentedFlags(): Set<string> {
  const flags = new Set<string>();

  for (const option of Object.values(OPTIONS)) {
    const rows =
      typeof option.rows === 'function'
        ? ['a', 'b', 'c'].flatMap((letter) =>
            (option.rows as (l: 'a' | 'b' | 'c') => readonly (readonly string[])[])(letter as 'a'),
          )
        : option.rows;

    for (const [short, long] of rows) {
      for (const token of `${short} ${long}`.match(/(?<![\w-])--?[a-z][a-z0-9-]*/g) ?? []) flags.add(token);
    }
  }

  for (const option of Object.values(OPTIONS)) {
    for (const token of option.text.match(/`(--?[a-z][a-z0-9-]*)`/g) ?? []) flags.add(token.replace(/`/g, ''));
  }

  return flags;
}

describe('docs/comprobantes', () => {
  it('están al día con scripts/docs/comprobantes.ts', () => {
    const expected = renderAll();
    const onDisk = readdirSync(dir).filter((file) => file.endsWith('.md'));

    expect(onDisk.sort()).toEqual([...expected.keys()].sort());
    for (const [file, text] of expected) expect(readFileSync(new URL(file, dir), 'utf8'), file).toBe(text);
  });

  it('documenta todos los flags de los comprobantes', () => {
    const documented = documentedFlags();
    const missing = [...cliFlags()].filter(
      (flag) => flag.startsWith('--') && !documented.has(flag) && !NOT_IN_VOUCHER_PAGES.has(flag),
    );

    expect(missing).toEqual([]);
  });

  it('no nombra flags que el CLI no tiene', () => {
    const known = cliFlags();
    const unknown = [...documentedFlags()].filter((flag) => !known.has(flag));

    expect(unknown).toEqual([]);
  });

  it('cada comprobante tiene título, atajo y archivo únicos', () => {
    for (const key of ['title', 'atajo', 'file'] as const) {
      const values = VOUCHER_PAGES.map((page) => page[key]);

      expect(new Set(values).size, key).toBe(values.length);
    }
  });
});

/**
 * La grilla de atajos de `docs/comandos.md` (`<!-- arcli: atajos -->` y la tabla de abajo) está escrita a mano: tiene
 * que nombrar cada comprobante de `VOUCHER_PAGES` una vez, en la columna de su letra, con el link a su página y en la
 * fila de su comando. La de `docs/comprobantes/README.md` la genera `comprobantes-md.ts` (la controla el primer test).
 */
const COMMANDS_DOC = new URL('../../docs/comandos.md', import.meta.url);

interface GridCell {
  readonly atajo: string;
  readonly href: string;
  readonly letter: string;
  readonly row: string;
}

function gridCells(markdown: string): GridCell[] {
  const table = markdown.match(/<!-- arcli: atajos -->\n+((?:\|.*\n?)+)/)?.[1];

  if (!table) throw new Error('falta la grilla de atajos');

  const [head = '', , ...rows] = table.trim().split('\n');
  const split = (line: string) =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
  const letters = split(head).slice(1);

  return rows.flatMap((line) => {
    const [row = '', ...cells] = split(line);

    return cells.flatMap((cell, index) => {
      const link = cell.match(/^\[`([a-z]+)`\]\(([^)]+)\)$/);

      return link ? [{ atajo: link[1]!, href: link[2]!, letter: letters[index]!.toLowerCase(), row }] : [];
    });
  });
}

describe('grilla de atajos de docs/comandos.md', () => {
  const cells = gridCells(readFileSync(COMMANDS_DOC, 'utf8'));
  const pageOf = (atajo: string) => VOUCHER_PAGES.find((page) => page.atajo === atajo);

  it('tiene cada comprobante una vez, con su página y en la columna de su letra', () => {
    expect(cells.map((cell) => cell.atajo).sort()).toEqual(VOUCHER_PAGES.map((page) => page.atajo).sort());
    for (const cell of cells) {
      expect({ href: cell.href, letter: cell.letter }, cell.atajo).toEqual({
        href: `comprobantes/${pageOf(cell.atajo)?.file}`,
        letter: pageOf(cell.atajo)?.letter,
      });
    }
  });

  it('cada fila es la de su comando (`arcli nota-credito-electronica a` → `nota-credito-electronica`)', () => {
    for (const cell of cells) {
      expect(cell.row, cell.atajo).toBe(`\`${pageOf(cell.atajo)?.familiaComando.split(' ')[1]}\``);
    }
  });
});
