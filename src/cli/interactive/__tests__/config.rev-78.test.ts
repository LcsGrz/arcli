import { Separator } from '@inquirer/core';
import { writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CONFIG_LABELS } from '../../../modules/config/config.sections';
import type { ConfigPublicKey } from '../../../modules/config/config-key-table';
import { CONFIG_FIELDS, type ConfigField } from '../../../modules/interactive/config-fields';
import { BACK } from '../../../modules/interactive/wizard';
import { stripAnsi } from '../../../ui';
import {
  configPath,
  fullValue,
  normalize,
  runCli,
  saveFullConfig,
  useConfigKeysFixture,
  withConfigService,
} from '../../__tests__/config-keys.fixture';
import { runConfigMenu } from '../config.flow';
import { askTextStep, chooseOne, chooseOrTypeStep, chooseStep } from '../prompts';

/**
 * REV-78: "Modificar configuración" del asistente y `arcli config` dicen lo mismo de cada dato, con "(por defecto)" si
 * no está guardado; las opciones para dejar o volver al valor por defecto, o para borrar, dicen cuál es cuál; las
 * carpetas se arrastran como carpetas. Lo que mira cada test es lo que ve quien usa el CLI: la lista, las opciones y la
 * pregunta de cada dato, y las filas de `arcli config`.
 */

vi.mock('../prompts', () => ({
  askTextStep: vi.fn(),
  chooseOne: vi.fn(),
  chooseOrTypeStep: vi.fn(),
  chooseStep: vi.fn(),
  confirm: vi.fn(),
  fitPageSize: () => 12,
}));

// Sin la tabla de actividades de WSFEX, que se consulta a ARCA: la actividad se escribe.
vi.mock('../../arca-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../arca-runtime')>()),
  loadArcaRuntime: () => {
    throw new Error('sin ARCA');
  },
}));

const FIELD_LIST = '¿Qué querés modificar?';

useConfigKeysFixture();

