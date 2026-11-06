import { Arca } from '@arcasdk/core';
import tls from 'node:tls';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CertificateExpiredError, type CertificateExpiryNotice } from '../../../modules/config/certificate-expiry';
import { ArcaClientFactory } from '../arca-client.factory';
import type { ResolvedArcaRuntime } from '../arca-context.resolver';

vi.mock('@arcasdk/core', () => ({ Arca: vi.fn() }));
vi.mock('../../../lib/security/pem', () => ({ readPemFile: (path: string) => `pem:${path}` }));

const productionContext = {
  cert: 'cert',
  cuit: 20123456786,
  key: 'key',
  production: true,
} as ResolvedArcaRuntime['context'];

const testingContext = { ...productionContext, production: false } as ResolvedArcaRuntime['context'];

function notice(expired: boolean): CertificateExpiryNotice {
  return {
    daysRemaining: expired ? -1 : 10,
    environment: 'produccion',
    expired,
    expiresOn: '20/11/2026',
    message: 'aviso',
    summary: 'aviso',
  };
}

describe('ArcaClientFactory', () => {
  const defaultCiphers = tls.DEFAULT_CIPHERS;

  beforeEach(() => {
    vi.clearAllMocks();
    tls.DEFAULT_CIPHERS = defaultCiphers;
  });

  afterAll(() => {
    tls.DEFAULT_CIPHERS = defaultCiphers;
  });

  it('stops before WSAA when the certificate is expired, without creating the ARCA client', () => {
    expect(() =>
      new ArcaClientFactory().create({ certificateExpiry: notice(true), context: productionContext }),
    ).toThrow(CertificateExpiredError);
    expect(Arca).not.toHaveBeenCalled();
  });

  it('excludes DHE in production, once, without relaxing the rest of TLS', () => {
    new ArcaClientFactory().create({ certificateExpiry: notice(false), context: productionContext });
    new ArcaClientFactory().create({ certificateExpiry: notice(false), context: productionContext });

    expect(tls.DEFAULT_CIPHERS).toBe(`${defaultCiphers}:!DHE`);
    expect(Arca).toHaveBeenCalledWith(productionContext);
  });

  it('keeps the default ciphers in testing', () => {
    new ArcaClientFactory().create({ certificateExpiry: notice(false), context: testingContext });

    expect(tls.DEFAULT_CIPHERS).toBe(defaultCiphers);
    expect(Arca).toHaveBeenCalledWith(testingContext);
  });

  it('excludes DHE too when WSFEX uses its own certificate in production', () => {
    new ArcaClientFactory().createForExport({
      certificateExpiry: undefined,
      config: {
        cert: {},
        exportacion: { cert: { produccion: 'wsfex.crt' }, key: { produccion: 'wsfex.key' } },
        key: {},
      } as ResolvedArcaRuntime['config'],
      context: productionContext,
      environment: 'produccion',
    });

    expect(tls.DEFAULT_CIPHERS).toBe(`${defaultCiphers}:!DHE`);
    expect(Arca).toHaveBeenCalledWith({ ...productionContext, cert: 'pem:wsfex.crt', key: 'pem:wsfex.key' });
  });
});
