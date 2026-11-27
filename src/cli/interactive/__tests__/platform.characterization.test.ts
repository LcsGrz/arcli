import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import { stripAnsi } from '../../../ui';
import {
  BEFORE_MIDNIGHT,
  CLIENT_CUIT,
  CLOCK_CONFIG,
  sdk,
  setClock,
  useClockFixture,
} from '../../__tests__/clock.fixture';
import { runCertificateMenu } from '../certificate.flow';
import { runConfigMenu } from '../config.flow';
import { runInvoiceFlow } from '../invoice.flow';
import { createInteractiveSession } from '../session';

import { createScript, rejecting, type ScriptedAnswer, singleExportItem } from './script';

/**
 * Caracterizacion de lo que depende de la plataforma en el asistente: las comillas del comando equivalente y la ruta
 * arrastrada a la terminal. Solo se reemplazan las preguntas, el SDK y `process.platform`, en la sesion real.
 */

vi.mock('@arcasdk/core', async (original) =>
  (await import('../../__tests__/clock.fixture')).fakeArcaSdk(await original<Record<string, unknown>>()),
);

vi.mock('../../spinner', () => ({
  startSpinner: () => null,
  withSpinner: (_text: unknown, run: () => unknown) => run(),
}));

let script = createScript([]);

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseFromFilterList: (...args: Parameters<typeof script.chooseFromFilterList>) =>
    script.chooseFromFilterList(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  // Esc en un menu da su `escapeValue`, no BACK.
  chooseOne: async (
    message: string,
    choices: never,
    _default?: unknown,
    options?: { readonly escapeValue?: unknown },
  ) => {
    const answer = await script.chooseStep(message, choices);

    return answer === BACK ? options?.escapeValue : answer;
  },
  chooseOrTypeStep: (...args: Parameters<typeof script.chooseOrTypeStep>) => script.chooseOrTypeStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  chooseStepWhileLoading: (...args: Parameters<typeof script.chooseStepWhileLoading>) =>
    script.chooseStepWhileLoading(...args),
  editRowsStep: (...args: Parameters<typeof script.editRowsStep>) => script.editRowsStep(...args),
  eraseLastAnswer: () => undefined,
  fitPageSize: () => 12,
  isPromptCancellation: () => false,
}));

/** Los comandos equivalentes tal cual, sin el panel que los corta en varias lineas. */
const commands: string[] = [];

vi.mock('../../../modules/interactive/equivalent-command', async (original) => {
  const actual = await original<typeof import('../../../modules/interactive/equivalent-command')>();

  return {
    ...actual,
    buildEquivalentCommand: (...args: Parameters<typeof actual.buildEquivalentCommand>) => {
      const command = actual.buildEquivalentCommand(...args);

      commands.push(command);

      return command;
    },
  };
});

vi.mock('../../../modules/interactive/export-equivalent-command', async (original) => {
  const actual = await original<typeof import('../../../modules/interactive/export-equivalent-command')>();

  return {
    ...actual,
    buildExportEquivalentCommand: (...args: Parameters<typeof actual.buildExportEquivalentCommand>) => {
      const command = actual.buildExportEquivalentCommand(...args);

      commands.push(command);

      return command;
    },
  };
});

const profile = useClockFixture();
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor;
const NOT_EMITTED: readonly [RegExp, ScriptedAnswer] = [/Emitimos/, 'No'];

/** Corre `flow` como si el equipo fuera de `platform`. */
async function run(
  platform: NodeJS.Platform,
  flow: () => Promise<unknown>,
  steps: ReadonlyArray<readonly [RegExp, ScriptedAnswer]>,
): Promise<void> {
  script = createScript(steps);
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform });

  try {
    await flow();
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform);
  }

  expect(script.remaining(), 'quedaron respuestas del guion sin preguntar').toBe(0);
}

beforeEach(() => {
  commands.length = 0;
  setClock(BEFORE_MIDNIGHT);
  profile.writeConfig(profile.configWith(profile.healthy, CLOCK_CONFIG));
});

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform);
});

