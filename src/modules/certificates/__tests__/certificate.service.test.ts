import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readArcaCertificate } from '../../../lib/security/arca-certificate';
import type { ArcliConfig } from '../../config/config.schemas';
import { CertificateService } from '../certificate.service';
import { resolveCertificateFiles } from '../certificate-store';

import { signRequestLikeArca } from './fake-arca-ca';

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
    now: () => new Date('2026-11-04T12:00:00Z'),
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
