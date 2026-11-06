import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { buildConfigDoctorReport } from '../config-doctor';

const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createCertificateFile(days: number): string {
  const directory = mkdtempSync(join(tmpdir(), 'arcli-config-doctor-test-'));

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

  return certPath;
}

describe('config-doctor', () => {
  it('marks a complete testing-first config as healthy', () => {
    const testingCert = createCertificateFile(365);
    const produccionCert = createCertificateFile(365);

    const report = buildConfigDoctorReport(
      {
        cert: {
          produccion: produccionCert,
          testing: testingCert,
        },
        cuit: '20333333334',
        conceptoPorDefecto: 'servicios',
        emisor: {},
        entornoPorDefecto: 'testing',
        ivaReceptorPorDefecto: 'consumidor-final',
        key: {
          produccion: '/tmp/produccion.key',
          testing: '/tmp/testing.key',
        },
        output: {
          emitirPorDefecto: false,
          jsonPorDefecto: false,
          brutoPorDefecto: false,
        },
        puntoVentaPorDefecto: 3,
      },
      [{ environment: 'testing' }, { environment: 'produccion' }],
    );

    expect(report.ok).toBe(true);
    expect(report.checks.find((item) => item.label === 'Credenciales testing')?.category).toBe('ok');
    expect(report.checks.find((item) => item.label === 'Credenciales producción')?.category).toBe('ok');
    expect(report.checks.find((item) => item.label === 'Validación testing')?.category).toBe('ok');
    expect(report.checks.find((item) => item.label === 'Validación producción')?.category).toBe('ok');
    expect(report.checks.find((item) => item.label === 'Vencimiento cert. testing')?.category).toBe('ok');
    expect(report.checks.find((item) => item.label === 'Vencimiento cert. producción')?.category).toBe('ok');
  }, 10_000);

  it('warns when key defaults are still missing', () => {
    const report = buildConfigDoctorReport({
      cert: {},
      emisor: {},
      entornoPorDefecto: 'testing',
      key: {},
      output: {
        emitirPorDefecto: false,
        jsonPorDefecto: false,
        brutoPorDefecto: false,
      },
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((item) => item.label === 'CUIT')?.category).toBe('warning');
    expect(report.checks.find((item) => item.label === 'Punto de venta')?.category).toBe('warning');
    expect(report.checks.find((item) => item.label === 'Credenciales testing')?.category).toBe('warning');
    expect(report.checks.find((item) => item.label === 'Vencimiento cert. testing')).toBeUndefined();
  });

  it('warns when the testing certificate is about to expire', () => {
    const testingCert = createCertificateFile(10);

    const report = buildConfigDoctorReport({
      cert: { testing: testingCert },
      emisor: {},
      entornoPorDefecto: 'testing',
      key: {},
      output: {
        emitirPorDefecto: false,
        jsonPorDefecto: false,
        brutoPorDefecto: false,
      },
    });

    const check = report.checks.find((item) => item.label === 'Vencimiento cert. testing');

    expect(check?.category).toBe('warning');
    expect(check?.detail).toMatch(/vence en \d+ días/);
  }, 10_000);

  it('reports an error when a certificate path cannot be read', () => {
    const report = buildConfigDoctorReport({
      cert: { testing: '/no/existe/testing.crt' },
      emisor: {},
      entornoPorDefecto: 'testing',
      key: {},
      output: {
        emitirPorDefecto: false,
        jsonPorDefecto: false,
        brutoPorDefecto: false,
      },
    });

    const check = report.checks.find((item) => item.label === 'Vencimiento cert. testing');

    expect(check?.category).toBe('warning');
    expect(check?.detail).toContain('No se pudo verificar');
  });

  it('warns about missing issuer data only when the PDF is always generated', () => {
    const base = {
      cert: {},
      emisor: {},
      entornoPorDefecto: 'testing' as const,
      key: {},
      output: { brutoPorDefecto: false, emitirPorDefecto: false, jsonPorDefecto: false },
    };

    expect(buildConfigDoctorReport(base).checks.find((check) => check.label === 'PDF')).toBeUndefined();
    expect(
      buildConfigDoctorReport({ ...base, pdf: 'siempre' }).checks.find((check) => check.label === 'PDF'),
    ).toMatchObject({
      category: 'warning',
    });
  });
});

describe('config revisar: plugin de PDF', () => {
  const pluginCheck = (pdf: 'nunca' | 'preguntar' | 'siempre', plugin: Parameters<typeof buildConfigDoctorReport>[2]) =>
    buildConfigDoctorReport(
      {
        cert: {},
        emisor: {},
        entornoPorDefecto: 'testing',
        key: {},
        output: { brutoPorDefecto: false, emitirPorDefecto: false, jsonPorDefecto: false },
        pdf,
      },
      [],
      plugin,
    ).checks.find((check) => check.label === 'Plugin de PDF');

  it('instalado, con la versión de arcli y un navegador: ok', () => {
    expect(
      pluginCheck('preguntar', { browser: '/usr/bin/chromium', installedVersion: '0.2.1', version: '0.2.1' }),
    ).toMatchObject({ category: 'ok', section: 'pdf', value: '0.2.1' });
  });

  it.each([
    ['sin instalar', { version: '0.2.1' }, /arcli pdf instalar/],
    ['otra versión', { browser: '/b', installedVersion: '0.1.0', version: '0.2.1' }, /0\.1\.0.*0\.2\.1/],
    ['sin navegador', { installedVersion: '0.2.1', version: '0.2.1' }, /pdfNavegador/],
  ])('%s: aviso', (_case, plugin, detail) => {
    expect(pluginCheck('siempre', plugin)).toMatchObject({
      category: 'warning',
      detail: expect.stringMatching(detail),
    });
  });

  it('con pdf=nunca no lo revisa', () => {
    expect(pluginCheck('nunca', { version: '0.2.1' })).toBeUndefined();
  });

  it('con pdf=preguntar, sin instalar no avisa (así `ok` no cae) e instalado sí lo revisa', () => {
    expect(pluginCheck('preguntar', { version: '0.2.1' })).toBeUndefined();
    expect(pluginCheck('preguntar', { installedVersion: '0.1.0', version: '0.2.1' })).toMatchObject({
      category: 'warning',
    });
  });
});
