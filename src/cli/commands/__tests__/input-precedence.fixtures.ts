import { Command } from 'commander';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';

import type { VoucherShortcut } from '../../../modules/billing/billing.types';
import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import { EXPORT_VOUCHER_KIND, type ExportVoucherKind } from '../../../modules/export/export.types';
import { parseBillingCommandPlan, registerBillingOptions } from '../billing.command.parser';
import { resolveBillingCommandDefaults } from '../billing.command.shared';
import { registerExportOptions } from '../export.command.options';
import { parseExportCommandPlan } from '../export.command.parser';

/**
 * El arnés de la red de REV-52: del comando (flags por commander, `--cargar` desde el disco y config) al plan que se
 * emite. Entra solo por `parseBillingCommandPlan` y `parseExportCommandPlan`, que no cambian de lugar con la mudanza.
 */

const directory = mkdtempSync(join(tmpdir(), 'arcli-precedence-'));
const inputPath = join(directory, 'comprobante.json');

afterAll(() => {
  rmSync(directory, { force: true, recursive: true });
});

export type Json = Record<string, unknown>;

/** Lo que escribió quien usa el CLI: los flags, el JSON de `--cargar` y la config. */
export interface Written {
  readonly args?: readonly string[];
  readonly config?: Json;
  /** Un objeto es un comprobante y un array, un lote. Sin él no hay `--cargar`. */
  readonly json?: unknown;
}

function parseArgs(command: Command, { args = [], json }: Written): Command {
  if (json !== undefined) {
    writeFileSync(inputPath, JSON.stringify(json), 'utf8');
  }

  command.exitOverride().configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
  command.parse(['node', 'test', ...args, ...(json === undefined ? [] : ['--cargar', inputPath])], { from: 'node' });

  return command;
}

const configOf = (config: Json = {}) => arcliConfigSchema.parse({ cuit: '20111111112', ...config });

export function billingPlan(written: Written, shortcut: VoucherShortcut = 'fb') {
  const command = new Command();

  registerBillingOptions(command);

  return parseBillingCommandPlan(
    parseArgs(command, written),
    shortcut,
    resolveBillingCommandDefaults(configOf(written.config)),
  );
}

/** Un comprobante suelto: la entrada entera y qué nivel decidió emitir. */
export function billingInput(written: Written, shortcut?: VoucherShortcut): Json {
  const plan = billingPlan(written, shortcut);

  expect(plan).toMatchObject({ inputIndexes: [1], invalidItems: [], isBatch: false, total: 1 });
  expect(plan.inputs).toHaveLength(1);

  return { ...plan.inputs[0], modeSource: plan.modeSource };
}

/** `family` registra también los flags de A, B y C, como `arcli factura e` y `arcli nota-credito e`. */
export function exportPlan(
  written: Written,
  voucherKind: ExportVoucherKind = EXPORT_VOUCHER_KIND,
  options: { readonly family?: boolean } = {},
) {
  const command = new Command();

  if (options.family) {
    registerBillingOptions(command);
  }

  registerExportOptions(command, voucherKind, { hidden: options.family });

  return parseExportCommandPlan(parseArgs(command, written), {
    defaultEmit: configOf(written.config).output.emitirPorDefecto,
    voucherKind,
  });
}

export function exportInput(written: Written, voucherKind?: ExportVoucherKind): Json {
  const plan = exportPlan(written, voucherKind);

  expect(plan.input.modeSource).toBe(plan.modeSource);

  return { ...plan.input };
}

/** Los campos que cambian en la entrada, con su valor; lo demás tiene que quedar como sin ese dato. */
export type Level<V> = readonly [value: V, expected: Json];

/** Un dato que se puede escribir en más de un nivel. */
export interface FieldCase<Kind> {
  /** Lo que lleva siempre el comando; por defecto, lo mínimo de la familia. */
  readonly base?: readonly string[];
  readonly baseConfig?: Json;
  /** Lo que agrega `baseConfig` a la entrada, en todos los niveles. */
  readonly baseExpected?: Json;
  readonly config?: ReadonlyArray<Level<Json>>;
  readonly file: ReadonlyArray<Level<Json>>;
  /** Todas las formas de escribirlo en el comando. */
  readonly flags: ReadonlyArray<Level<readonly string[]>>;
  readonly kind?: Kind;
  readonly name: string;
  /** El error si no está en ningún nivel; por defecto, no hace falta. */
  readonly none?: RegExp;
}

/** El mismo valor escrito con el flag y con sus alias. */
export const forms = (
  names: readonly string[],
  value: string,
  field: string,
  expected: unknown,
): Array<Level<readonly string[]>> => names.map((name) => [[name, value], { [field]: expected }]);

interface PrecedenceSuite<Kind> {
  readonly base: readonly string[];
  readonly expected: (field: FieldCase<Kind>) => Json;
  readonly fields: ReadonlyArray<FieldCase<Kind>>;
  readonly parse: (written: Written, kind: Kind | undefined) => Json;
}

/**
 * Por cada dato, qué nivel gana: solo flag, solo archivo, solo config, cada par y los tres. Compara la entrada entera:
 * un nivel que pierde no deja nada, y ninguno toca otro campo.
 */
export function describePrecedence<Kind>({ base, expected, fields, parse }: PrecedenceSuite<Kind>): void {
  it.each(fields)('$name: el flag gana al archivo y el archivo, a la config', (field) => {
    const run = (written: Written) =>
      parse(
        {
          args: [...(field.base ?? base), ...(written.args ?? [])],
          config: { ...field.baseConfig, ...written.config },
          json: written.json,
        },
        field.kind,
      );
    const check = (written: Written, changes: Json) =>
      expect(run(written), JSON.stringify(written)).toEqual({ ...expected(field), ...field.baseExpected, ...changes });

    if (field.none) {
      expect(() => run({})).toThrow(field.none);
      expect(() => run({ json: {} })).toThrow(field.none);
    } else {
      check({}, {});
      check({ json: {} }, {});
    }

    for (const [args, changes] of field.flags) {
      check({ args }, changes);

      for (const [json] of field.file) {
        check({ args, json }, changes);

        for (const [config] of field.config ?? []) {
          check({ args, config }, changes);
          check({ args, config, json }, changes);
        }
      }
    }

    for (const [json, changes] of field.file) {
      check({ json }, changes);

      for (const [config] of field.config ?? []) {
        check({ config, json }, changes);
      }
    }

    for (const [config, changes] of field.config ?? []) {
      check({ config }, changes);
    }
  });
}

/** Solo los campos que importan en el caso, para no atar un cruce al resto de la entrada. */
export function pick(input: Json, expected: Json): Json {
  return Object.fromEntries(Object.keys(expected).map((key) => [key, input[key]]));
}

/** El JSON de varios datos: los de un mismo objeto (`comprobanteAsociado`) se juntan. */
export function mergeJson(parts: readonly Json[]): Json {
  const merged: Json = {};

  for (const [key, value] of parts.flatMap((part) => Object.entries(part))) {
    const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);

    merged[key] = isObject ? { ...(merged[key] as Json | undefined), ...value } : value;
  }

  return merged;
}
