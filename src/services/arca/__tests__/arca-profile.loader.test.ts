import { X509Certificate } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { formatArcaDateAsArgentineDate, formatDateAsArcaDate } from '../../../lib/dates/arca-date';
import {
  createSelfSignedCertificate,
  OPENSSL_WARM_UP_TIMEOUT_MS,
  removeSelfSignedCertificates,
} from '../../../lib/security/__tests__/self-signed-certificate';
import { type ArcliConfig, CONFIG_DEFAULTS } from '../../../modules/config/config.schemas';
import { checkArcaProfile, loadArcaProfile } from '../arca-profile.loader';

const DAY = 24 * 60 * 60 * 1000;
const CERT = '-----BEGIN CERTIFICATE-----\nCERT\n-----END CERTIFICATE-----';
const KEY = '-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----';

let directory = '';

function writeFile(name: string, content: string): string {
  const path = join(directory, name);

  writeFileSync(path, content, 'utf8');

  return path;
}

function configWith(cert: string, key: string, extra: Partial<ArcliConfig> = {}): ArcliConfig {
  return { ...CONFIG_DEFAULTS, cert: { testing: cert }, cuit: '20123456786', key: { testing: key }, ...extra };
}

/** Instante a `days` dias del vencimiento del certificado: el resultado no depende del reloj real. */
function daysBeforeExpiry(pem: string, days: number): Date {
  return new Date(new Date(new X509Certificate(pem).validTo).getTime() - days * DAY);
}

beforeAll(() => [10, 365].forEach(createSelfSignedCertificate), OPENSSL_WARM_UP_TIMEOUT_MS);
afterAll(removeSelfSignedCertificates);

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-perfil-loader-'));
});

afterEach(() => {
  rmSync(directory, { force: true, recursive: true });
});

describe('loadArcaProfile', () => {
  it('arma el perfil con la config, el entorno y la carpeta de tickets que recibe', () => {
    const config = configWith(writeFile('a.crt', CERT), writeFile('a.key', KEY), { puntoVentaPorDefecto: 7 });

    // CERT es PEM pero no un certificado que se pueda leer: no se inventa un aviso.
    expect(loadArcaProfile(config, { environment: 'testing', ticketPath: '/tickets' })).toEqual({
      certificateExpiry: undefined,
      certificateNotices: [],
      config,
      context: { cert: CERT, cuit: 20123456786, key: KEY, production: false, ticketPath: '/tickets' },
      cuit: 20123456786,
      environment: 'testing',
      pointOfSale: 7,
    });
  });

  it('si falta el archivo de la clave lo dice antes de leer el certificado', () => {
    const config = configWith(writeFile('a.crt', 'no es PEM'), join(directory, 'no-existe.key'));

    expect(() => loadArcaProfile(config, { environment: 'testing', ticketPath: '/tickets' })).toThrow(
      /^La ruta de la clave privada no existe/,
    );
  });

  it.skipIf(process.platform === 'win32')('no toca los permisos de la carpeta de tickets', () => {
    chmodSync(directory, 0o755);

    loadArcaProfile(configWith(writeFile('a.crt', CERT), writeFile('a.key', KEY)), {
      environment: 'testing',
      ticketPath: directory,
    });

    expect(statSync(directory).mode & 0o777).toBe(0o755);
  });

  function loadAt(certificateDays: number, remainingDays: number) {
    const certificate = createSelfSignedCertificate(certificateDays);

    return loadArcaProfile(configWith(certificate.certPath, certificate.keyPath), {
      environment: 'testing',
      now: daysBeforeExpiry(certificate.pem, remainingDays),
      ticketPath: '/tickets',
    });
  }

  it('avisa si vence en menos de 30 dias, con la fecha y los dias que faltan', () => {
    const expiryDate = formatArcaDateAsArgentineDate(
      formatDateAsArcaDate(daysBeforeExpiry(createSelfSignedCertificate(10).pem, 0)),
    );

    expect(loadAt(10, 10).certificateExpiry).toMatchObject({
      environment: 'testing',
      expired: false,
      message: expect.stringContaining(`El certificado de testing vence el ${expiryDate} (en 10 días)`),
    });
  });

  it('vencido, avisa sin cortar', () => {
    expect(loadAt(10, -10).certificateExpiry).toMatchObject({ environment: 'testing', expired: true });
  });

  it('lejos de vencer, sin avisos', () => {
    expect(loadAt(365, 365)).toMatchObject({ certificateExpiry: undefined, certificateNotices: [] });
  });

  it('avisa el de produccion trabajando en testing', () => {
    const testing = createSelfSignedCertificate(365);
    const production = createSelfSignedCertificate(10);
    const config = configWith(testing.certPath, testing.keyPath, {
      cert: { produccion: production.certPath, testing: testing.certPath },
    });
    const profile = loadArcaProfile(config, {
      environment: 'testing',
      now: daysBeforeExpiry(production.pem, 10),
      ticketPath: '/tickets',
    });

    expect(profile.certificateExpiry).toBeUndefined();
    expect(profile.certificateNotices).toEqual([
      expect.objectContaining({ environment: 'produccion', expired: false }),
    ]);
  });
});

describe('checkArcaProfile', () => {
  it('devuelve el CUIT y las rutas sin leer los archivos', () => {
    const certPath = writeFile('a.crt', 'no es PEM');
    const keyPath = writeFile('a.key', 'no es PEM');

    expect(checkArcaProfile(configWith(certPath, keyPath), { environment: 'testing' })).toEqual({
      certPath,
      cuit: 20123456786,
      keyPath,
    });
  });
});
