import { describe, expect, it } from 'vitest';

import { stripAnsi } from '../../../ui';
import { formatCertificateStatusAsText } from '../certificate.presenter';

const NOW = new Date('2026-11-04T12:00:00Z');

describe('formatCertificateStatusAsText', () => {
  it('shows one box per environment, with expiry, files and a pending request', () => {
    const text = stripAnsi(
      formatCertificateStatusAsText(
        [
          {
            environment: 'testing',
            pendingRequestPath: '/c/arcli/certificados/1/testing.nueva.csr',
            unreadable: false,
          },
          {
            alias: 'arcli',
            certificatePath: '/c/arcli/certificados/1/produccion.crt',
            environment: 'produccion',
            expiresAt: new Date('2026-11-20T12:00:00Z'),
            keyPath: '/c/arcli/certificados/1/produccion.key',
            unreadable: false,
          },
        ],
        NOW,
      ),
    );

    expect(text).toContain('CERTIFICADO DE TESTING');
    expect(text).toContain('Sin certificado');
    expect(text).toContain('Hay un pedido sin importar: testing.nueva.csr');
    expect(text).toContain('CERTIFICADO DE PRODUCCIÓN');
    expect(text).toMatch(/Vence\s+20\/11\/2026\s+\(faltan 16 días: renovalo\)/);
    expect(text).toContain('.../arcli/certificados/1/produccion.key');
  });

  it('says when the configured certificate cannot be read', () => {
    const text = stripAnsi(
      formatCertificateStatusAsText([{ certificatePath: '/c/x.crt', environment: 'testing', unreadable: true }], NOW),
    );

    expect(text).toContain('No se puede leer');
  });
});
