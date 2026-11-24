// Tests primero: en rojo hasta el arreglo (ERR-4 y ERR-8).
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readArcaCertificate } from '../../../lib/security/arca-certificate';
import type { ArcliConfig } from '../../config/config.schemas';
import { CertificateService } from '../certificate.service';
import { resolveCertificateFiles } from '../certificate-store';

import { signRequestLikeArca } from './fake-arca-ca';

// Una clave RSA por pedido tardaba segundos en toda la suite: se generan unas pocas por archivo y se reusan.
vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:crypto')>();
  const { pooledGenerateKeyPairSync } = await import('./rsa-key-pool');

  return { ...original, generateKeyPairSync: pooledGenerateKeyPairSync(original.generateKeyPairSync) };
});

const CUIT = '20123456786';
const directories: string[] = [];

function setup(overrides: Partial<ArcliConfig> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'arcli-certificados-'));

  directories.push(root);

  let config: ArcliConfig = {
    cert: {},
    cuit: CUIT,
    emisor: {},
    entornoPorDefecto: 'testing',
    key: {},
    output: { brutoPorDefecto: false, emitirPorDefecto: false, jsonPorDefecto: false },
    ...overrides,
  };
  const service = new CertificateService({
    certificatesRoot: root,
    config: {
      getConfig: () => config,
      setValue: (key, value) => {
        const [group, environment] = key.split('.') as ['cert' | 'key', 'produccion' | 'testing'];

        config = { ...config, [group]: { ...config[group], [environment]: value } };
      },
    },
    clock: { now: () => new Date('2026-11-04T12:00:00Z') },
  });

  return { config: () => config, root, service };
}

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { force: true, recursive: true }));
});

