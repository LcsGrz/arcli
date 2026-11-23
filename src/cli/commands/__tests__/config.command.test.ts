import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArcliConfig, ArcliEnvironment } from '../../../modules/config/config.schemas';
import { createProgram } from '../../program';
import { buildRuntimeChecks } from '../config.command';

const validate = vi.fn();
const checked: ArcliEnvironment[] = [];

vi.mock('../../arca-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../arca-runtime')>()),
  checkProfileFromConfig: (_config: ArcliConfig, environment: ArcliEnvironment): unknown => {
    checked.push(environment);

    return validate();
  },
}));

const CONFIG = {
  cert: { testing: '/certs/testing.pem' },
  cuit: '20123456786',
  emisor: {},
  entornoPorDefecto: 'testing',
  key: { testing: '/certs/testing.key' },
  output: { brutoPorDefecto: false, emitirPorDefecto: false, jsonPorDefecto: false },
} satisfies ArcliConfig;

let storedConfig: ArcliConfig = CONFIG;

vi.mock('../../../modules/config/config.service', async (importOriginal) => ({
  deprecatedConfigKeyWarning: (await importOriginal<typeof import('../../../modules/config/config.service')>())
    .deprecatedConfigKeyWarning,
  ConfigService: class {
    public setValue(): ArcliConfig {
      return storedConfig;
    }
    public unsetValue(): ArcliConfig {
      return storedConfig;
    }
    public close(): void {}
    public ensureInitialized(): ArcliConfig {
      return storedConfig;
    }
    public getConfig(): ArcliConfig {
      return storedConfig;
    }
    public getPluginsPath(): string {
      return '/arcli-test/plugins-que-no-existen';
    }
    public resolvePaths(): { pdfFolder: string; ticketPath: string } {
      return { pdfFolder: '/pdfs', ticketPath: '/tickets' };
    }
  },
}));

beforeEach(() => {
  storedConfig = CONFIG;
  validate.mockReset();
  checked.length = 0;
});

describe('buildRuntimeChecks', () => {
  it('valida solo el entorno por defecto si el otro no tiene credenciales', () => {
    expect(buildRuntimeChecks(CONFIG)).toEqual([{ environment: 'testing' }]);
    expect(checked).toEqual(['testing']);
  });

  it('valida los dos entornos cuando produccion tiene credenciales', () => {
    validate
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('No se encontró el certificado.');
      });

    const checks = buildRuntimeChecks({ ...CONFIG, cert: { ...CONFIG.cert, produccion: '/certs/prod.pem' } });

    expect(checks).toEqual([
      { environment: 'testing' },
      { environment: 'produccion', error: 'No se encontró el certificado.' },
    ]);
    expect(checked).toEqual(['testing', 'produccion']);
  });
});

describe('arcli config', () => {
  it('respeta --json en config revisar aunque lo parsee el programa', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await createProgram().parseAsync(['node', 'arcli', 'config', 'revisar', '--json']);

      const output = write.mock.calls.map(([chunk]) => String(chunk)).join('');

      expect(JSON.parse(output)).toHaveProperty('chequeos');
      expect(output).toContain('"etiqueta": "Validación testing"');
      // Con pdf=preguntar (por defecto) y el plugin sin instalar no se revisa.
      expect(output).not.toContain('"etiqueta": "Plugin de PDF"');
    } finally {
      write.mockRestore();
    }
  });

  it('sale en JSON con json=true en la config, sin el flag', async () => {
    storedConfig = { ...CONFIG, output: { ...CONFIG.output, jsonPorDefecto: true } };
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await createProgram().parseAsync(['node', 'arcli', 'config']);

      const output = write.mock.calls.map(([chunk]) => String(chunk)).join('');

      expect(JSON.parse(output)).toHaveProperty('cuit', '20123456786');
    } finally {
      write.mockRestore();
    }
  });

  it.each([
    [['establecer', 'comprobantesPorLista', '20'], true],
    [['eliminar', 'comprobantesPorLista'], true],
    [['establecer', 'filasPorLista', '20'], false],
  ])('config %j avisa la clave deprecada: %s', async (args, warns) => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await createProgram().parseAsync(['node', 'arcli', 'config', ...args, '--json']);

      const notice = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');

      if (warns) {
        expect(notice).toContain('"comprobantesPorLista" está deprecada');
        expect(notice).toContain('filasPorLista');
      } else {
        expect(notice).not.toContain('deprecada');
      }
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it('ya no acepta --testing ni --produccion en config revisar como opcion propia', () => {
    const revisar = createProgram()
      .commands.find((command) => command.name() === 'config')
      ?.commands.find((command) => command.name() === 'revisar');

    expect(revisar?.options.map((option) => option.long)).toEqual(['--json']);
  });
});
