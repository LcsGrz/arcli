import Conf from 'conf';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { validateConfigValue } from '../../modules/config/config.service';
import { type ConfigPublicKey, configPublicKeySchema } from '../../modules/config/config-key-table';
import { reportCliError } from '../error-output';

import {
  CONFIG_KEYS,
  configPath,
  fullValue,
  KEYS_AND_DEPRECATED,
  normalize,
  runCli,
  saveFullConfig,
  saveOldConfig,
  storedBytes,
  testFolder,
  useConfigKeysFixture,
  withConfigService,
  withFiles,
} from './config-keys.fixture';

/**
 * Lo que hace hoy la config con cada clave (REV-37), para que cambiar dónde se declaran no cambie nada: lo que se
 * muestra, lo que se acepta, los mensajes y el `config.json`, byte a byte.
 *
 * Los archivos de `__golden__/configuracion/` son contrato (ver "Contrato público" en AGENTS.md). El texto de
 * `arcli config` y la ayuda, en `config.texto.txt` y `config.ayuda.txt`, no. Para regenerarlos a propósito:
 * `yarn test src/cli/__tests__/config.characterization.test.ts -u`, y revisar el diff.
 */

useConfigKeysFixture();

type Json = Record<string, unknown>;

async function golden(name: string, lines: readonly string[]): Promise<void> {
  const text = `${normalize(lines.join('\n')).trimEnd()}\n`;

  await expect(text).toMatchFileSnapshot(`__golden__/configuracion/${name}.txt`);
}

async function runJson(...args: readonly string[]): Promise<Json> {
  const { code, stderr, stdout } = await runCli(...args, '--json');

  expect(code, stderr).toBe(0);

  return JSON.parse(stdout) as Json;
}

async function runError(...args: readonly string[]): Promise<Json> {
  const { code, stderr } = await runCli(...args, '--json');

  expect(code).toBe(1);

  return JSON.parse(stderr) as Json;
}

/** Cada dato con su ruta: `exportacion.cert.testing`. */
function flatten(value: unknown, path: readonly string[] = []): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? Object.assign({}, ...Object.entries(value).map(([key, child]) => flatten(child, [...path, key])))
    : { [path.join('.')]: value };
}

/** Las rutas de los datos que cumplen, en orden alfabético. */
function pathsWhere(value: unknown, matches: (text: string) => boolean): string[] {
  return Object.entries(flatten(value))
    .filter(([, text]) => typeof text === 'string' && matches(text))
    .map(([path]) => path)
    .sort();
}

const isFilePath = (text: string) =>
  posix.isAbsolute(text) || win32.isAbsolute(text) || text.startsWith('file:') || text.includes(testFolder());

/** Las claves que guardan una ruta. */
const FILE_KEYS = [
  'cert.produccion',
  'cert.testing',
  'emisor.logo',
  'exportacion.cert.produccion',
  'exportacion.cert.testing',
  'exportacion.key.produccion',
  'exportacion.key.testing',
  'key.produccion',
  'key.testing',
  'pdfCarpeta',
  'pdfNavegador',
  'ticketPath',
];

