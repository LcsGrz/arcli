import { Arca } from '@arcasdk/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CertificateExpiredError, type CertificateExpiryNotice } from '../../../modules/config/certificate-expiry';
import { ArcaClientFactory } from '../arca-client.factory';
import type { ResolvedArcaRuntime } from '../arca-context.resolver';

vi.mock('@arcasdk/core', () => ({ Arca: vi.fn() }));

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops before WSAA when the certificate is expired, without creating the ARCA client', () => {
    expect(() =>
      new ArcaClientFactory().create({ certificateExpiry: notice(true), context: productionContext }),
    ).toThrow(CertificateExpiredError);
    expect(Arca).not.toHaveBeenCalled();
  });

  it('uses the scoped legacy HTTPS agent in production', () => {
    new ArcaClientFactory().create({ certificateExpiry: notice(false), context: productionContext });

    expect(Arca).toHaveBeenCalledWith({ ...productionContext, useHttpsAgent: true });
  });

  it('keeps the default HTTPS behavior in testing', () => {
    new ArcaClientFactory().create({ certificateExpiry: notice(false), context: testingContext });

    expect(Arca).toHaveBeenCalledWith({ ...testingContext, useHttpsAgent: false });
  });
});