describe('CertificateService', () => {
  it('generates a pending key and a CSR with the subject ARCA expects', () => {
    const { root, service } = setup({ emisor: { razonSocial: 'Ana Gomez' } });
    const request = service.generate({ alias: 'mi-pc', environment: 'produccion' });
    const files = resolveCertificateFiles(root, CUIT, 'produccion');

    expect(request).toMatchObject({ alias: 'mi-pc', cuit: CUIT, environment: 'produccion' });
    expect(request.keyPath).toBe(files.pendingKey);
    expect(readFileSync(files.pendingRequest, 'utf8')).toBe(request.csrPem);

    const signed = readArcaCertificate(signRequestLikeArca(request.csrPem, { issuer: 'Computadores' }));

    expect(signed).toMatchObject({ alias: 'mi-pc', cuit: CUIT, environment: 'produccion' });

    if (process.platform !== 'win32') {
      expect(statSync(files.pendingKey).mode & 0o777).toBe(0o600);
    }
  });

  it('does not discard a pending request without --reemplazar', () => {
    const { service } = setup();
    const first = service.generate({ environment: 'testing' });

    expect(() => service.generate({ environment: 'testing' })).toThrow(
      expect.objectContaining({ code: 'CERTIFICATE_REQUEST_PENDING' }),
    );
    expect(service.generate({ environment: 'testing', replace: true }).csrPem).not.toBe(first.csrPem);
  });

  it('imports the certificate, detects the environment from the issuer and configures it', () => {
    const { config, root, service } = setup();
    const request = service.generate({ environment: 'testing' });
    const imported = service.import({ content: `\uFEFF${signRequestLikeArca(request.csrPem).replace(/\n/g, '\r\n')}` });
    const files = resolveCertificateFiles(root, CUIT, 'testing');

    expect(imported).toMatchObject({
      alias: 'arcli',
      certificatePath: files.certificate,
      cuit: CUIT,
      environment: 'testing',
      keyPath: files.key,
      replaced: false,
    });
    expect(config().cert.testing).toBe(files.certificate);
    expect(config().key.testing).toBe(files.key);
    expect(existsSync(files.pendingKey)).toBe(false);
    expect(existsSync(files.request)).toBe(true);
  });

  it('renews: keeps the active key until the new certificate is imported, then keeps the old pair aside', () => {
    const { config, root, service } = setup();

    service.import({ content: signRequestLikeArca(service.generate({ environment: 'testing' }).csrPem) });

    const files = resolveCertificateFiles(root, CUIT, 'testing');
    const oldKey = readFileSync(files.key, 'utf8');
    const renewal = service.generate({ environment: 'testing' });

    expect(readFileSync(files.key, 'utf8')).toBe(oldKey);

    const imported = service.import({ content: signRequestLikeArca(renewal.csrPem) });

    expect(imported.replaced).toBe(false);
    expect(readFileSync(files.previousKey, 'utf8')).toBe(oldKey);
    expect(existsSync(files.previousCertificate)).toBe(true);
    expect(config().key.testing).toBe(files.key);
  });

  it('asks before replacing a certificate configured somewhere else', () => {
    const { config, service } = setup({ cert: { testing: '/otra/carpeta/cert.crt' }, key: {} });
    const certificate = signRequestLikeArca(service.generate({ environment: 'testing' }).csrPem);

    expect(() => service.import({ content: certificate })).toThrow(
      expect.objectContaining({ code: 'CERTIFICATE_REPLACE_CONFIRMATION' }),
    );
    expect(config().cert.testing).toBe('/otra/carpeta/cert.crt');
    expect(service.import({ content: certificate, replace: true }).replaced).toBe(true);
  });

  it.each([
    ['not a certificate', () => 'hola', 'CERTIFICATE_INVALID'],
    ['another CUIT', () => signWithOtherCuit(), 'CERTIFICATE_CUIT_MISMATCH'],
    [
      'expired',
      (csr: string) => signRequestLikeArca(csr, { notAfter: new Date('2026-10-01T00:00:00Z') }),
      'CERTIFICATE_EXPIRED',
    ],
    [
      'an unknown issuer',
      (csr: string) => signRequestLikeArca(csr, { issuer: 'Otra CA' }),
      'CERTIFICATE_ENVIRONMENT_UNKNOWN',
    ],
  ])('rejects %s without touching the config', (_label, build, code) => {
    const { config, service } = setup();
    const csr = service.generate({ environment: 'testing' }).csrPem;
    const content = build(csr);

    expect(() => service.import({ content })).toThrow(expect.objectContaining({ code }));
    expect(config().cert.testing).toBeUndefined();
  });

  it('rejects a certificate made for another key', () => {
    const { service } = setup();
    const other = setup().service.generate({ environment: 'testing' });

    service.generate({ environment: 'testing' });

    expect(() => service.import({ content: signRequestLikeArca(other.csrPem) })).toThrow(
      expect.objectContaining({ code: 'CERTIFICATE_KEY_MISMATCH' }),
    );
  });

  it('rejects a certificate that does not match the configured key when there is no pending request (TEST-21)', () => {
    const { config, root, service } = setup();

    service.import({ content: signRequestLikeArca(service.generate({ environment: 'testing' }).csrPem) });

    const files = resolveCertificateFiles(root, CUIT, 'testing');
    const before = readFileSync(files.certificate, 'utf8');
    const other = setup().service.generate({ environment: 'testing' });

    expect(() => service.import({ content: signRequestLikeArca(other.csrPem) })).toThrow(
      expect.objectContaining({ code: 'CERTIFICATE_KEY_MISMATCH', message: expect.stringContaining('ninguna clave') }),
    );
    expect(readFileSync(files.certificate, 'utf8')).toBe(before);
    expect(config().key.testing).toBe(files.key);
  });

  describe('la clave existe y no se puede leer (readKey)', () => {
    /** Un par importado y, aparte, un certificado que no es de ese par. */
    function importedWithOther() {
      const context = setup();

      context.service.import({
        content: signRequestLikeArca(context.service.generate({ environment: 'testing' }).csrPem),
      });

      const other = signRequestLikeArca(setup().service.generate({ environment: 'testing' }).csrPem);

      return { ...context, files: resolveCertificateFiles(context.root, CUIT, 'testing'), other };
    }

    function rejection(run: () => unknown): { code: string; message: string; suggestion?: string } {
      try {
        run();
      } catch (error) {
        return error as { code: string; message: string; suggestion?: string };
      }

      throw new Error('debería fallar');
    }

    it.fails('si es una carpeta dice que no la pudo leer, con la ruta abreviada', () => {
      const { files, other, root, service } = importedWithOther();

      rmSync(files.key);
      mkdirSync(files.key);

      const error = rejection(() => service.import({ content: other }));

      expect(error).toMatchObject({
        code: 'CERTIFICATE_KEY_MISMATCH',
        message: `No se pudo leer la clave privada .../${CUIT}/testing.key: es una carpeta.`,
      });
      expect(error.suggestion).not.toContain('Primero armá el pedido');
      expect(JSON.stringify(error)).not.toContain(root);
    });

    it.fails('con un pedido que tampoco corresponde, dice las dos cosas', () => {
      const { files, other, service } = importedWithOther();

      service.generate({ environment: 'testing' });
      rmSync(files.key);
      mkdirSync(files.key);

      expect(rejection(() => service.import({ content: other }))).toMatchObject({
        code: 'CERTIFICATE_KEY_MISMATCH',
        message: `El certificado no corresponde a la clave del último pedido, y no se pudo leer la clave privada .../${CUIT}/testing.key: es una carpeta.`,
      });
    });

    it('si no existe, como siempre', () => {
      const { files, other, service } = importedWithOther();

      rmSync(files.key);

      expect(rejection(() => service.import({ content: other }))).toMatchObject({
        code: 'CERTIFICATE_KEY_MISMATCH',
        message: 'El certificado no corresponde a ninguna clave de este CUIT.',
        suggestion: expect.stringContaining('Primero armá el pedido'),
      });
    });

    it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0).fails(
      'con la carpeta sin permiso, no dice que falta armar el pedido',
      () => {
        const { root, service } = setup();
        const request = service.generate({ environment: 'testing' });
        const folder = resolveCertificateFiles(root, CUIT, 'testing').folder;

        chmodSync(folder, 0o000);

        try {
          expect(rejection(() => service.import({ content: signRequestLikeArca(request.csrPem) }))).toMatchObject({
            code: 'CERTIFICATE_KEY_MISMATCH',
            message: `No se pudo leer la clave privada .../${CUIT}/testing.nueva.key: no tenés permiso.`,
            suggestion: expect.stringContaining('permiso'),
          });
        } finally {
          chmodSync(folder, 0o700);
        }
      },
    );
  });

  it('re-importing the active certificate keeps its key in place (TEST-21)', () => {
    const { config, root, service } = setup();
    const certificate = signRequestLikeArca(service.generate({ environment: 'testing' }).csrPem);

    service.import({ content: certificate });

    const files = resolveCertificateFiles(root, CUIT, 'testing');
    const key = readFileSync(files.key, 'utf8');

    expect(service.import({ content: certificate, environment: 'testing' })).toMatchObject({
      keyPath: files.key,
      replaced: false,
    });
    expect(readFileSync(files.key, 'utf8')).toBe(key);
    expect(existsSync(files.previousKey)).toBe(false);
    expect(config().key.testing).toBe(files.key);
  });

  it('accepts an unknown issuer with an explicit environment, and rejects a contradicting one', () => {
    const { service } = setup();
    const csr = service.generate({ environment: 'produccion' }).csrPem;

    expect(() =>
      service.import({ content: signRequestLikeArca(csr, { issuer: 'Computadores Test' }), environment: 'produccion' }),
    ).toThrow(/es de testing/);
    expect(
      service.import({ content: signRequestLikeArca(csr, { issuer: 'Otra CA' }), environment: 'produccion' })
        .environment,
    ).toBe('produccion');
  });
});

function signWithOtherCuit(): string {
  const other = setup({ cuit: '30712345671' }).service.generate({ environment: 'testing' });

  return signRequestLikeArca(other.csrPem);
}