describe('arcli config', () => {
  it('el texto, con todas las claves y con ninguna, con y sin color y links', async () => {
    const lines: string[] = [];

    for (const full of [false, true]) {
      if (full) {
        // Sin `json`, que no muestra el texto.
        saveFullConfig(['json']);
      }

      for (const color of [false, true]) {
        vi.stubEnv('NO_COLOR', color ? '' : '1');
        vi.stubEnv('FORCE_COLOR', color ? '1' : '');
        vi.stubEnv('FORCE_HYPERLINK', color ? '1' : '0');

        const { code, stderr, stdout } = await runCli('config');

        expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
        lines.push(
          `# ${full ? 'Todas las claves' : 'Ninguna clave'}${color ? ', con color y links' : ''}`,
          stdout.replaceAll('\u001B', '␛'),
        );
      }
    }

    await expect(normalize(lines.join('\n'))).toMatchFileSnapshot('config.texto.txt');
  });

  it('el JSON con todas las claves', async () => {
    saveFullConfig();

    const { code, stderr, stdout } = await runCli('config');

    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    await golden('json', [stdout]);
  });

  it.each([[[]], [['establecer', 'puntoVenta', '5']], [['eliminar', 'puntoVenta']]])(
    'ninguna ruta sale sin enmascarar, en el JSON ni en el texto: %j',
    async (args) => {
      saveFullConfig(['json']);

      // Una ruta nueva se suma a la lista, y con ella lo que sigue.
      expect(pathsWhere(JSON.parse(storedBytes()), isFilePath)).toEqual(FILE_KEYS);

      const json = await runJson('config', ...args);

      expect(pathsWhere(json, isFilePath)).toEqual([]);
      // Y están todas.
      expect(pathsWhere(json, (text) => text.startsWith('.../config/'))).toEqual(FILE_KEYS);

      const { stdout } = await runCli('config', ...args);

      expect(
        stdout.split('\n').filter((line) => /(?<!\.\.)[\\/]config[\\/]|file:|<config>/.test(normalize(line))),
      ).toEqual([]);
      // Las claves y la carpeta de certificados.
      expect(stdout.match(/\.\.\.\/config\//g)).toHaveLength(FILE_KEYS.length + 1);
    },
  );
});

it('la ayuda de config, establecer y eliminar', async () => {
  const lines: string[] = [];

  for (const args of [['config'], ['config', 'establecer'], ['config', 'eliminar']]) {
    const { code, stderr, stdout } = await runCli(...args, '--ayuda');

    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    lines.push(`$ arcli ${args.join(' ')} --ayuda`, stdout);
  }

  await expect(normalize(lines.join('\n'))).toMatchFileSnapshot('config.ayuda.txt');
});

it('una clave que no existe y el autocompletado', async () => {
  const complete = async (...words: readonly string[]) =>
    (await runCli('__completar', '--', 'config', ...words, '')).stdout.trim().split('\n').join(' ') || '(nada)';
  const unknown = await runError('config', 'establecer', 'noExiste', '1');

  expect(await runError('config', 'eliminar', 'noExiste')).toEqual(unknown);

  const lines = [
    '# establecer o eliminar noExiste',
    JSON.stringify(unknown, null, 2),
    '',
    '# Las claves al completar establecer',
    await complete('establecer'),
    '',
    '# Las claves al completar eliminar',
    await complete('eliminar'),
    '',
    '# Los valores de cada clave al completar establecer',
  ];

  for (const key of CONFIG_KEYS) {
    lines.push(`${key}: ${await complete('establecer', key)}`);
  }

  await golden('claves', lines);
});

const CERTIFICATES = ['@cert-testing.pem', '@no-existe.pem', '@key-testing.pem', '@sin-pem.txt'];
const PRIVATE_KEYS = ['@key-testing.pem', '@no-existe.pem', '@cert-testing.pem', '@cifrada.pem', '@sin-pem.txt'];
const BOOLEANS = ['true', 'FALSE', 'si', ' Sí ', 'no', '1', '0', '2'];
const CONDITIONS = [
  ...['consumidor-final', ' Responsable-Inscripto ', 'responsable-monotributo', 'sujeto-exento'],
  ...['iva-no-alcanzado', 'monotributo', '5'],
];
const TEXTS = [' Un texto ', '0'];
const INTEGERS = ['3', ' 4 ', '0', '1,5', '1.000', '99999999999999999999'];

/** Válidos, con las formas que se normalizan, e inválidos. A todas se les suma `x`, vacío y espacios. */
const VALUES: Readonly<Record<ConfigPublicKey, readonly string[]>> = {
  alicuota: ['21', '10,5', '10.5%', 'general', 'REDUCIDA', 'incrementada', 'cero', '0', '2,5', '5', '27', '22'],
  bruto: BOOLEANS,
  'cert.produccion': CERTIFICATES,
  'cert.testing': CERTIFICATES,
  concepto: ['productos', 'Servicios', ' productos-servicios ', '1'],
  condicionVenta: ['contado', 'Contado', 'a 30 días', 'a'.repeat(100), 'a'.repeat(101)],
  consultarPadron: BOOLEANS,
  cotizacion: ['1', '1.350,5', '1350.5', '1,123456', '1,1234567', '0'],
  cuenta: ['0110599520000012345678', '0110599520 0000 12345678', '0110599520000012345677', '123'],
  cuit: ['20-12345678-6', '20123456786', '20123456780', '123'],
  'emisor.condicionIva': CONDITIONS,
  'emisor.domicilio': TEXTS,
  'emisor.iibb': TEXTS,
  'emisor.inicioActividades': ['1/03/2020', '01/03/2020', '2020-03-01', '20200301', '1/03', '31/02/2020'],
  'emisor.logo': ['@logo.png', '@no-existe.png', '@logo.gif'],
  'emisor.razonSocial': TEXTS,
  emitir: BOOLEANS,
  entorno: ['testing', ' PRODUCCION ', 'producción', 'homologacion'],
  'exportacion.actividad': INTEGERS,
  'exportacion.cert.produccion': CERTIFICATES,
  'exportacion.cert.testing': CERTIFICATES,
  'exportacion.key.produccion': PRIVATE_KEYS,
  'exportacion.key.testing': PRIVATE_KEYS,
  filasPorLista: ['1', '50', '51', '0', '1,5'],
  ivaReceptor: CONDITIONS,
  json: BOOLEANS,
  'key.produccion': PRIVATE_KEYS,
  'key.testing': PRIVATE_KEYS,
  moneda: ['PES', 'usd', ' 060 ', 'zzz', 'PESOS'],
  'monotributo.tope': ['30.000.000', '30000000,50', '30000000.5', '0', '1,234'],
  pdf: ['siempre', 'Preguntar', 'nunca', 'si'],
  pdfCarpeta: ['@pdfs', 'relativa/pdfs'],
  pdfNavegador: ['@navegador', '@no-existe'],
  puntoVenta: INTEGERS,
  ticketPath: ['@tickets', 'relativa/tickets'],
  verificarFce: BOOLEANS,
};

const OTHER_CBU = '0170099220000067797370';

/** Con alias, que solo acepta `cuenta`, y las claves deprecadas. */
const OTHER_VALUES: ReadonlyArray<readonly [key: string, value: string, alias?: string]> = [
  ['cuenta', OTHER_CBU, 'otro.alias'],
  ['cuenta', OTHER_CBU, 'x'],
  ['cuenta', OTHER_CBU, ''],
  ['cuit', '20123456786', 'mi.alias.cbu'],
  ['cbu', '0110599520000012345678'],
  ['cbu', OTHER_CBU],
  ['cbu', '123'],
  ['aliasCbu', 'otro.alias'],
  ['aliasCbu', 'x'],
  ['comprobantesPorLista', '12'],
  ['comprobantesPorLista', '51'],
];

it('lo que guarda o responde config establecer con cada valor', async () => {
  saveFullConfig(['json']);

  const before = flatten(JSON.parse(storedBytes()));
  const suggestions: string[] = [];
  const lines: string[] = [];
  let stored: unknown;
  let stderr = '';

  // En memoria: cada valor parte de la misma config y no se escribe nada.
  vi.spyOn(Conf.prototype, 'store', 'set').mockImplementation((value) => {
    stored = value;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);

    return true;
  });

  function describeSaved(warnings: readonly string[] = []): string[] {
    const after = flatten(JSON.parse(JSON.stringify(stored)));
    const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((path) => before[path] !== after[path])
      .map((path) => (path in after ? `${path} = ${JSON.stringify(after[path])}` : `borra ${path}`));

    return [`guarda ${changes.join('; ') || 'lo mismo'}`, ...warnings.map((warning) => `aviso: ${warning}`)];
  }

  /** El error como sale con `--json`; la sugerencia, por su número. */
  function describeRejected(error: unknown): string[] {
    stderr = '';
    reportCliError(error, true);

    const { codigo, detalles, error: message, sugerencia, ...rest } = JSON.parse(stderr) as Json;
    const suggestion = String(sugerencia ?? 'no trae');

    expect(rest).toEqual({});

    if (!suggestions.includes(suggestion)) {
      suggestions.push(suggestion);
    }

    return [
      `${String(codigo)}, sugerencia ${suggestions.indexOf(suggestion) + 1}: ${String(message)}`,
      // Sin más datos, `null`: está siempre.
      ...(detalles === null ? [] : [`detalles: ${JSON.stringify(detalles)}`]),
    ];
  }

  /** Lo que muestra el asistente, que valida lo mismo sin nombrar la clave. */
  function describeAssistant(key: string, value: string, rejection: string): string[] {
    const publicKey = configPublicKeySchema.safeParse(key);

    try {
      if (publicKey.success) {
        validateConfigValue(publicKey.data, withFiles(value));
      }

      return [];
    } catch (error) {
      const { message } = error as Error;

      return [`asistente: ${rejection.endsWith(`: ${message}`) ? 'lo mismo' : message}`];
    }
  }

  withConfigService((service) => {
    function add(key: string, value: string, alias?: string): void {
      const shown = value.length > 60 ? `${value[0]} x ${value.length}` : value;
      let result: string[];

      stored = undefined;

      try {
        result = describeSaved(service.repairValue(key, withFiles(value), alias).warnings);
      } catch (error) {
        expect(stored).toBeUndefined();
        result = describeRejected(error);
      }

      lines.push(
        `  "${shown}"${alias === undefined ? '' : ` "${alias}"`}`,
        ...[...result, ...(alias === undefined ? describeAssistant(key, value, result[0] ?? '') : [])].map(
          (line) => `    ${line}`,
        ),
      );
    }

    for (const key of CONFIG_KEYS) {
      lines.push(key);
      [...VALUES[key], 'x', '', '  '].forEach((value) => add(key, value));
    }

    for (const [key, value, alias] of OTHER_VALUES) {
      lines.push(key);
      add(key, value, alias);
    }
  });

  vi.mocked(process.stderr.write).mockRestore();

  await golden('valores', [
    '# Sobre la config de archivo-completo.txt; "guarda" es lo que cambia de ella',
    ...suggestions.map((suggestion, index) => `Sugerencia ${index + 1}: ${suggestion}`),
    '',
    ...lines,
  ]);
});

/** Las líneas que cambian entre dos archivos, desde la primera distinta hasta la última. */
function lineChanges(before: string, after: string): string[] {
  const [old, now] = [before.split('\n'), after.split('\n')];
  const shortest = Math.min(old.length, now.length);
  let start = 0;
  let end = 0;

  while (start < shortest && old[start] === now[start]) start += 1;
  while (end < shortest - start && old[old.length - 1 - end] === now[now.length - 1 - end]) end += 1;

  const removed = old.slice(start, old.length - end).map((line) => `    - ${line}`);
  const added = now.slice(start, now.length - end).map((line) => `    + ${line}`);

  return removed.length + added.length === 0 ? ['    igual'] : [`    línea ${start + 1}`, ...removed, ...added];
}

/** El config.json después del comando, y lo que avisa. */
async function changeFile(...args: readonly string[]): Promise<{ readonly file: string; readonly notices: string[] }> {
  const { code, stderr } = await runCli('config', ...args);

  expect(code, stderr).toBe(0);

  const notice = stderr.replace(/[│┃║╏─━┄╭╮╰╯┌┐└┘\s]+/g, ' ').trim();

  return { file: storedBytes(), notices: notice ? [`    aviso: ${notice}`] : [] };
}

describe('config.json', () => {
  it.each([
    ['vacia', () => rmSync(configPath(), { force: true })],
    ['2.0', saveOldConfig],
  ])('al establecer y eliminar cada clave, desde una config %s', async (name, prepare) => {
    prepare();

    const original = existsSync(configPath()) ? ['# El archivo', storedBytes(), ''] : [];
    const base = (await changeFile()).file;
    const lines = [...original, '# Después de `arcli config`; cada cambio es sobre este', base, ''];

    for (const key of KEYS_AND_DEPRECATED) {
      const [value, alias] = fullValue(key);

      prepare();

      const set = await changeFile('establecer', key, value, ...(alias === undefined ? [] : [alias]));
      const unset = await changeFile('eliminar', key);

      lines.push(key, '  establecer', ...lineChanges(base, set.file), ...set.notices);
      lines.push('  eliminar', ...lineChanges(base, unset.file), ...unset.notices);
    }

    await golden(`archivo-${name}`, lines);
  });

  it('al eliminar cada clave, con todas guardadas', async () => {
    saveFullConfig(['json']);

    const full = storedBytes();
    const lines = [full, ''];

    for (const key of KEYS_AND_DEPRECATED) {
      writeFileSync(configPath(), full);

      const { file, notices } = await changeFile('eliminar', key);

      lines.push(key, ...lineChanges(full, file), ...notices);
    }

    await golden('archivo-completo', lines);
  });
});

it('la sugerencia de cada grupo roto y de cada clave rota', async () => {
  saveFullConfig(['json']);

  const groups = [
    'cert',
    'key',
    'exportacion',
    'exportacion.cert',
    'exportacion.key',
    'monotributo',
    'emisor',
    'output',
  ];
  const keys = Object.keys(flatten(JSON.parse(storedBytes())));
  const lines: string[] = [];

  for (const path of [...groups, ...keys, 'comprobantesPorLista']) {
    const broken = path.split('.').reduceRight<unknown>((value, key) => ({ [key]: value }), null);

    writeFileSync(configPath(), JSON.stringify(broken));

    const { detalles, error, sugerencia } = await runError('config');
    // Otra clave se guarda igual, con el mismo arreglo en el aviso.
    const other = path === 'puntoVentaPorDefecto' ? 'alicuota' : 'puntoVenta';
    const { avisos } = await runJson('config', 'establecer', other, '5');

    expect(avisos).toEqual([expect.stringContaining(String(sugerencia))]);
    lines.push(
      path,
      `  error: ${String(error)}`,
      `  detalles: ${JSON.stringify(detalles)}`,
      `  sugerencia: ${String(sugerencia)}`,
    );
  }

  await golden('grupos-rotos', lines);
});
