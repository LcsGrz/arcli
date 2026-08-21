import { describe, expect, it } from 'vitest';

import { formatConfig, formatConfigAsText, formatConfigDoctor, formatConfigDoctorAsText } from '../config.presenter';
import { buildConfigDoctorReport } from '../config-doctor';

describe('config.presenter', () => {
  it('masks certificate and key paths in config output', () => {
    const text = formatConfigAsText(
      {
        cert: {
          testing: '/Users/lucas/secretos/cert.pem',
        },
        entornoPorDefecto: 'testing',
        key: {
          testing: '/Users/lucas/secretos/key.pem',
        },
        output: {
          emitirPorDefecto: false,
          brutoPorDefecto: false,
          jsonPorDefecto: false,
        },
      },
      '/Users/lucas/secretos/tickets',
    );

    const json = formatConfig(
      {
        cert: {
          testing: '/Users/lucas/secretos/cert.pem',
        },
        entornoPorDefecto: 'testing',
        key: {
          testing: '/Users/lucas/secretos/key.pem',
        },
        output: {
          emitirPorDefecto: false,
          brutoPorDefecto: false,
          jsonPorDefecto: false,
        },
      },
      '/Users/lucas/secretos/tickets',
    );

    expect(text).toContain('.../secretos/cert.pem');
    expect(text).toContain('.../secretos/key.pem');
    expect(text).toContain('.../secretos/tickets');
    expect(text).not.toContain('/Users/lucas/secretos/cert.pem');
    expect(json).toContain('.../secretos/cert.pem');
    expect(json).not.toContain('/Users/lucas/secretos/key.pem"');
    expect(json).not.toContain('/Users/lucas/secretos/tickets"');
  });

  it('serializes revision with masked runtime-friendly details', () => {
    const report = buildConfigDoctorReport(
      {
        cert: {
          testing: '/Users/lucas/secretos/cert.pem',
        },
        cuit: '20123456789',
        entornoPorDefecto: 'testing',
        key: {
          testing: '/Users/lucas/secretos/key.pem',
        },
        output: {
          emitirPorDefecto: false,
          jsonPorDefecto: false,
          brutoPorDefecto: false,
        },
      },
      {
        error: 'Falta el punto de venta.',
      },
    );

    expect(formatConfigDoctor(report)).toContain('"etiqueta": "Revision activa"');
    expect(formatConfigDoctorAsText(report)).toContain('REVISION DE CONFIGURACION');
    expect(formatConfigDoctorAsText(report)).toContain('Falta el punto de venta.');
  });
});
