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

beforeAll(() => [10, 365].forEach(createSelfSignedCertificate), OPENSSL_WARM_UP_TIMEOUT_MS);
afterAll(removeSelfSignedCertificates);
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
    const cert = { produccion: createSelfSignedCertificate(10).certPath };

    expect(notice({ cert, key: { produccion: '/p.key' } })).toBe(`${FISCAL} Se usa el certificado de producción.`);
  });

  it.each([
    [{}, {}, 'Faltan el certificado y la clave de producción.'],
    [{}, { produccion: '/p.key' }, 'Falta el certificado de producción.'],
    [{ produccion: '/p.crt' }, {}, 'Falta la clave de producción.'],
    // Los de testing no cuentan.
    [{ testing: '/t.crt' }, { testing: '/t.key' }, 'Faltan el certificado y la clave de producción.'],
  ])('con cert %j y key %j: %s', (cert, key, expected) => {
    expect(notice({ cert, key })).toBe(`${FISCAL} ${expected}`);
  });

  it('con el de producción vencido lo dice con la fecha', () => {
    const config = { cert: { produccion: createSelfSignedCertificate(10).certPath }, key: { produccion: '/p.key' } };

    expect(notice(config, 20)).toMatch(/ El certificado de producción venció el \d{2}\/\d{2}\/\d{4}\.$/);
    expect(notice(config, 20)).not.toContain('Se usa');
  });

  it('con el de testing o el de exportación vencido, se usa el de producción', () => {
    const expired = createSelfSignedCertificate(10).certPath;

    expect(
      notice(
        {
          cert: { produccion: createSelfSignedCertificate(365).certPath, testing: expired },
          exportacion: { cert: { produccion: expired }, key: { produccion: '/e.key' } },
          key: { produccion: '/p.key' },
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
        const panel = productionBanner({ missesCertificate: true, missesKey: true, sessionInTesting });
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
