import { describe, expect, it } from 'vitest';

import { resolveExportCredentials } from '../config.export-credentials';
import { arcliConfigSchema } from '../config.schemas';

const GENERAL = { produccion: '/certs/general.crt', testing: '/certs/general-testing.crt' };
const GENERAL_KEY = { produccion: '/certs/general.key', testing: '/certs/general-testing.key' };

function config(extra: Record<string, unknown> = {}) {
  return arcliConfigSchema.parse({ cert: GENERAL, key: GENERAL_KEY, ...extra });
}

describe('resolveExportCredentials', () => {
  it('usa los certificados de exportacion cuando estan configurados', () => {
    const resolved = resolveExportCredentials(
      config({
        exportacion: {
          cert: { testing: '/certs/expo-testing.crt' },
          key: { testing: '/certs/expo-testing.key' },
        },
      }),
      'testing',
    );

    expect(resolved).toEqual({
      cert: '/certs/expo-testing.crt',
      dedicated: true,
      key: '/certs/expo-testing.key',
    });
  });

  it('cae a los certificados generales si no hay seccion de exportacion', () => {
    expect(resolveExportCredentials(config(), 'testing')).toEqual({
      cert: '/certs/general-testing.crt',
      dedicated: false,
      key: '/certs/general-testing.key',
    });
  });

  it('pide el par completo: un certificado sin su clave no sirve', () => {
    expect(() =>
      resolveExportCredentials(config({ exportacion: { cert: { testing: '/certs/expo-testing.crt' } } }), 'testing'),
    ).toThrow(/certificado y la clave juntos/);
  });

  // TEST-21: los `faltan` salen en `--json`; cada caso dice que clave falta.
  it.each([
    [
      'certificado de exportación sin clave',
      { exportacion: { cert: { testing: '/e.crt' } } },
      ['exportacion.key.testing'],
    ],
    [
      'clave de exportación sin certificado',
      { exportacion: { key: { testing: '/e.key' } } },
      ['exportacion.cert.testing'],
    ],
    ['certificado general sin clave', { cert: { testing: '/g.crt' }, key: {} }, ['exportacion.key.testing']],
    ['clave general sin certificado', { cert: {}, key: { testing: '/g.key' } }, ['exportacion.cert.testing']],
    ['nada', { cert: {}, key: {} }, ['exportacion.cert.testing', 'exportacion.key.testing']],
  ])('%s: ConfigurationError con lo que falta', (_case, extra, faltan) => {
    expect(() => resolveExportCredentials(config(extra), 'testing')).toThrow(
      expect.objectContaining({ code: 'CONFIGURATION_ERROR', details: { faltan } }),
    );
  });

  it('avisa cuando no hay nada configurado para el entorno', () => {
    expect(() => resolveExportCredentials(arcliConfigSchema.parse({}), 'produccion')).toThrow(
      /Falta el certificado de WSFEX/,
    );
  });
});