describe.each([
  { apostrophe: `'O'\\''Brien "$HOME"'`, platform: 'darwin', typographic: "'Calle ’1’'" },
  { apostrophe: `'O'\\''Brien "$HOME"'`, platform: 'linux', typographic: "'Calle ’1’'" },
  { apostrophe: `'O''Brien "$HOME"'`, platform: 'win32', typographic: "'Calle ’’1’’'" },
] as const)('comillas del comando equivalente en $platform', ({ apostrophe, platform, typographic }) => {
  it('Factura A, con el nombre y el domicilio del padrón', async () => {
    profile.writeConfig(profile.configWith(profile.healthy, { ...CLOCK_CONFIG, consultarPadron: true }));
    sdk.padron.getTaxpayerDetails.mockResolvedValue({
      datosGenerales: {
        domicilioFiscal: { direccion: 'Calle ’1’' },
        estadoClave: 'ACTIVO',
        razonSocial: `O'Brien "$HOME"`,
        tipoPersona: 'JURIDICA',
      },
      datosRegimenGeneral: { impuesto: [{ descripcionImpuesto: 'IVA', estadoImpuesto: 'AC', idImpuesto: 30 }] },
    });

    const session = createInteractiveSession({});

    await run(platform, () => runInvoiceFlow(session), [
      [/comprobante/, 'Factura A'],
      [/A quién/, 'CUIT'],
      [/CUIT/, String(CLIENT_CUIT)],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/Qué estás facturando/, 'Servicios'],
      [/Monto total/, '1000'],
      [/Agregamos/, []],
      NOT_EMITTED,
    ]);

    expect(commands).toEqual([
      expect.stringContaining(`--receptor-nombre ${apostrophe} --receptor-domicilio ${typographic} `),
    ]);
  });

  it('Factura E', async () => {
    const session = createInteractiveSession({});

    await run(platform, () => runInvoiceFlow(session), [
      [/comprobante/, 'Factura de exportación E'],
      [/cliente del exterior/, `O'Brien "$HOME"`],
      [/Domicilio/, 'Calle ’1’'],
      [/País de destino/, '212'],
      [/ID impositivo/, ''],
      [/Qué exportás/, 'Servicios'],
      [/Moneda del comprobante/, 'Pesos'],
      ...singleExportItem('100', 'Soporte'),
      [/Forma de pago/, 'Transferencia Internacional'],
      [/Fecha de pago/, ''],
      [/Agregamos/, []],
      NOT_EMITTED,
    ]);

    expect(commands).toEqual([expect.stringContaining(`--cliente ${apostrophe} --domicilio-cliente ${typographic} `)]);
  });
});

describe('ruta arrastrada a la terminal', () => {
  /** Con `/` también en Windows, para que la única barra invertida sea la que se prueba. */
  const temporary = () => profile.temporaryDirectory('arcli-platform-').replaceAll('\\', '/');
  const MENU = [/Qué querés hacer/, 'Cargar el certificado (.crt)'] as const;
  const LEAVE = [/Qué querés hacer/, BACK] as const;
  const output = () => stripAnsi(`${profile.stdout}${profile.stderr}`);

  function createFile(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    // No es un certificado: alcanza con ver que se leyó ese archivo.
    writeFileSync(path, 'no es un certificado');
  }

  describe('certificado', () => {
    it.each(['darwin', 'linux'] as const)('%s: la barra invertida escapa', async (platform) => {
      const directory = temporary();

      createFile(`${directory}/mi certificado.crt`);
      await run(platform, runCertificateMenu, [MENU, [/Ruta del \.crt/, `${directory}/mi\\ certificado.crt `], LEAVE]);

      expect(output()).toContain('El archivo no tiene un certificado');
    });

    it('win32: la barra invertida separa carpetas', async () => {
      const directory = temporary();
      const path = `${directory}/mis\\certificado.crt`;

      createFile(path);
      createFile(`${directory}/mi certificado.crt`);
      await run('win32', runCertificateMenu, [
        MENU,
        [/Ruta del \.crt/, rejecting(path, [`${directory}/mi\\ certificado.crt`, /No existe ese archivo/])],
        LEAVE,
      ]);

      expect(output()).toContain('El archivo no tiene un certificado');
    });

    it.each(['darwin', 'linux', 'win32'] as const)('%s: entre comillas va tal cual', async (platform) => {
      const path = `${temporary()}/mis\\certificado nuevo.crt`;

      createFile(path);
      await run(platform, runCertificateMenu, [MENU, [/Ruta del \.crt/, `"${path}"`], LEAVE]);

      expect(output()).toContain('El archivo no tiene un certificado');
    });
  });

  it.each([
    ['darwin', 'mis pdfs'],
    ['linux', 'mis pdfs'],
    ['win32', 'mis\\ pdfs'],
  ] as const)('%s: en la configuración', async (platform, folder) => {
    const directory = temporary();

    await run(platform, () => runConfigMenu(), [
      [/Configuración/, 'Modificar configuración'],
      [/Qué querés modificar/, 'Carpeta'],
      [/arrastrar la carpeta/, `${directory}/mis\\ pdfs`],
      [/Qué querés modificar/, BACK],
      [/Configuración/, BACK],
    ]);

    expect(JSON.parse(readFileSync(join(profile.configDirectory, 'config.json'), 'utf8'))).toMatchObject({
      ticketPath: resolve(`${directory}/${folder}`),
    });
  });
});
