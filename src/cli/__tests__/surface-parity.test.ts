import { Separator } from '@inquirer/core';
import type { Command } from 'commander';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { OPERATIONS, type SurfaceCoverage } from '../../modules/operations/operations';
import { stripAnsi } from '../../ui';
import { runInteractiveMode } from '../interactive/interactive-mode';
import { listSelect } from '../interactive/list-select';
import { createProgram } from '../program';
import { APP_COMMANDS, APP_SCREENS, ASSISTANT_COVERAGE, COMMAND_COVERAGE } from '../surface-coverage';

/**
 * Cada operación está en los comandos y en el asistente, o dice por qué no (ARQ-5). Los comandos salen de commander y
 * las pantallas, de recorrer los menús del asistente.
 */
vi.mock('../spinner', () => ({
  queryWithSpinner: (_text: unknown, run: () => unknown) => run(),
  startSpinner: () => null,
  withSpinner: (_text: unknown, run: () => unknown) => run(),
}));
vi.mock('../interactive/list-select', async (original) => ({
  ...(await original<typeof import('../interactive/list-select')>()),
  listSelect: vi.fn(),
}));
vi.mock('../interactive/session', async (original) => ({
  ...(await original<typeof import('../interactive/session')>()),
  createInteractiveSession: () => ({
    arca: {},
    runtime: { certificateNotices: [], config: {}, cuit: 20111111112, environment: 'testing', pointOfSale: 3 },
  }),
}));
// Lee las novedades de la red.
vi.mock('../interactive/update.flow', () => ({ runUpdateFlow: async () => false }));
vi.mock('../../modules/parameters/health', () => ({ checkArcaHealth: async () => 'funcionando' }));
vi.mock('../../modules/update-check/update-check.service', () => ({
  checkForUpdate: async () => ({ currentVersion: '2.0.0', latestVersion: '99.0.0' }),
}));

const MAIN_MENU = '¿Qué querés hacer?';

/** Los menús cuyas opciones son, cada una, una operación. El resto de las opciones hace algo por su cuenta. */
const isDeclaredParent = (screen: string) =>
  [...Object.values(ASSISTANT_COVERAGE).flatMap(({ en }) => en), ...Object.keys(APP_SCREENS)].some((place) =>
    place.startsWith(`${screen} > `),
  );

/** Lo que muestra el menú, sin color, sin "(nuevo)" ni el número de versión. */
const screenName = (name: string) =>
  stripAnsi(name)
    .replace(/ \(nuevo\)$/, '')
    .replace(/ \d+\.\d+\.\d+$/, '');

interface Commands {
  readonly flags: ReadonlyMap<string, readonly string[]>;
  readonly paths: readonly string[];
}

function walkCommands(program: Command): Commands {
  const flags = new Map<string, readonly string[]>();
  const walk = (command: Command, path: string) => {
    for (const sub of command.commands) {
      const subPath = path ? `${path} ${sub.name()}` : sub.name();

      flags.set(
        subPath,
        sub.options.flatMap(({ long }) => (long ? [long] : [])),
      );
      walk(sub, subPath);
    }
  };

  walk(program, '');

  return { flags, paths: [...flags.keys()] };
}

/**
 * Abre el asistente y entra a cada opción del menú principal: lo primero que pregunta son las opciones de su submenú,
 * y ahí se cancela. Lo que no pregunta con una lista no tiene submenú.
 */
async function walkAssistant(): Promise<ReadonlyMap<string, readonly string[]>> {
  const screens = new Map<string, readonly string[]>();
  let pending: string[] | undefined;
  let current = '';

  vi.mocked(listSelect).mockImplementation(async ({ back, choices, message }) => {
    const options = choices.flatMap((choice) => (Separator.isSeparator(choice) ? [] : [choice]));

    if (stripAnsi(message) !== MAIN_MENU) {
      // La primera pregunta, que no es un submenú: "Falta completar la configuración".
      if (pending && !screens.has(current)) {
        screens.set(
          current,
          options.map(({ name }) => screenName(name)),
        );
      }

      throw Object.assign(new Error('Ctrl+C'), { name: 'ExitPromptError' });
    }

    expect(back).toBeUndefined();

    const names = options.map(({ name }) => screenName(name));

    if (!pending) {
      pending = names.filter((name) => name !== 'Salir');
      screens.set('', names);
    }

    current = pending.shift() ?? 'Salir';

    return options[names.indexOf(current)]?.value as never;
  });
  await runInteractiveMode();

  return screens;
}

