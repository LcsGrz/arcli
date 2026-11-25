import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createSelfSignedCertificate,
  OPENSSL_WARM_UP_TIMEOUT_MS,
  removeSelfSignedCertificates,
} from '../../../lib/security/__tests__/self-signed-certificate';
import { type ArcliConfig, CONFIG_DEFAULTS } from '../../../modules/config/config.schemas';
import { inspectProductionCredentials } from '../../../modules/interactive/production-credentials';
import { productionBanner, stripAnsi } from '../../../ui';

const DAY_MS = 86_400_000;
const directory = mkdtempSync(join(tmpdir(), 'arcli-production-banner-'));

beforeAll(() => [10, 365].forEach(createSelfSignedCertificate), OPENSSL_WARM_UP_TIMEOUT_MS);
afterAll(() => {
  removeSelfSignedCertificates();
  rmSync(directory, { force: true, recursive: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** El aviso con lo que el núcleo lee de la config, como lo arma "Modificar configuración". */
function notice(config: Partial<ArcliConfig>, inDays = 0, sessionInTesting = false) {
  const now = new Date(Date.now() + inDays * DAY_MS);
  const text = productionBanner({
    ...inspectProductionCredentials({ ...CONFIG_DEFAULTS, ...config }, now),
    sessionInTesting,
  });

  return stripAnsi(text)
    .replace(/[╎╌└┘┌┐\s]+/g, ' ')
    .trim();
}

const FISCAL = 'AHORA ESTÁS EN PRODUCCIÓN Los comprobantes que emitas van a tener validez fiscal.';

describe('aviso de pasar a producción (TUI-46)', () => {
  it('con el certificado y la clave dice que se usa el de producción, también si vence pronto', () => {
    const { certPath, keyPath } = createSelfSignedCertificate(10);

    expect(notice({ cert: { produccion: certPath }, key: { produccion: keyPath } })).toBe(
      `${FISCAL} Se usa el certificado de producción.`,
    );
  });

  /** Un archivo de cada tipo: sin configurar, uno que sirve, uno que no existe, uno que no es PEM y un PEM roto. */
  const file = {
    broken: (kind: string) => {
      const path = join(directory, `broken-${kind.replace(' ', '-')}.pem`);

      writeFileSync(path, `-----BEGIN ${kind}-----\nnope\n-----END ${kind}-----\n`);

      return path;
    },
    missing: () => join(directory, 'no-existe.pem'),
    text: () => {
      const path = join(directory, 'texto.pem');

      writeFileSync(path, 'secreto');

      return path;
    },
  };
  const cert = () => createSelfSignedCertificate(10).certPath;
  const key = () => createSelfSignedCertificate(10).keyPath;
  const none = () => undefined;

  it.each([
    ['los dos sin configurar', none, none, 'Faltan el certificado y la clave de producción.'],
    ['sin certificado', none, key, 'Falta el certificado de producción.'],
    ['sin clave', cert, none, 'Falta la clave de producción.'],
    ['un certificado que no existe', file.missing, key, 'No se pudo leer el certificado de producción.'],
    ['un certificado que no es PEM', file.text, key, 'No se pudo leer el certificado de producción.'],
    ['un PEM que no es X.509', () => file.broken('CERTIFICATE'), key, 'No se pudo leer el certificado de producción.'],
    ['una carpeta de certificado', () => directory, key, 'No se pudo leer el certificado de producción.'],
    ['una clave que no existe', cert, file.missing, 'No se pudo leer la clave de producción.'],
    ['una clave que no es PEM', cert, file.text, 'No se pudo leer la clave de producción.'],
    ['una clave cifrada', cert, () => file.broken('ENCRYPTED PRIVATE KEY'), 'No se pudo leer la clave de producción.'],
    ['los dos ilegibles', file.missing, file.text, 'No se pudieron leer el certificado y la clave de producción.'],
    [
      'uno ilegible y la otra sin configurar',
      file.missing,
      none,
      'No se pudo leer el certificado de producción. Falta la clave de producción.',
    ],
  ])('con %s, lo dice sin mostrar rutas ni contenido', (_case, certPath, keyPath, expected) => {
    // Los de testing no cuentan.
    expect(
      notice({ cert: { produccion: certPath(), testing: cert() }, key: { produccion: keyPath(), testing: key() } }),
    ).toBe(`${FISCAL} ${expected}`);
  });

  it.each([
    ['y la clave', key, ''],
    ['sin la clave', none, ' Falta la clave de producción.'],
    ['y la clave ilegible', file.missing, ' No se pudo leer la clave de producción.'],
  ])('con el certificado vencido %s, dice la fecha', (_case, keyPath, rest) => {
    expect(notice({ cert: { produccion: cert() }, key: { produccion: keyPath() } }, 20)).toMatch(
      new RegExp(`^${FISCAL} El certificado de producción venció el \\d{2}/\\d{2}/\\d{4}\\.${rest}$`),
    );
  });

  it('con el de testing o el de exportación vencido, se usa el de producción', () => {
    const expired = cert();
    const valid = createSelfSignedCertificate(365);

    expect(
      notice(
        {
          cert: { produccion: valid.certPath, testing: expired },
          exportacion: { cert: { produccion: expired }, key: { produccion: key() } },
          key: { produccion: valid.keyPath },
        },
        20,
      ),
    ).toBe(`${FISCAL} Se usa el certificado de producción.`);
  });

  it('si `--testing` manda en la sesión, no dice que ya estás en producción', () => {
    expect(notice({}, 0, true)).toBe(
      'EL ENTORNO GUARDADO ES PRODUCCIÓN Esta sesión sigue en TESTING por `--testing`. Sin ese flag, los comprobantes que emitas van a tener validez fiscal.',
    );
  });

  it.each(['', '1'])('a 40 columnas el título entra, con ARCLI_ASCII=%j', (ascii) => {
    const columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');

    vi.stubEnv('ARCLI_ASCII', ascii);
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 40 });

    try {
      for (const sessionInTesting of [false, true]) {
        const panel = productionBanner({ certificate: 'falta', key: 'falta', sessionInTesting });
        const lines = stripAnsi(panel).split('\n');

        expect(lines.every((line) => line.length === 40)).toBe(true);
        expect(lines[0]).toContain('PRODUCCIÓN');
      }
    } finally {
      if (columns) {
        Object.defineProperty(process.stdout, 'columns', columns);
      } else {
        Reflect.deleteProperty(process.stdout, 'columns');
      }
    }
  });
});
