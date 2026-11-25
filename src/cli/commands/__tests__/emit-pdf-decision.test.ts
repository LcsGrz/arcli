import { Command } from 'commander';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import type { ArcliPdfMode } from '../../../modules/config/config.schemas';
import { EXPORT_VOUCHER_KIND } from '../../../modules/export/export.kinds';
import { type PdfDecision, resolvePdfDecision } from '../../../modules/pdf/pdf-decision';
import { parseBillingCommandPlan, registerBillingOptions } from '../billing.command.parser';
import { registerExportOptions } from '../export.command.options';
import { parseExportCommandPlan } from '../export.command.parser';

/**
 * Caracterización de ARQ8-2: emitir o no, y el PDF, con todas las combinaciones de flags, archivo de `--cargar` y
 * config, a través de los parsers reales de A/B/C (`billing.command.parser.ts`) y de la E (`export.command.parser.ts`).
 * Fija lo que pasa hoy, antes de unir las dos copias en una función: el refactor tiene que dar lo mismo, incluidos los
 * textos de error, que difieren a propósito entre familias hasta REV-58.
 *
 * La config llega como la pasan los comandos: `emitir` es `output.emitirPorDefecto` (`defaultEmit`) y `pdf` es el modo
 * que recibe `resolvePdfDecision`, que es lo que deciden `billing.command.pdf.ts` y `export.command.pdf.ts`.
 */

const directory = mkdtempSync(join(tmpdir(), 'arcli-emit-pdf-'));
let fileCount = 0;

afterAll(() => {
  rmSync(directory, { force: true, recursive: true });
});

type Family = 'A/B/C' | 'E';

/** Un comprobante válido de cada familia, sin nada que decida emitir ni el PDF. */
const BASE: Readonly<Record<Family, Record<string, unknown>>> = {
  'A/B/C': {
    concepto: 'servicios',
    ivaReceptor: 'consumidor-final',
    montoTotal: 1000,
    numeroDocumento: 0,
    tipoDocumento: 'consumidor-final',
  },
  E: { cliente: 'ACME LLC', domicilioCliente: '123 Main St', montoTotal: 1500, numero: 1, paisDestino: 212 },
};

/** Un comprobante suelto o un lote (array). */
function writeFile(content: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>): string {
  const path = join(directory, `comprobante-${(fileCount += 1)}.json`);

  writeFileSync(path, JSON.stringify(content), 'utf8');

  return path;
}

interface Parsed {
  readonly dryRun?: boolean;
  readonly emit: boolean;
  readonly modeSource: 'default' | 'file' | 'flags';
  readonly pdf: boolean | undefined;
}

/** Corre el parser real de la familia con `--cargar` y los flags, y devuelve lo que decidió. */
function parse(
  family: Family,
  file: Record<string, unknown>,
  flags: readonly string[],
  defaultEmit: boolean | undefined,
): Parsed {
  const path = writeFile({ ...BASE[family], ...file });
  const command = new Command();

  if (family === 'E') {
    registerExportOptions(command, EXPORT_VOUCHER_KIND);
    command.parse(['node', 'test', '--cargar', path, ...flags], { from: 'node' });

    const plan = parseExportCommandPlan(command, { defaultEmit });

    return { emit: plan.input.emit, modeSource: plan.modeSource, pdf: plan.input.pdf };
  }

  registerBillingOptions(command);
  command.parse(['node', 'test', '--cargar', path, ...flags], { from: 'node' });

  const plan = parseBillingCommandPlan(command, 'fc', { defaultEmit });
  const [input] = plan.inputs;

  return { dryRun: input?.dryRun, emit: Boolean(input?.emit), modeSource: plan.modeSource, pdf: input?.pdf };
}

const FAMILIES: readonly Family[] = ['A/B/C', 'E'];

/** Los textos de los dos flags a la vez: cada familia tiene el suyo y así quedan hasta REV-58. */
const BOTH_FLAGS_ERROR: Readonly<Record<Family, string>> = {
  'A/B/C': 'Usá `--emitir` o `--previsualizar`, pero no ambos a la vez.',
  E: 'Usá `--emitir` o `--previsualizar`, no los dos.',
};

