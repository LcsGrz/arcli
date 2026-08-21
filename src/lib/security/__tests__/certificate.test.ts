import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { type CertificateExpiry, isCertificateExpiringSoon, readCertificateExpiry } from '../certificate';

const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createSelfSignedCertificate(days: number): string {
  const directory = mkdtempSync(join(tmpdir(), 'arcli-certificate-test-'));

  temporaryDirectories.push(directory);

  const keyPath = join(directory, 'key.pem');
  const certPath = join(directory, 'cert.pem');

  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      String(days),
      '-nodes',
      '-subj',
      '/CN=arcli-test',
    ],
    { stdio: 'ignore' },
  );

  return readFileSync(certPath, 'utf8');
}

function createExpiry(partial: Partial<CertificateExpiry>): CertificateExpiry {
  return {
    daysRemaining: partial.daysRemaining ?? 0,
    expiresAt: partial.expiresAt ?? new Date(),
    isExpired: partial.isExpired ?? false,
  };
}

describe('readCertificateExpiry', () => {
  it('calcula los dias restantes de un certificado vigente y lejano', () => {
    const pem = createSelfSignedCertificate(365);
    const expiry = readCertificateExpiry(pem);

    expect(expiry.isExpired).toBe(false);
    expect(expiry.daysRemaining).toBeGreaterThan(300);
  }, 10_000);

  it('calcula los dias restantes de un certificado a punto de vencer', () => {
    const pem = createSelfSignedCertificate(10);
    const expiry = readCertificateExpiry(pem);

    expect(expiry.isExpired).toBe(false);
    expect(expiry.daysRemaining).toBeLessThanOrEqual(10);
    expect(expiry.daysRemaining).toBeGreaterThan(0);
  }, 10_000);
});

describe('isCertificateExpiringSoon', () => {
  it('avisa cuando el certificado vence dentro del umbral', () => {
    expect(isCertificateExpiringSoon(createExpiry({ daysRemaining: 5, isExpired: false }), 30)).toBe(true);
  });

  it('no avisa cuando el certificado vence lejos del umbral', () => {
    expect(isCertificateExpiringSoon(createExpiry({ daysRemaining: 200, isExpired: false }), 30)).toBe(false);
  });

  it('no avisa por un certificado que ya vencio', () => {
    expect(isCertificateExpiringSoon(createExpiry({ daysRemaining: -5, isExpired: true }), 30)).toBe(false);
  });
});