function places(coverage: SurfaceCoverage): string[] {
  return [...new Set(Object.values(coverage).flatMap(({ en }) => en))];
}

/** El comando sin el flag final. */
const commandOf = (place: string) => place.replace(/ --\S+$/, '');

const commands = walkCommands(createProgram());
let screens: ReadonlyMap<string, readonly string[]> = new Map();
let existing: string[] = [];
const directory = mkdtempSync(join(tmpdir(), 'arcli-paridad-'));

beforeAll(async () => {
  vi.stubEnv('ARCLI_CONFIG_DIR', directory);
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);

  try {
    screens = await walkAssistant();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  }

  existing = [...screens].flatMap(([parent, options]) =>
    options.map((option) => (parent ? `${parent} > ${option}` : option)),
  );
});

afterAll(() => {
  rmSync(directory, { force: true, recursive: true });
});

describe.each([
  ['los comandos', COMMAND_COVERAGE],
  ['el asistente', ASSISTANT_COVERAGE],
])('operaciones en %s', (_name, coverage) => {
  it('cada operación tiene un lugar o una excepción explicada, y no las dos', () => {
    expect(Object.keys(coverage).sort()).toEqual([...OPERATIONS].sort());
    expect(
      Object.entries(coverage)
        .filter(([, { en, excepcion }]) => en.length > 0 === (excepcion !== undefined) || excepcion === '')
        .map(([operation]) => operation),
    ).toEqual([]);
  });

  it('una excepción que cita un doc dice lo que dice el doc', () => {
    for (const { excepcion } of Object.values(coverage)) {
      const [, path, quote] = /^(docs\/\S+\.md): (.+)$/.exec(excepcion ?? '') ?? [];

      if (path) {
        expect(readFileSync(path, 'utf8')).toContain(quote);
      }
    }
  });
});

it('ninguna operación está exceptuada en todos lados', () => {
  expect(
    OPERATIONS.filter((operation) => COMMAND_COVERAGE[operation].excepcion && ASSISTANT_COVERAGE[operation].excepcion),
  ).toEqual([]);
});

describe('comandos', () => {
  it('cada comando registrado es de una operación o de la app, y no de las dos', () => {
    const covered = new Set(places(COMMAND_COVERAGE).map(commandOf));
    const wrong = commands.paths.filter((path) => covered.has(path) === path in APP_COMMANDS);

    expect(commands.paths.length).toBeGreaterThan(40);
    expect(wrong).toEqual([]);
  });

  it('cada comando y flag declarado existe', () => {
    const missing = [...places(COMMAND_COVERAGE), ...Object.keys(APP_COMMANDS)].filter((place) => {
      const flags = commands.flags.get(commandOf(place));

      return !flags || (place !== commandOf(place) && !flags.includes(place.slice(commandOf(place).length + 1)));
    });

    expect(missing).toEqual([]);
  });
});

describe('asistente', () => {
  it('recorre el menú y sus submenús', () => {
    expect(screens.get('')).toContain('Emitir factura');
    expect(screens.get('Consultas')).toContain('Datos de un CUIT');
    expect(screens.get('Configuración')).toContain('Plugin de PDF');
  });

  it('cada opción de un menú es de una operación o de la app, y no de las dos', () => {
    const covered = new Set(places(ASSISTANT_COVERAGE));
    const wrong = [...screens]
      .filter(([parent]) => parent === '' || isDeclaredParent(parent))
      .flatMap(([parent, options]) => options.map((option) => (parent ? `${parent} > ${option}` : option)))
      .filter((screen) => !isDeclaredParent(screen) && covered.has(screen) === screen in APP_SCREENS);

    expect(wrong).toEqual([]);
  });

  it('cada pantalla declarada existe', () => {
    const missing = [...places(ASSISTANT_COVERAGE), ...Object.keys(APP_SCREENS)].filter(
      (place) => !existing.includes(place),
    );

    expect(missing).toEqual([]);
  });
});