const BOTH_IN_FILE_ERROR = 'En el archivo usá "emitir" o "previsualizar", pero no ambos en true.';

const BOTH_PDF_FLAGS_ERROR = 'Usá `--exportar-pdf` o `--sin-pdf`, pero no ambos a la vez.';

/** Ausente, true o false: lo que puede traer una clave booleana del JSON de `--cargar`. */
const FILE_VALUES = [undefined, true, false] as const;

function fileWith(values: Readonly<Record<string, boolean | undefined>>): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, boolean] => entry[1] !== undefined),
  );
}

const describeValue = (value: boolean | undefined) => (value === undefined ? 'ausente' : String(value));

describe('emitir: flags × archivo × config (caracterización de ARQ8-2)', () => {
  const FLAGS = {
    '--emitir': ['--emitir'],
    '--previsualizar': ['--previsualizar'],
    'los dos': ['--emitir', '--previsualizar'],
    ninguno: [],
  } as const satisfies Record<string, readonly string[]>;

  type FlagCase = keyof typeof FLAGS;

  type Expected =
    { readonly emit: boolean; readonly modeSource: Parsed['modeSource'] } | { readonly error: 'archivo' | 'flags' };

  /**
   * La regla de hoy, nivel por nivel: decide el primer nivel que diga algo y es error que uno pida las dos cosas.
   * En el archivo, `"previsualizar": false` no dice nada: sin `"emitir"`, decide la config.
   */
  function expected(
    flags: FlagCase,
    file: { readonly emitir?: boolean; readonly previsualizar?: boolean },
    config: boolean | undefined,
  ): Expected {
    if (flags === 'los dos') {
      return { error: 'flags' };
    }

    if (flags !== 'ninguno') {
      return { emit: flags === '--emitir', modeSource: 'flags' };
    }

    if (file.emitir === true && file.previsualizar === true) {
      return { error: 'archivo' };
    }

    if (file.emitir !== undefined) {
      return { emit: file.emitir, modeSource: 'file' };
    }

    if (file.previsualizar === true) {
      return { emit: false, modeSource: 'file' };
    }

    return { emit: config === true, modeSource: 'default' };
  }

  const CASES = (Object.keys(FLAGS) as FlagCase[]).flatMap((flags) =>
    FILE_VALUES.flatMap((emitir) =>
      FILE_VALUES.flatMap((previsualizar) =>
        [true, false, undefined].map((config) => ({ config, emitir, flags, previsualizar })),
      ),
    ),
  );

  describe.each(FAMILIES)('%s', (family) => {
    it.each(CASES)(
      'flags $flags, archivo emitir $emitir y previsualizar $previsualizar, config emitir $config',
      ({ config, emitir, flags, previsualizar }) => {
        const file = fileWith({ emitir, previsualizar });
        const want = expected(flags, { emitir, previsualizar }, config);
        const run = () => parse(family, file, FLAGS[flags], config);

        if ('error' in want) {
          expect(run).toThrow(want.error === 'flags' ? BOTH_FLAGS_ERROR[family] : BOTH_IN_FILE_ERROR);

          return;
        }

        const parsed = run();

        expect({ emit: parsed.emit, modeSource: parsed.modeSource }).toEqual(want);

        if (family === 'A/B/C') {
          // A/B/C también arma `dryRun`, y el servicio no emite si es true: tiene que ser siempre lo contrario de `emit`.
          expect(parsed.dryRun).toBe(!want.emit);
        }
      },
    );
  });

  it('sin nada que lo pida, ninguna familia emite', () => {
    for (const family of FAMILIES) {
      expect(parse(family, {}, [], undefined)).toMatchObject({ emit: false, modeSource: 'default' });
      expect(parse(family, { previsualizar: false }, [], false)).toMatchObject({ emit: false, modeSource: 'default' });
    }
  });

  it('A/B/C y la E deciden lo mismo en cada combinación; solo cambia el texto de los dos flags', () => {
    const outcome = (family: Family, flags: FlagCase, file: Record<string, boolean>, config: boolean | undefined) => {
      try {
        const { emit, modeSource } = parse(family, file, FLAGS[flags], config);

        return { emit, modeSource };
      } catch (error) {
        return { error: (error as Error).message };
      }
    };
    const differences = CASES.flatMap(({ config, emitir, flags, previsualizar }) => {
      const file = fileWith({ emitir, previsualizar });
      const abc = outcome('A/B/C', flags, file, config);
      const e = outcome('E', flags, file, config);

      return JSON.stringify(abc) === JSON.stringify(e)
        ? []
        : [
            `flags ${flags}, archivo emitir ${describeValue(emitir)} y previsualizar ${describeValue(previsualizar)}, config ${describeValue(config)}: ${JSON.stringify(abc)} / ${JSON.stringify(e)}`,
          ];
    });

    expect(differences).toHaveLength(FILE_VALUES.length * FILE_VALUES.length * 3);
    expect(differences.every((line) => line.startsWith('flags los dos,'))).toBe(true);
  });
});

