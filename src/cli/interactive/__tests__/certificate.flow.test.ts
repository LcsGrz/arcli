import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signRequestLikeArca } from '../../../modules/certificates/__tests__/fake-arca-ca';
import { BACK } from '../../../modules/interactive/wizard';
import { runCertificateMenu, runGenerateCertificate, runImportCertificate } from '../certificate.flow';
import { askTextStep, chooseStep, confirm } from '../prompts';

vi.mock('../prompts', () => ({ askTextStep: vi.fn(), chooseStep: vi.fn(), confirm: vi.fn() }));

// Pocas claves RSA por archivo, reusadas: generar una por pedido hacía lento el archivo.
vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:crypto')>();
  const { pooledGenerateKeyPairSync } = await import('../../../modules/certificates/__tests__/rsa-key-pool');

  return { ...original, generateKeyPairSync: pooledGenerateKeyPairSync(original.generateKeyPairSync) };
});

const state = vi.hoisted(() => ({ config: {} as Record<string, unknown>, root: '' }));

vi.mock('../../../modules/config/config.service', () => ({
  ConfigService: class {
    public close() {}
    public getCertificatesPath() {
      return join(state.root, 'certificados');
    }
    public getConfig() {
      return state.config;
    }
    public setValue(key: string, value: string) {
      const [group, environment] = key.split('.') as ['cert' | 'key', string];

      state.config = {
        ...state.config,
        [group]: { ...(state.config[group] as object), [environment]: value },
      };
    }
  },
}));

const askTextMock = vi.mocked(askTextStep);
const chooseStepMock = vi.mocked(chooseStep);
let output = '';

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'arcli-certificate-flow-'));
  state.config = {
    cert: {},
    cuit: '20123456786',
    emisor: {},
    entornoPorDefecto: 'testing',
    key: {},
    output: { brutoPorDefecto: false, emitirPorDefecto: false, jsonPorDefecto: false },
  };
  output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk);

    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    output += String(chunk);

    return true;
  });
});

