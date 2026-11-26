import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeCertificatePem, readArcaCertificate } from '../../../lib/security/arca-certificate';
import { nodeCertificateStore } from '../../../services/files/certificate-store';
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
  /** Cada escritura en la config, con las claves que guardó: `certificado importar` tiene que ser una sola. */
  const writes: Array<ReadonlyArray<readonly [key: string, value: string]>> = [];
  const save = (changes: ReadonlyArray<readonly [key: string, value: string]>) => {
    writes.push(changes);

    for (const [key, value] of changes) {
      const [group, environment] = key.split('.') as ['cert' | 'key', 'produccion' | 'testing'];

      config = { ...config, [group]: { ...config[group], [environment]: value } };
    }
  };
  // Con `changeValues`, como ConfigService (ARQ-12 PR 3). Va en una variable: el puerto de hoy no lo tiene.
  const configPort = {
    changeValues: ({
      set,
    }: {
      readonly remove: readonly string[];
      readonly set: ReadonlyArray<readonly [string, string]>;
    }) => save(set),
    getConfig: () => config,
    setValue: (key: string, value: string) => save([[key, value]]),
  };
  const service = new CertificateService({
    certificatesRoot: root,
    config: configPort,
    clock: { now: () => new Date('2026-11-04T12:00:00Z') },
    store: nodeCertificateStore,
  });

  return { config: () => config, root, service, writes };
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

    it('si es una carpeta dice que no la pudo leer, con la ruta abreviada', () => {
      const { files, other, root, service } = importedWithOther();

      rmSync(files.key);
      mkdirSync(files.key);

      const error = rejection(() => service.import({ content: other }));

      expect(error).toMatchObject({
        code: 'CERTIFICATE_KEY_MISMATCH',
        message: `No se pudo leer la clave privada .../${CUIT}/testing.key: es una carpeta.`,
      });
      expect(error.suggestion).toBe(
        'Revisá que tu usuario tenga permiso para leer esa clave y su carpeta, y volvé a importar el certificado. Si esa clave se perdió, armá otro pedido con `arcli certificado generar --testing`.',
      );
      expect(JSON.stringify(error)).not.toContain(root);
    });

    it('con un pedido que tampoco corresponde, dice las dos cosas', () => {
      const { files, other, service } = importedWithOther();

      service.generate({ environment: 'testing' });
      rmSync(files.key);
      mkdirSync(files.key);

      expect(rejection(() => service.import({ content: other }))).toMatchObject({
        code: 'CERTIFICATE_KEY_MISMATCH',
        message: `El certificado no corresponde a la clave del último pedido, y no se pudo leer la clave privada .../${CUIT}/testing.key: es una carpeta.`,
        suggestion:
          'Bajá de ARCA el certificado que creaste con el último CSR de `arcli certificado generar`. Si no es de ese pedido, revisá que tu usuario tenga permiso para leer esa clave y su carpeta, y volvé a importar el certificado.',
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

    it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)(
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
            suggestion:
              'Revisá que tu usuario tenga permiso para leer esa clave y su carpeta, y volvé a importar el certificado.',
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

  // Tests primero (ARQ-12 PR 3): pasa a it() al implementarlo.
  it.fails('importar guarda el certificado y la clave en la config en un solo cambio (ARQ-12)', () => {
    const { root, service, writes } = setup();
    const request = service.generate({ environment: 'produccion' });
    const files = resolveCertificateFiles(root, CUIT, 'produccion');

    service.import({ content: signRequestLikeArca(request.csrPem, { issuer: 'Computadores' }) });

    expect(writes).toEqual([
      expect.arrayContaining([
        ['cert.produccion', files.certificate],
        ['key.produccion', files.key],
      ]),
    ]);
  });

  /** Caracterización antes de ARQ-12: los archivos pasan a un `CertificateStore` y esto tiene que quedar igual. */
  describe('los archivos del certificado (ARQ-12)', () => {
    function permissions(path: string): number {
      return statSync(path).mode & 0o777;
    }

    it.skipIf(process.platform === 'win32')(
      'generar deja la carpeta en 0700 y la clave en 0600, aunque la umask sea abierta',
      () => {
        const previousUmask = process.umask(0o022);

        try {
          const { root, service } = setup();
          const files = resolveCertificateFiles(root, CUIT, 'testing');

          service.generate({ environment: 'testing' });

          expect(permissions(files.folder)).toBe(0o700);
          expect(permissions(files.pendingKey)).toBe(0o600);
        } finally {
          process.umask(previousUmask);
        }
      },
    );

    it('generar deja el pedido como .nueva y no toca la clave ni el pedido activos', () => {
      const { root, service } = setup();
      const files = resolveCertificateFiles(root, CUIT, 'testing');

      service.import({ content: signRequestLikeArca(service.generate({ environment: 'testing' }).csrPem) });

      const [key, request] = [readFileSync(files.key, 'utf8'), readFileSync(files.request, 'utf8')];
      const renewal = service.generate({ environment: 'testing' });

      expect(readFileSync(files.pendingKey, 'utf8')).toContain('PRIVATE KEY');
      expect(readFileSync(files.pendingRequest, 'utf8')).toBe(renewal.csrPem);
      expect(readFileSync(files.key, 'utf8')).toBe(key);
      expect(readFileSync(files.request, 'utf8')).toBe(request);
    });

    it('importar rota el certificado y la clave activos a .anterior y deja el nuevo con su pedido', () => {
      const { root, service } = setup();
      const files = resolveCertificateFiles(root, CUIT, 'testing');

      service.import({ content: signRequestLikeArca(service.generate({ environment: 'testing' }).csrPem) });

      const [oldCertificate, oldKey] = [readFileSync(files.certificate, 'utf8'), readFileSync(files.key, 'utf8')];
      const renewal = service.generate({ environment: 'testing' });
      const pendingKey = readFileSync(files.pendingKey, 'utf8');
      const certificate = signRequestLikeArca(renewal.csrPem);

      service.import({ content: certificate });

      expect(readFileSync(files.previousCertificate, 'utf8')).toBe(oldCertificate);
      expect(readFileSync(files.previousKey, 'utf8')).toBe(oldKey);
      expect(readFileSync(files.certificate, 'utf8')).toBe(normalizeCertificatePem(certificate));
      expect(readFileSync(files.key, 'utf8')).toBe(pendingKey);
      expect(readFileSync(files.request, 'utf8')).toBe(renewal.csrPem);
      expect([existsSync(files.pendingKey), existsSync(files.pendingRequest)]).toEqual([false, false]);
    });

    it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)(
      'generar con un pedido que no se puede leer falla, no lo trata como ausente ni lo pisa',
      () => {
        const { root, service } = setup();
        const files = resolveCertificateFiles(root, CUIT, 'testing');

        service.generate({ environment: 'testing' });

        const [pendingKey, pendingRequest] = [
          readFileSync(files.pendingKey, 'utf8'),
          readFileSync(files.pendingRequest, 'utf8'),
        ];

        // Solo escritura: si la lectura se tomara como "no hay pedido", la clave se podría pisar sin error.
        chmodSync(files.pendingKey, 0o200);

        try {
          expect(() => service.generate({ environment: 'testing' })).toThrow(
            expect.objectContaining({ code: 'EACCES', path: files.pendingKey }),
          );
        } finally {
          chmodSync(files.pendingKey, 0o600);
        }

        expect(readFileSync(files.pendingKey, 'utf8')).toBe(pendingKey);
        expect(readFileSync(files.pendingRequest, 'utf8')).toBe(pendingRequest);
      },
    );

    it('estado: lee el certificado configurado y el pedido pendiente', () => {
      const { root, service } = setup();
      const files = resolveCertificateFiles(root, CUIT, 'testing');

      expect(service.status('testing')).toEqual({
        alias: undefined,
        certificatePath: undefined,
        environment: 'testing',
        expiresAt: undefined,
        keyPath: undefined,
        pendingRequestPath: undefined,
        unreadable: false,
      });

      const imported = service.import({
        content: signRequestLikeArca(service.generate({ alias: 'mi-pc', environment: 'testing' }).csrPem),
      });
      const renewal = service.generate({ environment: 'testing' });

      expect(service.status('testing')).toEqual({
        alias: 'mi-pc',
        certificatePath: files.certificate,
        environment: 'testing',
        expiresAt: imported.expiresAt,
        keyPath: files.key,
        pendingRequestPath: files.pendingRequest,
        unreadable: false,
      });
      expect(service.readPendingRequest('testing')).toBe(renewal.csrPem);
      expect(service.readPendingRequest('produccion')).toBeUndefined();
    });

    it('estado: un certificado configurado que no está o no es X.509 queda ilegible, sin fallar', () => {
      const { root, service } = setup({ cert: { testing: join(tmpdir(), 'arcli-no-existe', 'testing.crt') } });

      expect(service.status('testing')).toMatchObject({ expiresAt: undefined, unreadable: true });

      const notCertificate = join(root, 'texto.crt');

      writeFileSync(notCertificate, 'hola');

      expect(setup({ cert: { testing: notCertificate } }).service.status('testing')).toMatchObject({
        unreadable: true,
      });
    });

    it('sin CUIT no hay pedido que leer', () => {
      expect(setup({ cuit: undefined }).service.readPendingRequest('testing')).toBeUndefined();
    });
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