beforeEach(() => {
  [askTextStep, chooseOne, chooseOrTypeStep, chooseStep].forEach((prompt) => vi.mocked(prompt).mockReset());
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

function save(key: ConfigPublicKey, value?: string): void {
  withConfigService((service) => service.setValue(key, value ?? fullValue(key)[0]));
}

/** El valor que muestra la lista del asistente al lado de cada dato. */
async function assistantValues(): Promise<Partial<Record<ConfigPublicKey, string>>> {
  const values: Partial<Record<ConfigPublicKey, string>> = {};

  vi.mocked(chooseOne).mockResolvedValueOnce('cambiar').mockResolvedValueOnce('volver');
  vi.mocked(chooseStep).mockImplementation(async (message, choices) => {
    if (message === FIELD_LIST) {
      for (const choice of choices) {
        if (!Separator.isSeparator(choice)) {
          values[(choice.value as ConfigField).key] = normalize(stripAnsi(String(choice.description)).trim());
        }
      }
    }

    return BACK;
  });

  await runConfigMenu();

  return values;
}

interface Question {
  /** La pregunta, con su aclaración. */
  readonly message: string;
  /** Las filas u opciones que ofrece, con su texto; vacío si se escribe. */
  readonly options: readonly string[];
  /** Los valores de las opciones, en el mismo orden. */
  readonly values: readonly unknown[];
}

/** Abre un dato en "Modificar configuración" y devuelve lo que pregunta, sin cambiarlo. */
async function questionOf(key: ConfigPublicKey): Promise<Question> {
  let question: Question | undefined;
  let opened = false;

  vi.mocked(chooseOne).mockResolvedValueOnce('cambiar').mockResolvedValueOnce('volver');
  vi.mocked(askTextStep).mockImplementation((message, options) => {
    question = { message: [message, options?.hint ?? ''].join(' '), options: [], values: [] };

    return Promise.resolve(BACK);
  });
  vi.mocked(chooseOrTypeStep).mockImplementation((message, rows) => {
    question = {
      message,
      options: rows.map((row) => stripAnsi(row.label).trim()),
      values: rows.map((row) => row.value),
    };

    return Promise.resolve(BACK);
  });
  vi.mocked(chooseStep).mockImplementation(async (message, choices) => {
    if (message !== FIELD_LIST) {
      const listed = choices.flatMap((choice) => (Separator.isSeparator(choice) ? [] : [choice]));

      question = {
        message,
        options: listed.map((choice) => stripAnsi(String(choice.name)).trim()),
        values: listed.map((choice) => choice.value),
      };

      return BACK;
    }

    if (opened) {
      return BACK;
    }

    opened = true;

    const field = choices.find((choice) => !Separator.isSeparator(choice) && (choice.value as ConfigField).key === key);

    return (field as { value: ConfigField } | undefined)?.value as never;
  });

  await runConfigMenu();

  if (!question) {
    throw new Error(`No preguntó ${key}`);
  }

  return question;
}

/** El valor de cada fila de `arcli config`, sin color. */
async function configRows(): Promise<Partial<Record<ConfigPublicKey, string>>> {
  const { code, stderr, stdout } = await runCli('config');

  expect({ code, stderr }).toEqual({ code: 0, stderr: '' });

  const lines = normalize(stdout)
    .split('\n')
    .map((line) => line.replace(/^\s*│/, '').replace(/│\s*$/, '').trim());
  const rows: Partial<Record<ConfigPublicKey, string>> = {};

  for (const [key, label] of Object.entries(CONFIG_LABELS) as Array<[ConfigPublicKey, string]>) {
    const line = lines.find((candidate) => candidate.startsWith(`${label}  `));

    if (line !== undefined) {
      rows[key] = line.slice(label.length).trim();
    }
  }

  // Una fila que no se encuentra es un error del test, no una diferencia.
  expect(Object.keys(rows).sort()).toEqual(Object.keys(CONFIG_LABELS).sort());

  return rows;
}

/** Lo que se ve sin nada guardado en las claves con un valor por defecto (o sin uno fijo). */
const UNSAVED_VALUES = {
  alicuota: '21% (por defecto)',
  consultarPadron: 'sí (por defecto)',
  'emisor.condicionIva': 'según la letra',
  filasPorLista: '15 (por defecto)',
  'monotributo.tope': 'el de tu categoría',
  pdf: 'preguntar (por defecto)',
  pdfCarpeta: '.../arcli/comprobantes (por defecto)',
  pdfNavegador: 'automático',
  ticketPath: '.../config/tickets (por defecto)',
  verificarFce: 'no (por defecto)',
} as const satisfies Partial<Record<ConfigPublicKey, string>>;

/** Las que `arcli config` ya muestra así. */
const UNSAVED_VALUES_ALREADY_SHOWN = [
  'alicuota',
  'emisor.condicionIva',
  'filasPorLista',
  'monotributo.tope',
  'pdfNavegador',
] as const satisfies ReadonlyArray<keyof typeof UNSAVED_VALUES>;

const pick = (keys: readonly ConfigPublicKey[]) =>
  Object.fromEntries(keys.map((key) => [key, UNSAVED_VALUES[key as keyof typeof UNSAVED_VALUES]]));

describe('A. el valor de cada dato, el mismo en el asistente y en `arcli config`', () => {
  it('sin nada guardado, el asistente muestra el valor por defecto, con "(por defecto)"', async () => {
    expect(await assistantValues()).toMatchObject(UNSAVED_VALUES);
  });

  it('sin nada guardado, `arcli config` ya muestra el por defecto de alícuota, filas y los que no tienen uno fijo', async () => {
    expect(await configRows()).toMatchObject(pick(UNSAVED_VALUES_ALREADY_SHOWN));
  });

  it('sin nada guardado, `arcli config` suma "(por defecto)" en el padrón, la FCE, el PDF y las carpetas', async () => {
    expect(await configRows()).toMatchObject(
      pick(['consultarPadron', 'verificarFce', 'pdf', 'pdfCarpeta', 'ticketPath']),
    );
  });

  it('un valor guardado, aunque sea el mismo que el por defecto, no dice "(por defecto)" en `arcli config`', async () => {
    save('alicuota', '21');
    save('consultarPadron', 'si');
    save('verificarFce', 'no');
    save('pdf', 'preguntar');
    save('filasPorLista', '15');

    expect(await configRows()).toMatchObject({
      alicuota: '21%',
      consultarPadron: 'sí',
      filasPorLista: '15',
      pdf: 'preguntar',
      verificarFce: 'no',
    });
  });

  it('un valor guardado, aunque sea el mismo que el por defecto, no dice "(por defecto)" en el asistente', async () => {
    save('alicuota', '21');
    save('consultarPadron', 'si');
    save('verificarFce', 'no');
    save('pdf', 'preguntar');
    save('filasPorLista', '15');

    const values = await assistantValues();

    for (const key of ['alicuota', 'consultarPadron', 'verificarFce', 'pdf', 'filasPorLista'] as const) {
      expect(values[key], key).not.toMatch(/por defecto/);
    }
  });

  // Una sola función para las dos pantallas: cada dato del asistente dice lo mismo que su fila de `arcli config`.
  it.each([['sin nada guardado'], ['con todo guardado']])(
    'el asistente y `arcli config` muestran el mismo texto de cada dato, %s',
    async (state) => {
      if (state === 'con todo guardado') {
        // Sin `json`, que no muestra el texto.
        saveFullConfig(['json']);
      }

      const assistant = await assistantValues();
      const rows = await configRows();

      expect(Object.keys(assistant).sort()).toEqual(CONFIG_FIELDS.map((field) => field.key).sort());
      expect(assistant).toEqual(
        Object.fromEntries(CONFIG_FIELDS.map((field) => [field.key, rows[field.key]] as const)),
      );
    },
  );
});

describe('B. las carpetas se arrastran como carpetas', () => {
  it.each([['pdfCarpeta'], ['ticketPath']] as const)('%s: "podés arrastrar la carpeta"', async (key) => {
    const { message } = await questionOf(key);

    expect(message).toContain('podés arrastrar la carpeta');
    expect(message).not.toContain('el archivo');
  });

  it.each([
    ['cert.testing'],
    ['key.produccion'],
    ['exportacion.cert.testing'],
    ['emisor.logo'],
    ['pdfNavegador'],
  ] as const)('%s sigue con "podés arrastrar el archivo"', async (key) => {
    const { message } = await questionOf(key);

    expect(message).toContain('podés arrastrar el archivo');
    expect(message).not.toContain('la carpeta');
  });
});

/** Las claves que se eligen de una lista y tienen un valor por defecto, con ese valor como lo nombra la opción. */
const LISTED_WITH_DEFAULT = [
  ['alicuota', /\(21%\)$/],
  ['consultarPadron', /\(sí\)$/i],
  ['verificarFce', /\(no\)$/i],
  ['pdf', /\(preguntar\)$/i],
] as const;

describe('C. dejar o volver al valor por defecto, o borrar', () => {
  it('sin nada guardado, la alícuota ofrece "Dejar el de por defecto (21%)", no "Dejar sin configurar"', async () => {
    const { options } = await questionOf('alicuota');

    expect(options).toContain('Dejar el de por defecto (21%)');
    expect(options).not.toContain('Dejar sin configurar');
  });

  it('con una alícuota guardada, ofrece "Volver al de por defecto (21%)", no "Quitar el valor por defecto"', async () => {
    save('alicuota');

    const { options } = await questionOf('alicuota');

    expect(options).toContain('Volver al de por defecto (21%)');
    expect(options).not.toContain('Quitar el valor por defecto');
  });

  it.each(LISTED_WITH_DEFAULT)('%s sin guardar: "Dejar el de por defecto (…)"', async (key, defaultShown) => {
    const { options } = await questionOf(key);
    const keep = options.filter((option) => option.startsWith('Dejar'));

    expect(keep).toEqual([expect.stringMatching(/^Dejar el de por defecto \(/)]);
    expect(keep[0]).toMatch(defaultShown);
  });

  it.each(LISTED_WITH_DEFAULT)('%s guardado: "Volver al de por defecto (…)"', async (key, defaultShown) => {
    save(key);

    const { options } = await questionOf(key);
    const back = options.filter((option) => /^(Volver|Quitar|Borrar)/.test(option));

    expect(back).toEqual([expect.stringMatching(/^Volver al de por defecto \(/)]);
    expect(back[0]).toMatch(defaultShown);
  });

  // `entorno` y `moneda` quedan guardados desde que se crea la config: siempre se puede volver al por defecto.
  it.each([
    ['entorno', /\(testing\)$/i],
    ['moneda', /\(PES\)$/],
  ] as const)('%s: "Volver al de por defecto (…)"', async (key, defaultShown) => {
    save(key);

    const { options } = await questionOf(key);
    const back = options.filter((option) => /^(Volver|Quitar|Borrar)/.test(option));

    expect(back).toEqual([expect.stringMatching(/^Volver al de por defecto \(/)]);
    expect(back[0]).toMatch(defaultShown);
  });

  it.each([['concepto'], ['ivaReceptor'], ['condicionVenta']] as const)(
    '%s, sin valor por defecto y sin guardar: "Dejar sin configurar"',
    async (key) => {
      const { options } = await questionOf(key);

      expect(options).toContain('Dejar sin configurar');
      expect(options.filter((option) => /por defecto/.test(option))).toEqual([]);
    },
  );

  it.each([['concepto'], ['ivaReceptor'], ['condicionVenta']] as const)(
    '%s, sin valor por defecto y guardado: "Borrar (queda sin configurar)"',
    async (key) => {
      save(key);

      const { options } = await questionOf(key);

      expect(options).toContain('Borrar (queda sin configurar)');
      expect(options.filter((option) => /por defecto/.test(option))).toEqual([]);
    },
  );

  it.each([['filasPorLista'], ['pdfCarpeta'], ['ticketPath'], ['cotizacion']] as const)(
    '%s guardado, escrito: "-" para volver al de por defecto',
    async (key) => {
      save(key);

      const { message } = await questionOf(key);

      expect(message).toContain('"-" para volver al de por defecto');
      expect(message).not.toContain('"-" para borrar');
    },
  );

  it.each([['cuit'], ['puntoVenta'], ['emisor.razonSocial'], ['cert.testing']] as const)(
    '%s guardado, sin valor por defecto: "-" para borrar',
    async (key) => {
      save(key);

      const { message } = await questionOf(key);

      expect(message).toContain('"-" para borrar');
      expect(message).not.toContain('por defecto');
    },
  );

  it.each([['cuit'], ['filasPorLista'], ['pdfCarpeta']] as const)('%s sin guardar: no ofrece "-"', async (key) => {
    const { message } = await questionOf(key);

    expect(message).not.toContain('"-"');
  });
});

describe('D. los nombres de las opciones', () => {
  it('el entorno se elige entre "testing" y "producción", con tilde; se guarda igual', async () => {
    const { options, values } = await questionOf('entorno');

    expect(options.slice(0, 2)).toEqual(['testing', 'producción']);
    expect(values.slice(0, 2)).toEqual(['testing', 'produccion']);
  });

  it('el PDF ofrece "Siempre", "Preguntar" y "Nunca", con mayúscula; se guarda igual', async () => {
    const { options, values } = await questionOf('pdf');

    expect(options.slice(0, 3)).toEqual(['Siempre', 'Preguntar', 'Nunca']);
    expect(values.slice(0, 3)).toEqual(['siempre', 'preguntar', 'nunca']);
  });
});

/** TUI-47: la clave nueva, que todavía no es una `ConfigPublicKey`. */
const EQUIVALENT_COMMAND = 'asistente.comandoEquivalente' as ConfigPublicKey;

/** Como lo deja `config establecer asistente.comandoEquivalente no`, escrito a mano: hoy la clave no se guarda. */
const saveEquivalentCommandOff = () =>
  writeFileSync(configPath(), JSON.stringify({ asistente: { comandoEquivalente: false } }));

/** Los títulos de sección y los nombres de los datos de la lista del asistente, en orden. */
async function assistantList(): Promise<string[]> {
  let listed: string[] = [];

  vi.mocked(chooseOne).mockResolvedValueOnce('cambiar').mockResolvedValueOnce('volver');
  vi.mocked(chooseStep).mockImplementation(async (message, choices) => {
    if (message === FIELD_LIST) {
      listed = choices.map((choice) =>
        stripAnsi(Separator.isSeparator(choice) ? choice.separator : String(choice.name)).trim(),
      );
    }

    return BACK;
  });

  await runConfigMenu();

  return listed.filter(Boolean);
}

/** Abre el dato en "Modificar configuración"; antes afirma que está, para que su falta sea el fallo. */
async function equivalentCommandQuestion(): Promise<Question> {
  expect(CONFIG_FIELDS.map((field) => field.key)).toContain(EQUIVALENT_COMMAND);

  return questionOf(EQUIVALENT_COMMAND);
}

const backOptions = (options: readonly string[]) =>
  options.filter((option) => /^(Dejar|Volver|Quitar|Borrar)/.test(option));

describe('E. el comando equivalente (TUI-47)', () => {
  // Tests primero (TUI-47): pasa a it() al implementarlo.
  it.fails(
    '"Mostrar el comando equivalente" va en una sección "Asistente", después de "Salida y listados"',
    async () => {
      const listed = await assistantList();
      const output = listed.indexOf('Salida y listados');
      const assistant = listed.indexOf('Asistente');

      expect(output).toBeGreaterThan(-1);
      expect(assistant).toBeGreaterThan(output);
      expect(listed[assistant + 1]).toBe('Mostrar el comando equivalente');
    },
  );

  // Tests primero (TUI-47): pasa a it() al implementarlo.
  it.fails('sin nada guardado, el asistente muestra "sí (por defecto)"', async () => {
    expect((await assistantValues())[EQUIVALENT_COMMAND]).toBe('sí (por defecto)');
  });

  // Tests primero (TUI-47): pasa a it() al implementarlo.
  it.fails('guardado en no, el asistente muestra "no"', async () => {
    saveEquivalentCommandOff();

    expect((await assistantValues())[EQUIVALENT_COMMAND]).toBe('no');
  });

  // Tests primero (TUI-47): pasa a it() al implementarlo.
  it.fails('sin guardar: "Sí", "No" y "Dejar el de por defecto (sí)"', async () => {
    const { options, values } = await equivalentCommandQuestion();

    expect(options.slice(0, 2)).toEqual(['Sí', 'No']);
    expect(values.slice(0, 2)).toEqual(['si', 'no']);
    expect(backOptions(options)).toEqual(['Dejar el de por defecto (sí)']);
  });

  // Tests primero (TUI-47): pasa a it() al implementarlo.
  it.fails('guardado: "Volver al de por defecto (sí)"', async () => {
    saveEquivalentCommandOff();

    const { options } = await equivalentCommandQuestion();

    expect(backOptions(options)).toEqual(['Volver al de por defecto (sí)']);
  });
});