describe('PDF: flags × archivo × config (caracterización de ARQ8-2)', () => {
  const FLAGS = {
    '--exportar-pdf': ['--exportar-pdf'],
    '--exportar-pdf y --sin-pdf': ['--exportar-pdf', '--sin-pdf'],
    '--pdf': ['--pdf'],
    '--pdf y --sin-pdf': ['--pdf', '--sin-pdf'],
    '--sin-pdf': ['--sin-pdf'],
    ninguno: [],
  } as const satisfies Record<string, readonly string[]>;

  type FlagCase = keyof typeof FLAGS;

  const MODES: ReadonlyArray<ArcliPdfMode | undefined> = ['siempre', 'nunca', 'preguntar', undefined];

  /** Los flags ganan; sin flags, `"pdf"` del archivo; sin ninguno, queda sin decidir para la config. */
  function expectedFlag(flags: FlagCase, file: boolean | undefined): boolean | 'error' | undefined {
    if (flags.includes(' y ')) {
      return 'error';
    }

    if (flags === '--exportar-pdf' || flags === '--pdf') {
      return true;
    }

    return flags === '--sin-pdf' ? false : file;
  }

  /** Lo que se hace con el PDF de un comprobante emitido: el flag (o el archivo) gana, y si no, la config. */
  function expectedDecision(flag: boolean | undefined, mode: ArcliPdfMode | undefined, interactive: boolean) {
    if (flag !== undefined) {
      return flag ? 'generar' : 'omitir';
    }

    if (mode === 'siempre') {
      return 'generar';
    }

    if (mode === 'nunca') {
      return 'omitir';
    }

    return interactive ? 'preguntar' : 'omitir';
  }

  const CASES = (Object.keys(FLAGS) as FlagCase[]).flatMap((flags) => FILE_VALUES.map((pdf) => ({ flags, pdf })));

  describe.each(FAMILIES)('%s', (family) => {
    it.each(CASES)('flags $flags, archivo pdf $pdf', ({ flags, pdf }) => {
      const want = expectedFlag(flags, pdf);
      const run = () => parse(family, fileWith({ pdf }), FLAGS[flags], undefined);

      if (want === 'error') {
        expect(run).toThrow(BOTH_PDF_FLAGS_ERROR);

        return;
      }

      const parsed = run();

      expect(parsed.pdf).toBe(want);

      const decisions: Record<string, PdfDecision> = {};
      const expectedDecisions: Record<string, PdfDecision> = {};

      for (const mode of MODES) {
        for (const interactive of [true, false]) {
          const key = `config ${mode ?? 'ausente'}, ${interactive ? 'con' : 'sin'} terminal`;

          decisions[key] = resolvePdfDecision({ flag: parsed.pdf, interactive, mode });
          expectedDecisions[key] = expectedDecision(want, mode, interactive);
        }
      }

      expect(decisions).toEqual(expectedDecisions);
    });
  });

  it('el PDF no cambia si se emite o no: la decisión de emitir no lo toca', () => {
    for (const family of FAMILIES) {
      expect(parse(family, { pdf: true }, ['--previsualizar'], true).pdf).toBe(true);
      expect(parse(family, { emitir: true }, ['--sin-pdf'], false).pdf).toBe(false);
    }
  });
});

