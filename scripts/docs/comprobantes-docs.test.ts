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