afterEach(() => {
  rmSync(state.root, { force: true, recursive: true });
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/** El CSR que dejo `generar`, firmado como ARCA, en un .crt con un espacio en el nombre. */
function downloadCertificate(environment = 'testing'): string {
  const csr = readFileSync(join(state.root, 'certificados', '20123456786', `${environment}.nueva.csr`), 'utf8');
  const path = join(state.root, 'mi certificado.crt');

  writeFileSync(path, signRequestLikeArca(csr));

  return path;
}

describe('runGenerateCertificate', () => {
  it('arma el pedido, muestra el CSR y lo deja pendiente si el .crt todavía no está', async () => {
    askTextMock.mockResolvedValueOnce('mi-pc');
    chooseStepMock.mockResolvedValueOnce('despues');

    await expect(runGenerateCertificate('testing')).resolves.toBe('pendiente');

    expect(output).toContain('BEGIN CERTIFICATE REQUEST');
    expect(output).toContain('Certificados de ARCA');
    expect(state.config.cert).toEqual({});
  });

  it('carga el .crt en el momento, aunque la ruta venga arrastrada con espacios escapados', async () => {
    askTextMock.mockResolvedValueOnce('arcli');
    chooseStepMock.mockResolvedValueOnce('testing').mockImplementationOnce(async () => {
      const path = downloadCertificate();

      // Arrastrado a la terminal: macOS escapa los espacios; Windows lo pega entre comillas.
      askTextMock.mockResolvedValueOnce(process.platform === 'win32' ? `"${path}"` : `${path.replace(/ /g, '\\ ')} `);

      return 'importar';
    });

    await expect(runGenerateCertificate()).resolves.toBe('importado');

    expect(state.config.cert).toEqual({ testing: join(state.root, 'certificados', '20123456786', 'testing.crt') });
    expect(output).toContain('cargado');
  });

  it('con un pedido pendiente, ofrece verlo de nuevo sin armar otro', async () => {
    askTextMock.mockResolvedValueOnce('arcli');
    chooseStepMock.mockResolvedValueOnce('despues');
    await runGenerateCertificate('testing');

    const csr = readFileSync(join(state.root, 'certificados', '20123456786', 'testing.nueva.csr'), 'utf8');

    output = '';
    chooseStepMock.mockResolvedValueOnce('ver').mockResolvedValueOnce('despues');

    await runGenerateCertificate('testing');

    expect(output).toContain(csr.replace(/\r/g, '').trim());
    expect(askTextMock).toHaveBeenCalledTimes(1);
  });
});

describe('runImportCertificate', () => {
  it('pregunta antes de reemplazar otro certificado y no toca nada si se dice que no', async () => {
    askTextMock.mockResolvedValueOnce('arcli');
    chooseStepMock.mockResolvedValueOnce('despues');
    await runGenerateCertificate('testing');
    state.config = { ...state.config, cert: { testing: '/otra/carpeta/cert.crt' } };
    askTextMock.mockResolvedValueOnce(downloadCertificate());
    vi.mocked(confirm).mockResolvedValueOnce(false);

    await expect(runImportCertificate()).resolves.toBe(BACK);

    expect(state.config.cert).toEqual({ testing: '/otra/carpeta/cert.crt' });
  });

  it('muestra el error de un certificado que no corresponde y vuelve', async () => {
    const path = join(state.root, 'otro.crt');

    writeFileSync(path, 'no es un certificado');
    askTextMock.mockResolvedValueOnce(path);

    await expect(runImportCertificate()).resolves.toBe(BACK);

    expect(output).toContain('no tiene un certificado');
  });

  it('un archivo que no se puede leer se muestra en castellano y vuelve', async () => {
    askTextMock.mockResolvedValueOnce(state.root);

    await expect(runImportCertificate()).resolves.toBe(BACK);

    expect(output).toContain('No se pudo leer');
    expect(output).toContain('es una carpeta');
    expect(output).not.toContain('EISDIR');
  });

  it('valida que el archivo exista', async () => {
    askTextMock.mockImplementationOnce(async (_message, options) => {
      expect(options?.validate?.('/no/existe.crt')).toMatch(/No existe/);
      expect(options?.validate?.('')).toMatch(/arrastralo/);

      return BACK;
    });

    await expect(runImportCertificate()).resolves.toBe(BACK);
  });
});

describe('runCertificateMenu', () => {
  it('muestra el estado de los dos entornos', async () => {
    chooseStepMock.mockResolvedValueOnce(BACK);

    await runCertificateMenu();

    expect(output).toContain('Sin certificado');
    expect(output.toUpperCase()).toContain('CERTIFICADO DE TESTING');
    expect(output.toUpperCase()).toContain('CERTIFICADO DE PRODUCCIÓN');
  });
});

describe('certificados: volver y casos raros', () => {
  it('volver al elegir el entorno, con un pedido pendiente o en el alias no arma nada', async () => {
    chooseStepMock.mockResolvedValueOnce(BACK);
    await expect(runGenerateCertificate()).resolves.toBe(BACK);

    askTextMock.mockResolvedValueOnce(BACK);
    await expect(runGenerateCertificate('testing')).resolves.toBe(BACK);
    expect(output).not.toContain('BEGIN CERTIFICATE REQUEST');

    // Con un pedido pendiente, volver en "¿Qué hacemos?" no lo toca.
    askTextMock.mockResolvedValueOnce('arcli');
    chooseStepMock.mockResolvedValueOnce('despues');
    await runGenerateCertificate('testing');

    const csr = readFileSync(join(state.root, 'certificados', '20123456786', 'testing.nueva.csr'), 'utf8');

    chooseStepMock.mockResolvedValueOnce(BACK);
    await expect(runGenerateCertificate('testing')).resolves.toBe(BACK);
    expect(readFileSync(join(state.root, 'certificados', '20123456786', 'testing.nueva.csr'), 'utf8')).toBe(csr);
  });

  it('"Descartarlo y armar otro" reemplaza el pedido pendiente', async () => {
    askTextMock.mockResolvedValueOnce('arcli');
    chooseStepMock.mockResolvedValueOnce('despues');
    await runGenerateCertificate('testing');

    const before = readFileSync(join(state.root, 'certificados', '20123456786', 'testing.nueva.csr'), 'utf8');

    askTextMock.mockResolvedValueOnce('otro-alias');
    chooseStepMock.mockResolvedValueOnce('reemplazar').mockResolvedValueOnce('despues');
    await expect(runGenerateCertificate('testing')).resolves.toBe('pendiente');

    expect(readFileSync(join(state.root, 'certificados', '20123456786', 'testing.nueva.csr'), 'utf8')).not.toBe(before);
  });

  it('si al cargar el .crt se vuelve, el pedido queda pendiente', async () => {
    askTextMock.mockResolvedValueOnce('arcli').mockResolvedValueOnce(BACK);
    chooseStepMock.mockResolvedValueOnce('importar');

    await expect(runGenerateCertificate('testing')).resolves.toBe('pendiente');
    expect(state.config.cert).toEqual({});
  });

  it('una carpeta no es un .crt', async () => {
    askTextMock.mockImplementationOnce(async (_message, options) => {
      expect(options?.validate?.(state.root)).toMatch(/No existe/);

      return BACK;
    });

    await expect(runImportCertificate()).resolves.toBe(BACK);
  });

  it('reemplaza el certificado configurado si se confirma', async () => {
    askTextMock.mockResolvedValueOnce('arcli');
    chooseStepMock.mockResolvedValueOnce('despues');
    await runGenerateCertificate('testing');
    state.config = { ...state.config, cert: { testing: '/otra/carpeta/cert.crt' } };
    askTextMock.mockResolvedValueOnce(downloadCertificate());
    vi.mocked(confirm).mockResolvedValueOnce(true);

    await expect(runImportCertificate()).resolves.toBe('importado');

    expect(state.config.cert).toEqual({ testing: join(state.root, 'certificados', '20123456786', 'testing.crt') });
    expect(output).toContain('reemplaza al anterior');
  });

  it('sin CUIT en la config (configuración incompleta), avisa y vuelve sin cargar nada', async () => {
    const path = join(state.root, 'x.crt');

    writeFileSync(path, '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n');
    askTextMock.mockResolvedValueOnce(path);
    state.config = { ...state.config, cuit: undefined };

    await expect(runImportCertificate()).resolves.toBe(BACK);
    expect(state.config.cert).toEqual({});
    expect(output).toMatch(/CUIT/);
  });

  it('desde el menu se saca o carga un certificado y se vuelve al menu', async () => {
    askTextMock.mockResolvedValueOnce('arcli').mockResolvedValueOnce(BACK);
    chooseStepMock
      .mockResolvedValueOnce('generar')
      .mockResolvedValueOnce('testing')
      .mockResolvedValueOnce('despues')
      .mockResolvedValueOnce('importar')
      .mockResolvedValueOnce(BACK);

    await runCertificateMenu();

    expect(output).toContain('BEGIN CERTIFICATE REQUEST');
    expect(chooseStepMock).toHaveBeenCalledTimes(5);
  });
});