describe('emitir en un lote de `--cargar` (caracterización de ARQ8-2)', () => {
  it('cada ítem decide por su cuenta y el plan toma el nivel más alto que decidió alguno', () => {
    const path = writeFile([{ ...BASE['A/B/C'], emitir: true }, { ...BASE['A/B/C'] }]);
    const command = new Command();

    registerBillingOptions(command);
    command.parse(['node', 'test', '--cargar', path], { from: 'node' });

    const plan = parseBillingCommandPlan(command, 'fc', { defaultEmit: false });

    expect(plan).toMatchObject({ inputIndexes: [1, 2], invalidItems: [], isBatch: true, total: 2 });
    // El primero emite por el archivo (fuente `file`); el segundo, sin "emitir", queda en la config (fuente `default`).
    expect(plan.inputs.map((input) => ({ dryRun: input.dryRun, emit: input.emit }))).toEqual([
      { dryRun: false, emit: true },
      { dryRun: true, emit: false },
    ]);
    // El lote junta las fuentes: `flags` gana sobre `file` y `file` sobre `default`.
    expect(plan.modeSource).toBe('file');
  });
});

describe('emitir sin `--cargar`: flags × config (caracterización de ARQ8-2)', () => {
  /** Los mismos datos de `BASE`, por flags. */
  const DATA_FLAGS: Readonly<Record<Family, readonly string[]>> = {
    'A/B/C': ['--concepto', 'servicios', '--ir', 'consumidor-final', '--monto', '1000', '--cfinal'],
    E: [
      '--cliente',
      'ACME LLC',
      '--domicilio-cliente',
      '123 Main St',
      '--monto',
      '1500',
      '--numero',
      '1',
      '--pais-destino',
      '212',
    ],
  };

  function parseFlags(family: Family, flags: readonly string[], defaultEmit: boolean | undefined) {
    const command = new Command();
    const argv = ['node', 'test', ...DATA_FLAGS[family], ...flags];

    if (family === 'E') {
      registerExportOptions(command, EXPORT_VOUCHER_KIND);
      command.parse(argv, { from: 'node' });

      const plan = parseExportCommandPlan(command, { defaultEmit });

      return { emit: plan.input.emit, modeSource: plan.modeSource };
    }

    registerBillingOptions(command);
    command.parse(argv, { from: 'node' });

    const plan = parseBillingCommandPlan(command, 'fc', { defaultEmit });

    expect(plan.inputs[0]?.dryRun).toBe(!plan.inputs[0]?.emit);

    return { emit: Boolean(plan.inputs[0]?.emit), modeSource: plan.modeSource };
  }

  const CASES = [
    { config: true, flags: ['--emitir'], want: { emit: true, modeSource: 'flags' } },
    { config: false, flags: ['--emitir'], want: { emit: true, modeSource: 'flags' } },
    { config: undefined, flags: ['--emitir'], want: { emit: true, modeSource: 'flags' } },
    { config: true, flags: ['--previsualizar'], want: { emit: false, modeSource: 'flags' } },
    { config: false, flags: ['--previsualizar'], want: { emit: false, modeSource: 'flags' } },
    { config: undefined, flags: ['--previsualizar'], want: { emit: false, modeSource: 'flags' } },
    { config: true, flags: [], want: { emit: true, modeSource: 'default' } },
    { config: false, flags: [], want: { emit: false, modeSource: 'default' } },
    { config: undefined, flags: [], want: { emit: false, modeSource: 'default' } },
  ] as const;

  describe.each(FAMILIES)('%s', (family) => {
    it.each(CASES)('flags $flags, config emitir $config', ({ config, flags, want }) => {
      expect(parseFlags(family, flags, config)).toEqual(want);
    });

    it('con los dos flags, el error de la familia', () => {
      expect(() => parseFlags(family, ['--emitir', '--previsualizar'], undefined)).toThrow(BOTH_FLAGS_ERROR[family]);
    });
  });
});
